/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 刮削源客户端
// ============================================================

import { scoreMatch } from './scoring';

// ---- 配置接口 ----
export interface ScraperConfig {
  enable_acoustid: boolean;
  acoustid_api_key: string;       // 默认 'I5CvINoX9AI'
  enable_netease: boolean;
  netease_api_url: string;        // 示例: https://music.163.com/api/cloudsearch/pc
  enable_qqmusic: boolean;
  qqmusic_api_url: string;        // 示例: https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp
  enable_kugou: boolean;
  kugou_api_url: string;          // 示例: https://songsearch.kugou.com/song_search_v2
}

export const DEFAULT_CONFIG: ScraperConfig = {
  enable_acoustid: false,
  acoustid_api_key: '',
  enable_netease: false,
  netease_api_url: '',
  enable_qqmusic: false,
  qqmusic_api_url: '',
  enable_kugou: false,
  kugou_api_url: '',
};

// ---- 搜索结果类型 ----
export interface SearchResult {
  artist: string;
  title: string;
  album: string;
  cover_url?: string;
  lyrics?: string;
  release_date?: string;
  /** 源内 ID，用于查歌词（网易云 songId / QQ songmid / 酷狗 hash） */
  sourceId?: string;
  score: number;
  source: string;
}

// ---- AcoustID / MusicBrainz ----
// 使用主程序已计算的 Chromaprint fingerprint，无需插件自行安装 fpcalc。
export async function searchAcoustid(fingerprint: string, duration: number, apiKey: string): Promise<SearchResult[]> {
  // 防御：主程序 v2.6.3 指纹存为原始二进制，JSON 序列化损坏后体积巨大
  // 正常指纹 ~200 字符，损坏的二进制指纹会 >1000 字符，直接跳过避免 414
  if (!fingerprint || fingerprint.length > 1000) {
    songloft.log.warn(`[acoustid] 指纹异常(len=${fingerprint?.length||0})，可能是主程序二进制存储问题，降级到文本搜索`);
    return [];
  }

  try {
    const qs = `client=${encodeURIComponent(apiKey)}&duration=${Math.round(duration)}&fingerprint=${encodeURIComponent(fingerprint)}&meta=recordingids`;

    const resp = await fetch(`https://api.acoustid.org/v2/lookup?${qs}`, {
      headers: { 'User-Agent': 'songloft-plugin-tag/1.0' },
    });

    if (resp.status === 429) {
      songloft.log.warn('[acoustid] 限流，降级到文本搜索');
      return [];
    }
    if (!resp.ok) return [];

    const data = await resp.json();
    if (data.status !== 'ok') return [];

    const results: SearchResult[] = [];
    for (const result of (data.results || []).slice(0, 3)) {
      const recordings = result.recordings || [];
      if (recordings.length === 0) continue;

      const recId = recordings[0].id;
      if (!recId) continue;

      const mbResult = await fetchMusicBrainz(recId);
      if (mbResult) {
        results.push({
          ...mbResult,
          score: result.score || 0,
          source: 'acoustid',
        });
      }
    }
    return results;
  } catch (e: any) {
    songloft.log.warn(`[acoustid] 搜索失败: ${e.message || e}`);
    return [];
  }
}

