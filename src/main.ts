/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';
import { toSimplified } from './t2s';
import { scrapeSong, scrapeBatch, previewScrape, doScrape, writeTags, clearCover, type ScrapeResult } from './scraper';
import { loadConfig, saveConfig, DEFAULT_CONFIG, type ScraperConfig } from './sources';

const router = createRouter();

// ---- SSRF 防护：内网地址拦截 ----
function isBadHost(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return true;
  // 支持 IPv6 方括号地址（如 http://[::1]/）
  const m = url.match(/^https?:\/\/(?:\[([^\]]+)\]|([^\/:?#]+))/);
  if (!m) return true;
  const h = (m[1] || m[2]).toLowerCase();
  if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|0:0:0:0:0:0:0:1|\[::1\]|\[0:0:0:0:0:0:0:1\])$/i.test(h)) return true;
  if (/^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/.test(h)) return true;
  return false;
}

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

// 已成功刮削的歌曲 ID 集合
async function getScrapedDone(): Promise<Set<number>> {
  try {
    const raw = await songloft.storage.get('scraped_done');
    let arr: number[];
    if (Array.isArray(raw)) { arr = raw; }
    else if (typeof raw === 'string') { arr = JSON.parse(raw); }
    else { arr = []; }
    return new Set(arr);
  } catch { return new Set(); }
}
async function markScrapedDone(songId: number): Promise<void> {
  try {
    const done = await getScrapedDone();
    done.add(songId);
    await songloft.storage.set('scraped_done', [...done]);
  } catch { /* ok */ }
}

// 埋点统计（首次安装/升级记数）
async function reportStats(): Promise<void> {
  try {
    const DEV_ID = 'plugin_stats_device_id';
    const LAST_VER = 'plugin_stats_last_ver';
    let deviceId = await songloft.storage.get(DEV_ID);
    const lastVer = await songloft.storage.get(LAST_VER);
    const currentVer = '1.1.3';
    const isNew = !deviceId;
    const isUpgrade = lastVer && lastVer !== currentVer;
    if (!isNew && !isUpgrade) return;
    if (isNew) {
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await songloft.storage.set(DEV_ID, deviceId);
    }
    await songloft.storage.set(LAST_VER, currentVer);
    // 用免费计数器 API（无需 token，GET 即计数）
    const key = isNew ? 'songloft-tag-installs' : 'songloft-tag-upgrades';
    await fetch(`https://countapi.mileshilliard.com/api/v1/hit/${key}`);
  } catch { /* 统计失败不影响功能 */ }
}

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

    // 自动推导开关：有 Key/URL 则开启，清空则关闭
    merged.enable_acoustid = !!(merged.acoustid_api_key);
    merged.enable_netease  = !!(merged.netease_api_url);
    merged.enable_qqmusic  = !!(merged.qqmusic_api_url);
    merged.enable_kugou    = !!(merged.kugou_api_url);
    merged.enable_kuwo     = !!(merged.kuwo_api_url);

    if (merged.netease_api_url && isBadHost(merged.netease_api_url)) {
      songloft.log.warn('[ssrf] 拦截内网 URL: ' + merged.netease_api_url);
      return jsonResponse({ error: 'URL 不允许：netease_api_url 指向内网地址' }, 400);
    }
    if (merged.qqmusic_api_url && isBadHost(merged.qqmusic_api_url)) {
      return jsonResponse({ error: 'URL 不允许：qqmusic_api_url 指向内网地址' }, 400);
    }
    if (merged.kugou_api_url && isBadHost(merged.kugou_api_url)) {
      return jsonResponse({ error: 'URL 不允许：kugou_api_url 指向内网地址' }, 400);
    }

    // 清理可能被污染的存储（防止 {status, config} 响应体被写入 config）
    delete merged['status'];
    delete merged['config'];

    await saveConfig(merged);
    return jsonResponse({ status: 'ok', config: merged });
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 400);
  }
});

