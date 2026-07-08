/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 刮削引擎 — 编排 AcoustID + 多源文本搜索 + 评分择优 + 写回
// ============================================================

import {
  searchAcoustid,
  searchNetease,
  searchQQMusic,
  searchKuGou,
  searchMiGu,
  searchKuWo,
  enrichFromChineseSources,
  extractCandidate,
  extractCandidates,
  loadConfig,
  type ScraperConfig,
  type SearchResult,
} from './sources';
import { scoreMatch } from './scoring';
import { toSimplified } from './t2s';
import { cacheGet, cacheSet, cacheCleanup } from './cache';
import { rateLimitWait } from './ratelimit';

export interface ScrapeResult {
  songId: number;
  artist: string;
  title: string;
  album: string;
  lyrics?: string;
  cover_url?: string;
  cover_data?: string;  // base64
  source: string;
  score: number;
  fileWriteStatus?: string;
  /** 各源得分明细 */
  sourceScores?: Record<string, number>;
}

export interface ScrapePreview {
  songId: number;
  results: ScrapeResult[];
  /** 最佳结果 */
  best?: ScrapeResult;
}

/**
 * 单曲刮削（写入模式）
 */
export async function scrapeSong(songId: number, config?: ScraperConfig): Promise<ScrapeResult | null> {
  const cfg = config || await loadConfig();
  const result = await doScrape(songId, cfg);
  if (!result) return null;

  // 写回标签
  const writeResult = await writeTags(songId, result);
  result.fileWriteStatus = writeResult;
  return result;
}

/**
 * 单曲刮削预览（不写入，返回匹配结果供 UI 展示）
 */
export async function previewScrape(songId: number, config?: ScraperConfig): Promise<ScrapeResult | null> {
  const cfg = config || await loadConfig();
  return doScrape(songId, cfg);
}

/**
 * 批量刮削
 */
export async function scrapeBatch(songIds: number[], config?: ScraperConfig): Promise<{
  results: ScrapeResult[];
  success: number;
  skipped: number;
  skippedIds: number[];
  failed: number;
  failedIds: number[];
}> {
  const cfg = config || await loadConfig();
  const results: ScrapeResult[] = [];
  let success = 0;
  let skipped = 0;
  const skippedIds: number[] = [];
  let failed = 0;
  const failedIds: number[] = [];

  for (const songId of songIds) {
    const result = await doScrape(songId, cfg);
    if (!result) {
      skipped++;
      skippedIds.push(songId);
      continue;
    }

    const writeResult = await writeTags(songId, result);
    result.fileWriteStatus = writeResult;
    results.push(result);

    if (writeResult === 'written' || writeResult === 'unchanged' || writeResult === 'skipped') {
      success++;
    } else {
      failed++;
      failedIds.push(songId);
    }
  }

  // 批量刮削完成后清理过期缓存
  cacheCleanup().catch(() => {});

  return { results, success, skipped, skippedIds, failed, failedIds };
}

// ============================================================
// 内部实现
// ============================================================

