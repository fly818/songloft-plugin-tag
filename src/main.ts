/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';
import { scrapeSong, scrapeBatch, previewScrape, doScrape, writeTags, type ScrapeResult } from './scraper';
import { loadConfig, saveConfig, DEFAULT_CONFIG, type ScraperConfig } from './sources';
import { isFpcalcAvailable, installFpcalc, getPlatformInfo } from './fpcalc';

const router = createRouter();

// 异步批量任务状态
const batchTasks = new Map<string, {
  ids: number[];
  current: number;
  total: number;
  results: any[];
  success: number;
  skipped: number;
  skippedIds: number[];
  failed: number;
  failedIds: number[];
  status: 'running' | 'done';
}>();

/** 安全解析请求体（Uint8Array/string → JSON） */
function parseBody(req: any): any {
  const raw = req.body;
  if (!raw) return {};
  // Uint8Array or array-like
  if (typeof raw === 'object' && typeof raw.length === 'number' && typeof raw[0] === 'number') {
    let str = '';
    for (let i = 0; i < raw.length; i++) str += String.fromCharCode(raw[i]);
    try { return JSON.parse(str); } catch { return {}; }
  }
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

// ============================================================
// 静态首页重定向
// ============================================================
router.get('/', (_req) => ({
  statusCode: 302,
  headers: { 'Location': 'static/index.html' },
  body: '',
}));

// ============================================================
// 配置
// ============================================================
router.get('/config', async (_req) => {
  const config = await loadConfig();
  return jsonResponse(config);
});

router.put('/config', async (req) => {
  try {
    const updates = parseBody(req);
    const current = await loadConfig();
    const merged = { ...current, ...updates };
    await saveConfig(merged);
    return jsonResponse({ status: 'ok', config: merged });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 400);
  }
});

// ============================================================
// fpcalc 管理
// ============================================================
router.get('/fpcalc/status', async (_req) => {
  const available = await isFpcalcAvailable();
  const platform = getPlatformInfo();
  return jsonResponse({ available, ...platform });
});

router.post('/fpcalc/install', async (_req) => {
  const result = await installFpcalc();
  return jsonResponse(result, result.success ? 200 : 500);
});

// ============================================================
// 刮削
// ============================================================

// 批量刮削（异步+轮询，解决超时）
router.post('/scrape/batch', async (req) => {
  const body = parseBody(req);
  const ids: number[] = [...new Set(body.ids || [])];
  if (!ids.length) return jsonResponse({ error: '请提供歌曲 ID 列表' }, 400);

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const task = {
    ids, current: 0, total: ids.length,
    results: [] as any[], success: 0, skipped: 0, skippedIds: [] as number[],
    failed: 0, failedIds: [] as number[], status: 'running' as const,
  };
  batchTasks.set(taskId, task);

  // 异步执行
  setTimeout(async () => {
    const cfg = await loadConfig();
    for (const songId of ids) {
      try {
        const result = await doScrape(songId, cfg);
        if (!result) {
          songloft.log.info(`[batch] 跳过 songId=${songId}: 无匹配结果`);
          task.skipped++;
          task.skippedIds.push(songId);
        } else {
          const ws = await writeTags(songId, result);
          result.fileWriteStatus = ws;
          task.results.push(result);
          if (ws === 'written' || ws === 'skipped') {
            task.success++;
          } else {
            task.failed++;
            task.failedIds.push(songId);
          }
        }
      } catch {
        task.failed++;
        task.failedIds.push(songId);
      }
      task.current++;
    }
    task.status = 'done';
  }, 100);

  return jsonResponse({ taskId, status: 'started', total: ids.length });
});