// ============================================================
// 源可连接性检测
// ============================================================
router.get('/config/status', async (_req) => {
  const cfg = await loadConfig();
  const result: Record<string, boolean> = {};
  const probes: Promise<void>[] = [];

  // AcoustID: 解析 JSON 判断 status 字段（无效 key 也返回 200）
  if (cfg.acoustid_api_key) {
    probes.push((async () => {
      try {
        const resp = await fetch(
          `https://api.acoustid.org/v2/lookup?client=${cfg.acoustid_api_key}&duration=1&fingerprint=AQAAzJg8U&meta=recordingids`
        );
        const data = await resp.json();
        // status='ok' → 正常；error.code=3(指纹无效,返回400) → key 有效
        result['acoustid'] = data?.status === 'ok' || data?.error?.code === 3;
      } catch { result['acoustid'] = false; }
    })());
  }

  // 网易云 — 连通性：检测主机是否可达（eapi 加密由搜索函数处理)
  if (cfg.enable_netease && !isBadHost(cfg.netease_api_url)) {
    probes.push((async () => {
      try {
        const m = cfg.netease_api_url.match(/^(https?:\/\/[^\/]+)/);
        const host = m ? m[1] : cfg.netease_api_url;
        const resp = await fetch(host, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        result['netease'] = resp.ok;
      } catch { result['netease'] = false; }
    })());
  }

  // QQ音乐
  if (cfg.enable_qqmusic && !isBadHost(cfg.qqmusic_api_url)) {
    probes.push((async () => {
      try {
        const resp = await fetch(
          `${cfg.qqmusic_api_url}?w=test&format=json&n=1`,
          { headers: { 'Referer': 'https://y.qq.com', 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!resp.ok) { result['qqmusic'] = false; return; }
        const data = await resp.json();
        result['qqmusic'] = data?.data?.song?.list !== undefined;
      } catch { result['qqmusic'] = false; }
    })());
  }

  // 酷狗
  if (cfg.enable_kugou && !isBadHost(cfg.kugou_api_url)) {
    probes.push((async () => {
      try {
        const resp = await fetch(
          `${cfg.kugou_api_url}?keyword=test&page=1&pagesize=1`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!resp.ok) { result['kugou'] = false; return; }
        const data = await resp.json();
        result['kugou'] = data?.data?.lists !== undefined;
      } catch { result['kugou'] = false; }
    })());
  }

  // 酷我（直接测 kuwo.cn）
  if (cfg.enable_kuwo) {
    probes.push((async () => {
      try {
        const resp = await fetch(
          `https://kuwo.cn/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&pn=0&rn=1&all=test`,
          { headers: { 'Referer': 'https://kuwo.cn/', 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!resp.ok) { result['kuwo'] = false; return; }
        const data = await resp.json();
        result['kuwo'] = data?.abslist !== undefined;
      } catch { result['kuwo'] = false; }
    })());
  }

  await Promise.all(probes);
  return jsonResponse(result);
});

// ============================================================
// 调试：t2s 繁简转换测试
// ============================================================
router.get('/test/t2s', async (_req) => {
  const text = '陳小春 獨家記憶 取消资格';
  const result = toSimplified(text);
  return jsonResponse({ input: text, output: result });
});



// ============================================================
// 刮削
// ============================================================

// 批量刮削（异步+轮询，解决超时）
router.post('/scrape/batch', async (req) => {
  const body = parseBody(req);
  const ids: number[] = [...new Set(body.ids || [])];
  const force: boolean = body.force === true;
  if (!ids.length) return jsonResponse({ error: '请提供歌曲 ID 列表' }, 400);

  // 过滤已成功刮削的（强制模式跳过此检查）
  let skipIds: number[] = [];
  let newIds = ids;
  if (!force) {
    const doneIds = await getScrapedDone();
    skipIds = ids.filter(id => doneIds.has(id));
    newIds = ids.filter(id => !doneIds.has(id));
  }
  songloft.log.info(`[batch] 总${ids.length}首${force?'(强制)':''}, 已刮过${skipIds.length}首跳过, 待刮${newIds.length}首`);

  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const task = {
    ids: newIds, current: 0, total: newIds.length,
    results: [] as any[], success: 0, skipped: 0, skippedIds: [] as number[],
    failed: 0, failedIds: [] as number[], status: 'running' as const,
  };
  batchTasks.set(taskId, task);

  // 异步执行
  setTimeout(async () => {
    const cfg = await loadConfig();
    for (const songId of task.ids) {
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
          if (ws === 'written' || ws === 'unchanged' || ws === 'skipped') {
            task.success++;
            await markScrapedDone(songId);
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

  return jsonResponse({ taskId, status: 'started', total: newIds.length, skipped: skipIds.length });
});

// 批量进度查询
router.get('/scrape/batch/progress', async (req) => {
  const q = (req as any).query || '';
  const taskId = q.match(/taskId=([^&]+)/)?.[1];
  if (!taskId) return jsonResponse({ error: '缺少 taskId' }, 400);
  const task = batchTasks.get(taskId);
  if (!task) return jsonResponse({ error: '任务不存在' }, 404);
  const latest = task.results[task.results.length - 1];
  if (task.status === 'done') {
    setTimeout(() => batchTasks.delete(taskId), 60000);
  }
  return jsonResponse({
    status: task.status,
    current: task.current,
    total: task.total,
    success: task.success,
    skipped: task.skipped,
    failed: task.failed,
    lastLog: latest ? `${latest.artist} - ${latest.title} | ${latest.source} | ${latest.fileWriteStatus}` : null,
    loggedCount: task.results.length + task.skippedIds.length + task.failedIds.length,
    results: task.results,
    skippedIds: task.skippedIds.length ? task.skippedIds : undefined,
    failedIds: task.failedIds.length ? task.failedIds : undefined,
  });
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
  await markScrapedDone(songId);
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

// 清除歌曲中已嵌入的封面（解决老版本损坏封面无法覆盖的问题）
router.post('/cover/clear/:id', async (req, params) => {
  const songId = parseInt(params?.id || '0', 10);
  if (!songId) return jsonResponse({ error: '无效的歌曲 ID' }, 400);

  songloft.log.info(`[api] 清除封面: songId=${songId}`);
  const result = await clearCover(songId);
  if (result === 'failed') {
    return jsonResponse({ error: '封面清除失败', songId }, 500);
  }
  return jsonResponse({ status: 'ok', file_write: result, songId });
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
    // 构建带认证的封面 URL（本地 cover 用相对路径 + access_token，外链直接用）
    let coverUrl = '';
    if (s.cover_url) {
      if (s.cover_url.startsWith('http://') || s.cover_url.startsWith('https://')) {
        coverUrl = s.cover_url;
      } else {
        coverUrl = `${s.cover_url}?access_token=${token}`;
      }
    }
    return jsonResponse({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      album: s.album || '',
      cover_url: coverUrl,
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
    const limit = parseInt(params.get('limit') || '10000', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    let songs;
    if (keyword) {
      songs = await songloft.songs.search(keyword);
    } else {
      songs = await songloft.songs.list({ limit, offset });
    }

    let token = '';
    try { token = await songloft.plugin.getToken(); } catch (e) {}

    const items = songs.map((s: any) => {
      let cUrl = (s as any).cover_url || '';
      if (cUrl && !cUrl.startsWith('http://') && !cUrl.startsWith('https://')) {
        const sep = cUrl.includes('?') ? '&' : '?';
        cUrl = `${cUrl}${sep}access_token=${token}`;
      }
      return {
        id: s.id,
        title: s.title || '',
        artist: s.artist || '',
        album: s.album || '',
        type: s.type || '',
        file_path: s.file_path || '',
        format: s.format || '',
        duration: s.duration || 0,
        cover_url: cUrl,
        lyrics: (s as any).lyrics || '',
        genre: (s as any).genre || '',
      };
    });

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
    const arr = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
    return jsonResponse(arr);
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

// 清除已刮削标记
router.get('/storage/scraped', async (_req) => {
  try {
    const done = await getScrapedDone();
    return jsonResponse([...done]);
  } catch (e: any) {
    return jsonResponse({ error: e.message || String(e) }, 500);
  }
});
router.delete('/storage/scraped', async (_req) => {
  try {
    await songloft.storage.delete('scraped_done');
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
  // 埋点统计（异步，不阻塞启动）
  reportStats();
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