export async function doScrape(songId: number, cfg: ScraperConfig): Promise<ScrapeResult | null> {
  // 1. 获取歌曲信息
  const song = await songloft.songs.getById(songId);
  if (!song) {
    songloft.log.warn(`[scraper] 歌曲不存在: ${songId}`);
    return null;
  }

  const filePath = song.file_path || '';
  const candidates = extractCandidates(filePath, { artist: song.artist, title: song.title });

  // 繁体→简体，提高国内音源匹配率
  for (const c of candidates) {
    c.artist = toSimplified(c.artist);
    c.title = toSimplified(c.title);
  }

  const candidate = candidates[0];

  if (!candidate.title) {
    songloft.log.warn(`[scraper] 无法确定搜索关键词: ${songId}`);
    return null;
  }

  // 文本搜索：先用第一个候选词搜索，若得分不佳且有反向候选则重试
  let bestResult: ScrapeResult | null = null;
  let bestScore = -1;

  // 检查缓存
  const cacheKey = `${candidate.artist} ${candidate.title}`;
  const cached = await cacheGet<SearchResult>(candidate.artist, candidate.title);
  if (cached && cached.score >= cfg.score_threshold) {
    songloft.log.info(`[scraper] 缓存命中: ${cached.artist} - ${cached.title} (${cached.score.toFixed(2)})`);
    return buildResult(songId, cached, candidate, {});
  }

  for (let ci = 0; ci < candidates.length; ci++) {
    const c = candidates[ci];
    const keyword = `${c.artist} ${c.title}`.trim();
    songloft.log.info(`[scraper] 开始刮削: ${keyword} (songId=${songId}${ci > 0 ? ', 反向排序' : ''})`);

    // 2. 声纹优先（使用主程序已计算的指纹）
    if (!cfg.enable_acoustid) {
      songloft.log.info(`[scraper] AcoustID 未启用 (cfg.enable_acoustid=${cfg.enable_acoustid})`);
    } else if (!song.fingerprint) {
      songloft.log.info(`[scraper] AcoustID 跳过: 歌曲无指纹 (主程序扫描后异步计算，请稍后重试)`);
    } else {
      await rateLimitWait('acoustid');
      const acoustidResults = await searchAcoustid(song.fingerprint, song.fingerprint_duration || song.duration || 0, cfg.acoustid_api_key);
      if (acoustidResults.length > 0) {
        const best = acoustidResults.reduce((a, b) => a.score > b.score ? a : b);
        if (best.score > cfg.score_threshold) {
          songloft.log.info(`[scraper] 声纹匹配成功: ${best.artist} - ${best.title} (${best.score.toFixed(2)})`);

          best.artist = toSimplified(best.artist);
          best.title = toSimplified(best.title);
          best.album = toSimplified(best.album);

          const enrich = await enrichFromChineseSources(best.artist, best.title, c, cfg);
          if (enrich.cover_url) {
            best.cover_url = enrich.cover_url;
            songloft.log.info(`[scraper] 封面来自 ${enrich.source}: ${enrich.cover_url.substring(0, 60)}...`);
          }
          if (enrich.lyrics) {
            best.lyrics = enrich.lyrics;
          }

          return buildResult(songId, best, c, {});
        }
      }
    }

    // 3. 文本搜索兜底（多源并发）
    const sourceScores: Record<string, number> = {};
    const allResults: SearchResult[] = [];

    const addSourceResults = (results: SearchResult[], sourceName: string) => {
      let srcBestScore = 0;
      for (const r of results) {
        const s = scoreMatch({ ...c, duration: song.duration }, r);
        r.score = s;
        if (s > srcBestScore) srcBestScore = s;
      }
      sourceScores[sourceName] = srcBestScore;
      allResults.push(...results);
    };

    const tasks: Promise<{ results: SearchResult[]; source: string }>[] = [];

    if (cfg.enable_netease && cfg.netease_api_url) {
      tasks.push(rateLimitWait('netease').then(() => searchNetease(keyword, cfg.netease_api_url)).then(r => ({ results: r, source: 'netease' as const })));
    }
    if (cfg.enable_qqmusic && cfg.qqmusic_api_url) {
      tasks.push(rateLimitWait('qqmusic').then(() => searchQQMusic(keyword, cfg.qqmusic_api_url)).then(r => ({ results: r, source: 'qqmusic' as const })));
    }
    if (cfg.enable_kugou && cfg.kugou_api_url) {
      tasks.push(rateLimitWait('kugou').then(() => searchKuGou(keyword, cfg.kugou_api_url)).then(r => ({ results: r, source: 'kugou' as const })));
    }
    tasks.push(rateLimitWait('migu').then(() => searchMiGu(keyword)).then(r => ({ results: r, source: 'migu' as const })));
    if (cfg.enable_kuwo) {
      tasks.push(rateLimitWait('kuwo').then(() => searchKuWo(keyword)).then(r => ({ results: r, source: 'kuwo' as const })));
    }

    const settled = await Promise.allSettled(tasks);
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        addSourceResults(s.value.results, s.value.source);
      }
    }

    const logParts = Object.entries(sourceScores).map(([k, v]) => `${k}=${v.toFixed(2)}`);
    songloft.log.info(`[scraper] 文本刮削得分: ${logParts.join(', ') || '无结果'}`);

    // 选择本轮最佳
    let roundBest: SearchResult | null = null;
    let roundBestScore = -1;
    for (const r of allResults) {
      if (r.score > roundBestScore) {
        roundBestScore = r.score;
        roundBest = r;
      }
    }

    if (roundBest && roundBestScore > bestScore) {
      bestScore = roundBestScore;
      bestResult = buildResult(songId, roundBest, c, sourceScores);
    }

    // 首轮得分已够好，不再尝试反向排序
    if (bestScore >= cfg.score_threshold) break;
  }

  if (!bestResult || bestScore < cfg.score_threshold) {
    songloft.log.info(`[scraper] 最佳得分 ${bestScore.toFixed(2)} 低于阈值 ${cfg.score_threshold}，刮削失败`);
    return null;
  }

  // 写入缓存
  await cacheSet(candidate.artist, candidate.title, {
    artist: bestResult.artist,
    title: bestResult.title,
    album: bestResult.album,
    cover_url: bestResult.cover_url,
    lyrics: bestResult.lyrics,
    source: bestResult.source,
    score: bestResult.score,
  });

  songloft.log.info(`[scraper] 选用 ${bestResult.source} (${bestResult.score.toFixed(2)})`);
  return bestResult;
}