// 批量进度查询
router.get('/scrape/batch/progress', async (req) => {
  const q = (req as any).query || '';
  const taskId = q.match(/taskId=([^&]+)/)?.[1];
  if (!taskId) return jsonResponse({ error: '缺少 taskId' }, 400);
  const task = batchTasks.get(taskId);
  if (!task) return jsonResponse({ error: '任务不存在' }, 404);
  const latest = task.results[task.results.length - 1];
  return jsonResponse({
    status: task.status,
    current: task.current,
    total: task.total,
    success: task.success,
    skipped: task.skipped,
    failed: task.failed,
    lastLog: latest ? `${latest.artist} - ${latest.title} | ${latest.source} | ${latest.fileWriteStatus}` : null,
    loggedCount: task.results.length + task.skippedIds.length + task.failedIds.length,
    results: task.status === 'done' ? task.results : undefined,
    skippedIds: task.status === 'done' ? task.skippedIds : undefined,
    failedIds: task.status === 'done' ? task.failedIds : undefined,
  });
  // 完成后保留 60s 再清理
  if (task.status === 'done') {
    setTimeout(() => batchTasks.delete(taskId), 60000);
  }
});

// 单曲刮削
router.post('/scrape/:id', async (req, params) => {
  const songId = parseInt(params?.id || '0', 10);
  if (!songId) return jsonResponse({ error: '无效的歌曲 ID' }, 400);

  songloft.log.info(`[api] 刮削请求: songId=${songId}`);
  const result = await scrapeSong(songId);
  if (!result) {
    return jsonResponse({ error: '刮削失败，无匹配结果', songId }, 404);
  }
  return jsonResponse(result);
});

// 预览刮削（不写入）
router.post('/scrape/preview/:id', async (req, params) => {
  const songId = parseInt(params?.id || '0', 10);
  if (!songId) return jsonResponse({ error: '无效的歌曲 ID' }, 400);

  const result = await previewScrape(songId);
  if (!result) {
    return jsonResponse({ error: '无匹配结果', songId }, 404);
  }
  return jsonResponse(result);
});

// ============================================================
// 单曲详情（编辑页用）
// ============================================================
router.get('/song/:id', async (_req, params) => {
  try {
    const id = parseInt(params?.id || '0', 10);
    if (!id) return jsonResponse({ error: '无效 ID' }, 400);
    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const resp = await fetch(`${host}/api/v1/songs/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) return jsonResponse({ error: '歌曲不存在' }, 404);
    const s = await resp.json();
    let lyrics = '';
    if (s.lyric_url) {
      try {
        const lr = await fetch(`${host}${s.lyric_url}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (lr.ok) {
          const raw = await lr.text();
          try { lyrics = JSON.parse(raw).lyric || raw; } catch { lyrics = raw; }
        }
      } catch { /* ignore */ }
    }
    return jsonResponse({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      album: s.album || '',
      cover_url: s.cover_url ? `${host}${s.cover_url}` : '',
      lyrics: lyrics,
      genre: s.genre || '',
      file_path: s.file_path || '',
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});

// ============================================================
// 标签写入代理（避免前端跨域）
// ============================================================
router.put('/tags/:id', async (req, params) => {
  try {
    const id = parseInt(params?.id || '0', 10);
    if (!id) return jsonResponse({ error: '无效 ID' }, 400);
    const body = parseBody(req);
    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const resp = await fetch(`${host}/api/v1/songs/${id}/tags`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return jsonResponse({ error: errText.substring(0, 200) }, resp.status);
    }
    const data = await resp.json();
    return jsonResponse(data);
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});

// ============================================================
// 歌曲列表（前端用）
// ============================================================
router.get('/songs', async (req) => {
  try {
    const query = req.query || '';
    const params = new URLSearchParams(query);
    const keyword = params.get('q') || '';
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    let songs;
    if (keyword) {
      songs = await songloft.songs.search(keyword);
    } else {
      songs = await songloft.songs.list({ limit, offset });
    }

    // 转换为前端友好的格式
    const items = songs.map((s: any) => ({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      album: s.album || '',
      type: s.type || '',
      file_path: s.file_path || '',
      format: s.format || '',
      duration: s.duration || 0,
      cover_url: (s as any).cover_url || '',
      lyrics: (s as any).lyrics || '',
      genre: (s as any).genre || '',
    }));

    return jsonResponse({ songs: items, total: items.length });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e), songs: [] }, 500);
  }
});