async function fetchMusicBrainz(recordingId: string): Promise<{ artist: string; title: string; album: string } | null> {
  try {
    const resp = await fetch(
      `https://musicbrainz.org/ws/2/recording/${recordingId}?inc=artists+releases&fmt=json`,
      { headers: { 'User-Agent': 'songloft-plugin-tag/1.0' } }
    );
    if (!resp.ok) return null;

    const mb = await resp.json();
    const artist = mb['artist-credit']?.[0]?.artist?.name || mb['artist-credit']?.[0]?.name || '';
    const title = mb.title || '';

    let album = '';
    const releases = mb.releases || [];
    for (const release of releases) {
      if (release.status === 'Official') {
        album = release.title || '';
        break;
      }
    }
    if (!album && releases.length > 0) {
      album = releases[0].title || '';
    }

    if (artist && title) {
      return { artist, title, album };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- 网易云音乐 ----
export async function searchNetease(keyword: string, apiUrl: string): Promise<SearchResult[]> {
  if (!apiUrl) return [];
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0',
      },
      body: 's=' + encodeURIComponent(keyword) + '&type=1&limit=3',
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    const songs = data?.result?.songs || [];
    return songs.map((s: any) => ({
      artist: s.ar?.[0]?.name || '',
      title: s.name || '',
      album: s.al?.name || '',
      cover_url: s.al?.picUrl ? s.al.picUrl + '?param=500y500' : undefined,
      sourceId: s.id ? String(s.id) : undefined,
      release_date: undefined,
      score: 0,
      source: 'netease',
    }));
  } catch {
    return [];
  }
}

// ---- QQ 音乐 ----
export async function searchQQMusic(keyword: string, apiUrl: string): Promise<SearchResult[]> {
  if (!apiUrl) return [];
  try {
    const resp = await fetch(
      `${apiUrl}?w=${encodeURIComponent(keyword)}&format=json&n=3`,
      {
        headers: {
          'Referer': 'https://y.qq.com',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );
    if (!resp.ok) return [];

    const data = await resp.json();
    const songs = data?.data?.song?.list || [];
    return songs.map((s: any) => ({
      artist: s.singer?.[0]?.name || '',
      title: s.songname || '',
      album: s.albumname || '',
      cover_url: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.albummid}.jpg` : undefined,
      sourceId: s.songmid || undefined,
      release_date: undefined,
      score: 0,
      source: 'qqmusic',
    }));
  } catch {
    return [];
  }
}

// ---- 酷狗音乐 ----
export async function searchKuGou(keyword: string, apiUrl: string): Promise<SearchResult[]> {
  if (!apiUrl) return [];
  try {
    const resp = await fetch(
      `${apiUrl}?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!resp.ok) return [];

    const data = await resp.json();
    const songs = data?.data?.lists || [];
    return songs.map((s: any) => ({
      artist: s.SingerName || '',
      title: s.SongName || '',
      album: s.AlbumName || '',
      cover_url: s.AlbumImg?.replace(/\/{2,}/g, '/') || undefined,
      sourceId: s.Hash || s.FileHash || undefined,
      release_date: undefined,
      score: 0,
      source: 'kugou',
    }));
  } catch {
    return [];
  }
}

// ============================================================
// 歌词下载
// ============================================================

/** 网易云歌词 */
async function fetchLyricsNetease(songId: string): Promise<string> {
  try {
    const resp = await fetch(
      `https://music.163.com/api/song/lyric?id=${songId}&lv=1`,
      {
        headers: {
          'Referer': 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );
    if (!resp.ok) return '';
    const data = await resp.json();
    return data?.lrc?.lyric || data?.tlyric?.lyric || '';
  } catch {
    return '';
  }
}

/** QQ 音乐歌词 */
async function fetchLyricsQQ(songmid: string): Promise<string> {
  try {
    const resp = await fetch(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&format=json&nobase64=1`,
      {
        headers: {
          'Referer': 'https://y.qq.com',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );
    if (!resp.ok) return '';
    const data = await resp.json();
    return data?.lyric || '';
  } catch {
    return '';
  }
}

/** 酷狗歌词（需要 hash + album_id） */
async function fetchLyricsKuGou(hash: string, albumId?: string): Promise<string> {
  try {
    const aid = albumId || '';
    const resp = await fetch(
      `https://lyrics.kugou.com/download?ver=1&client=pc&hash=${hash}&album_id=${aid}&fmt=lrc`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!resp.ok) return '';
    const data = await resp.json();
    // 酷狗歌词接口返回 {content: "base64(lrc)", ...}
    if (data?.content) {
      try {
        return atob(data.content);
      } catch {
        return '';
      }
    }
    return '';
  } catch {
    return '';
  }
}

/** 根据搜索结果拉歌词 */
async function fetchLyricsForResult(r: SearchResult): Promise<string> {
  if (!r.sourceId) return '';
  switch (r.source) {
    case 'netease':
      return fetchLyricsNetease(r.sourceId);
    case 'qqmusic':
      return fetchLyricsQQ(r.sourceId);
    case 'kugou':
      return fetchLyricsKuGou(r.sourceId);
    default:
      return '';
  }
}

// ============================================================
// AcoustID 命中后用国内源富化封面 + 歌词
// ============================================================

export interface EnrichResult {
  cover_url?: string;
  lyrics?: string;
  source?: string;
}

/**
 * 用 AcoustID 匹配到的 artist+title 去已启用的国内源搜索，
 * 对返回结果评分，取最高分的封面 URL 和歌词。
 */
export async function enrichFromChineseSources(
  artist: string,
  title: string,
  candidate: { artist: string; title: string },
  cfg: ScraperConfig
): Promise<EnrichResult> {
  const keyword = `${artist} ${title}`.trim();
  if (!keyword) return {};

  const allResults: SearchResult[] = [];

  const addSource = async (
    fn: (kw: string, url: string) => Promise<SearchResult[]>,
    url: string,
    sourceName: string
  ) => {
    if (!url) return;
    try {
      const results = await fn(keyword, url);
      for (const r of results) {
        r.score = scoreMatch(candidate, r);
      }
      if (results.length > 0) {
        songloft.log.info(`[enrich] ${sourceName} 返回 ${results.length} 条`);
      }
      allResults.push(...results);
    } catch (e: any) {
      songloft.log.warn(`[enrich] ${sourceName} 搜索异常: ${e.message || e}`);
    }
    await sleep(50);
  };

  if (cfg.enable_netease && cfg.netease_api_url) {
    await addSource(searchNetease, cfg.netease_api_url, 'netease');
  }
  if (cfg.enable_qqmusic && cfg.qqmusic_api_url) {
    await addSource(searchQQMusic, cfg.qqmusic_api_url, 'qqmusic');
  }
  if (cfg.enable_kugou && cfg.kugou_api_url) {
    await addSource(searchKuGou, cfg.kugou_api_url, 'kugou');
  }

  // 选最高分
  let best: SearchResult | null = null;
  let bestScore = -1;
  for (const r of allResults) {
    if (r.score > bestScore) {
      bestScore = r.score;
      best = r;
    }
  }

  if (!best) {
    songloft.log.info('[enrich] 国内源无匹配，封面/歌词留空');
    return {};
  }

  songloft.log.info(`[enrich] 选用 ${best.source} (${bestScore.toFixed(2)})`);

  // 拉歌词
  let lyrics = '';
  if (best.sourceId) {
    try {
      lyrics = await fetchLyricsForResult(best);
      if (lyrics) {
        songloft.log.info(`[enrich] 歌词下载成功 (${best.source}, ${lyrics.length} 字)`);
      }
    } catch (e: any) {
      songloft.log.warn(`[enrich] 歌词下载失败: ${e.message || e}`);
    }
  }

  return {
    cover_url: best.cover_url,
    lyrics,
    source: best.source,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- 辅助：从文件名提取候选标签 ----
export function extractCandidate(filePath: string, existingTags?: { artist?: string; title?: string }): { artist: string; title: string } {
  // 优先用已有标签
  if (existingTags?.artist && existingTags?.title) {
    return { artist: existingTags.artist, title: existingTags.title };
  }

  // 从文件名提取 "艺术家 - 歌名" 模式
  const fileName = filePath.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
  const match = fileName.match(/^(.+?)\s*-\s*(.+?)(?:\s*\(.*?\))?\s*$/);
  if (match) {
    return { artist: match[1].trim(), title: match[2].trim() };
  }

  return { artist: '', title: fileName };
}

// ---- 从配置读取/保存 ----
const CONFIG_KEY = 'scraper_config';

export async function loadConfig(): Promise<ScraperConfig> {
  try {
    const raw = await songloft.storage.get(CONFIG_KEY);
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_CONFIG, ...raw };
    }
    if (raw && typeof raw === 'string') {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}
export async function saveConfig(config: ScraperConfig): Promise<void> {
  await songloft.storage.set(CONFIG_KEY, JSON.stringify(config));
}