function buildResult(
  songId: number,
  best: SearchResult,
  candidate: { artist: string; title: string },
  sourceScores?: Record<string, number>
): ScrapeResult {
  return {
    songId,
    artist: best.artist || candidate.artist,
    title: best.title || candidate.title,
    album: best.album || '',
    lyrics: best.lyrics || '',
    cover_url: best.cover_url,
    source: best.source,
    score: best.score,
    sourceScores,
  };
}

/**
 * 调用宿主 API 将标签写入歌曲
 */
export async function writeTags(songId: number, result: ScrapeResult): Promise<string> {
  try {
    const token = await songloft.plugin.getToken();
    const hostUrl = await songloft.plugin.getHostUrl();

    // 封面直接传 URL 给后端下载（避免 QuickJS .text() 损坏二进制）
    const body: Record<string, string> = {
      title: result.title,
      artist: result.artist,
      album: result.album || '',
      lyrics: result.lyrics || '',
      cover_url: result.cover_url || '',
    };

    const resp = await fetch(`${hostUrl}/api/v1/songs/${songId}/tags`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      songloft.log.error(`[scraper] 标签写入失败 (HTTP ${resp.status}): ${errText}`);
      return 'failed';
    }

    const data = await resp.json();
    const fileWrite = data.file_write || 'unknown';
    songloft.log.info(`[scraper] 标签写入完成: ${result.artist} - ${result.title} (file=${fileWrite})`);
    return fileWrite;
  } catch (e: any) {
    songloft.log.error(`[scraper] 写入异常: ${e.message || e}`);
    return 'failed';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 清除歌曲中已嵌入的封面（解决老版本 base64 损坏封面无法覆盖的问题）
 * 传全部标签字段 + clear_cover=true 显式清空封面
 */
export async function clearCover(songId: number): Promise<string> {
  try {
    const token = await songloft.plugin.getToken();
    const hostUrl = await songloft.plugin.getHostUrl();

    // 先获取当前歌曲元数据
    const getResp = await fetch(`${hostUrl}/api/v1/songs/${songId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!getResp.ok) {
      songloft.log.error(`[scraper] 清除封面前获取歌曲信息失败 (HTTP ${getResp.status})`);
      return 'failed';
    }
    const song = await getResp.json();

    // 获取歌词内容
    let lyrics = '';
    if (song.lyric_url) {
      try {
        const lr = await fetch(`${hostUrl}${song.lyric_url}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (lr.ok) {
          const raw = await lr.text();
          try { lyrics = JSON.parse(raw).lyric || raw; } catch { lyrics = raw; }
        }
      } catch { /* ignore */ }
    }

    const body: Record<string, string | boolean> = {
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      lyrics: lyrics,
      clear_cover: true,
    };

    const resp = await fetch(`${hostUrl}/api/v1/songs/${songId}/tags`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      songloft.log.error(`[scraper] 封面清除失败 (HTTP ${resp.status}): ${errText}`);
      return 'failed';
    }

    const data = await resp.json();
    const fileWrite = data.file_write || 'unknown';
    songloft.log.info(`[scraper] 封面已清除: songId=${songId} (file=${fileWrite})`);
    return fileWrite;
  } catch (e: any) {
    songloft.log.error(`[scraper] 封面清除异常: ${e.message || e}`);
    return 'failed';
  }
}