// ============================================================
// 失败记录存储
// ============================================================
router.get('/storage/failed', async (_req) => {
  try {
    const raw = await songloft.storage.get('failed_songs');
    return jsonResponse(raw ? JSON.parse(raw) : []);
  } catch {
    return jsonResponse([]);
  }
});

router.post('/storage/failed', async (req) => {
  try {
    await songloft.storage.set('failed_songs', req.body || '[]');
    return jsonResponse({ ok: true });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});

// ============================================================
// 手动刮削（用户输入关键词）
// ============================================================
router.post('/scrape/manual/:id', async (req, params) => {
  const songId = parseInt(params?.id || '0', 10);
  if (!songId) return jsonResponse({ error: '无效的歌曲 ID' }, 400);

  try {
    const body = parseBody(req);
    const keyword: string = body.keyword || '';
    const artist: string = body.artist || '';
    const title: string = body.title || '';
    if (!keyword) return jsonResponse({ error: '缺少关键词' }, 400);

    const { searchNetease, searchQQMusic, searchKuGou, loadConfig: lc } = await import('./sources');
    const { scoreMatch } = await import('./scoring');
    const cfg = await lc();

    const allResults: any[] = [];
    const scores: Record<string, number> = {};

    if (cfg.enable_netease && cfg.netease_api_url) {
      const r = await searchNetease(keyword, cfg.netease_api_url);
      r.forEach((x: any) => { x.score = scoreMatch({ artist, title }, x); });
      if (r.length) { scores['netease'] = Math.max(...r.map((x: any) => x.score)); allResults.push(...r); }
    }
    if (cfg.enable_qqmusic && cfg.qqmusic_api_url) {
      const r = await searchQQMusic(keyword, cfg.qqmusic_api_url);
      r.forEach((x: any) => { x.score = scoreMatch({ artist, title }, x); });
      if (r.length) { scores['qqmusic'] = Math.max(...r.map((x: any) => x.score)); allResults.push(...r); }
    }
    if (cfg.enable_kugou && cfg.kugou_api_url) {
      const r = await searchKuGou(keyword, cfg.kugou_api_url);
      r.forEach((x: any) => { x.score = scoreMatch({ artist, title }, x); });
      if (r.length) { scores['kugou'] = Math.max(...r.map((x: any) => x.score)); allResults.push(...r); }
    }

    let best: any = null;
    let bestScore = -1;
    for (const r of allResults) { if (r.score > bestScore) { bestScore = r.score; best = r; } }

    if (!best) return jsonResponse({ error: '无匹配', songId }, 404);
    return jsonResponse({
      songId,
      artist: best.artist,
      title: best.title,
      album: best.album || '',
      cover_url: best.cover_url || '',
      source: best.source,
      score: best.score,
      sourceScores: scores,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});

// ============================================================
// 生命周期
// ============================================================
async function onInit(): Promise<void> {
  songloft.log.info('[tag] 标签刮削插件已启动');
  // 清理旧版残留（bin/ 下文件在 overlayfs 上会导致 AcoustID 失败）
  try {
    const files = await songloft.command.listBin();
    if (Array.isArray(files)) {
      for (const f of files) {
        try { await songloft.command.deleteBin(f); } catch { /* ok */ }
      }
    }
  } catch { /* ok */ }
  // 确保默认配置存在
  const existing = await loadConfig();
  if (!existing || Object.keys(existing).length === 0) {
    await saveConfig(DEFAULT_CONFIG);
  }
}

async function onDeinit(): Promise<void> {
  songloft.log.info('[tag] 标签刮削插件已卸载');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return router.handle(req);
}

// @ts-expect-error — QuickJS 全局注入
globalThis.onInit = onInit;
// @ts-expect-error
globalThis.onDeinit = onDeinit;
// @ts-expect-error
globalThis.onHTTPRequest = onHTTPRequest;
