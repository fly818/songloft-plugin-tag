/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 刮削源客户端
// ============================================================

import { scoreMatch } from './scoring';

import { ModeOfOperation, utils } from 'aes-js';

// ---- UTF-8 解码（atob 后在 QuickJS 中将二进制字节串转为 Unicode） ----
function utf8Decode(bytes: string): string {
  let r = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes.charCodeAt(i);
    if (b1 < 0x80) {
      r += String.fromCharCode(b1);
      i += 1;
    } else if ((b1 & 0xE0) === 0xC0 && i + 1 < bytes.length) {
      r += String.fromCharCode(((b1 & 0x1F) << 6) | (bytes.charCodeAt(i + 1) & 0x3F));
      i += 2;
    } else if ((b1 & 0xF0) === 0xE0 && i + 2 < bytes.length) {
      r += String.fromCharCode(((b1 & 0x0F) << 12) | ((bytes.charCodeAt(i + 1) & 0x3F) << 6) | (bytes.charCodeAt(i + 2) & 0x3F));
      i += 3;
    } else {
      i += 1; // 跳过非法字节
    }
  }
  return r;
}

// ---- SSRF 防护：内网地址拦截 ----
// 提取 URL 中的 hostname（纯字符串解析，不依赖 URL 构造函数）
// 支持 IPv6 方括号地址（如 http://[::1]/）
function extractHostname(url: string): string {
  const m = url.match(/^https?:\/\/(?:\[([^\]]+)\]|([^\/:?#]+))/);
  return m ? (m[1] || m[2]).toLowerCase() : '';
}

// 内网/保留地址匹配（正则，无需 DNS）
const BLOCKED_HOSTNAME = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|0:0:0:0:0:0:0:1)$/i;
const BLOCKED_IP_RANGE = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/;

function isHostnameAllowed(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;          // 仅允许 HTTP(S)
  const host = extractHostname(url);
  if (!host) return false;                               // 空 host 拒绝
  if (BLOCKED_HOSTNAME.test(host)) return false;         // localhost / 127.x / ::1 / 0.0.0.0
  if (BLOCKED_IP_RANGE.test(host)) return false;         // 10.x / 172.16-31 / 192.168 / 169.254
  return true;
}

// ---- 语言检测（Unicode 范围统计）----
function detectLanguage(text: string): string {
  if (!text) return "unknown";
  let cjk = 0, lat = 0, kana = 0, hangul = 0, other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x20000 && c <= 0x2A6DF)) cjk++;
    else if ((c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF)) kana++;
    else if (c >= 0xAC00 && c <= 0xD7AF) hangul++;
    else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0xC0 && c <= 0x24F)) lat++;
    else if (c > 0x7F) other++;
  }
  const total = cjk + kana + hangul + lat + other || 1;
  if (cjk / total > 0.3) return kana / total > 0.1 ? "ja" : "zh";
  if (kana / total > 0.3) return "ja";
  if (hangul / total > 0.3) return "ko";
  if (lat / total > 0.5) return "en";
  return "unknown";
}

// ---- 模板变量系统（${...} 语法）----
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_: string, key: string) => vars[key.trim()] || "");
}

// ----
// ---- 指数退避重试（弱网减少失败率）----
async function fetchWithRetry(
  url: string,
  init?: any,
  retries = 2,
  baseDelay = 1000
): Promise<{ resp: any; ok: boolean }> {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, init);
      return { resp, ok: true };
    } catch (e: any) {
      if (i === retries) return { resp: null, ok: false };
      const delay = baseDelay * Math.pow(2, i);
      songloft.log.info(`[retry] ${delay}ms 后重试 (${i + 1}/${retries + 1}): ${e.message || e}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { resp: null, ok: false };
}

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
  enable_kuwo: boolean;
  kuwo_api_url: string;           // 示例: https://kuwo.cn
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
  enable_kuwo: false,
  kuwo_api_url: '',
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

    const rt = await fetchWithRetry(`https://api.acoustid.org/v2/lookup?${qs}`, {
      headers: { 'User-Agent': 'songloft-plugin-tag/1.0' },
    });
    if (!rt.ok) return [];
    const resp = rt.resp;

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
    const rt = await fetchWithRetry(
      `https://musicbrainz.org/ws/2/recording/${recordingId}?inc=artists+releases&fmt=json`,
      { headers: { 'User-Agent': 'songloft-plugin-tag/1.0' } }
    );
    if (!rt.ok) return null;
    const resp = rt.resp;
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

// ---- 网易云音乐 eapi 加密（基于 aes-js）----
function eapiEncrypt(urlPath: string, body: Record<string, any>): string {
  const json = JSON.stringify(body);
  const message = 'nobody' + urlPath + 'use' + json + 'md5forencrypt';
  // Pure TS MD5
  function md5(s: string): string {
    function r(v: number, n: number): number { return (v << n) | (v >>> (32 - n)) }
    function cm(q: number, a: number, b: number, x: number, s: number, t: number): number { return r((a + q + x + t) | 0, s) + b }
    function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cm((b & c) | (~b & d), a, b, x, s, t) }
    function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cm((b & d) | (c & ~d), a, b, x, s, t) }
    function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cm(b ^ c ^ d, a, b, x, s, t) }
    function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cm(c ^ (b | ~d), a, b, x, s, t) }
    // Use UTF-8 bytes for proper handling of Chinese characters
    const utf8 = utils.utf8.toBytes(s);
    const q: number[] = []; for (let i = 0; i < utf8.length; i++) q.push(utf8[i]);
    const n = q.length, t = n % 64, p = t < 56 ? 56 - t : 120 - t;
    q.push(128); for (let i = 0; i < p - 1; i++) q.push(0);
    const bl = n * 8; for (let i = 0; i < 4; i++) q.push((bl >>> (i * 8)) & 0xff);
    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    for (let i = 0; i < q.length; i += 64) {
      const w: number[] = []; for (let j = 0; j < 16; j++) w[j] = q[i + j * 4] | (q[i + j * 4 + 1] << 8) | (q[i + j * 4 + 2] << 16) | (q[i + j * 4 + 3] << 24);
      let aa = a, bb = b, cc = c, dd = d;
      a = ff(a,b,c,d,w[0],7,0xd76aa478);d=ff(d,a,b,c,w[1],12,0xe8c7b756);c=ff(c,d,a,b,w[2],17,0x242070db);b=ff(b,c,d,a,w[3],22,0xc1bdceee);
      a = ff(a,b,c,d,w[4],7,0xf57c0faf);d=ff(d,a,b,c,w[5],12,0x4787c62a);c=ff(c,d,a,b,w[6],17,0xa8304613);b=ff(b,c,d,a,w[7],22,0xfd469501);
      a = ff(a,b,c,d,w[8],7,0x698098d8);d=ff(d,a,b,c,w[9],12,0x8b44f7af);c=ff(c,d,a,b,w[10],17,0xffff5bb1);b=ff(b,c,d,a,w[11],22,0x895cd7be);
      a = ff(a,b,c,d,w[12],7,0x6b901122);d=ff(d,a,b,c,w[13],12,0xfd987193);c=ff(c,d,a,b,w[14],17,0xa679438e);b=ff(b,c,d,a,w[15],22,0x49b40821);
      a = gg(a,b,c,d,w[1],5,0xf61e2562);d=gg(d,a,b,c,w[6],9,0xc040b340);c=gg(c,d,a,b,w[11],14,0x265e5a51);b=gg(b,c,d,a,w[0],20,0xe9b6c7aa);
      a = gg(a,b,c,d,w[5],5,0xd62f105d);d=gg(d,a,b,c,w[10],9,0x02441453);c=gg(c,d,a,b,w[15],14,0xd8a1e681);b=gg(b,c,d,a,w[4],20,0xe7d3fbc8);
      a = gg(a,b,c,d,w[9],5,0x21e1cde6);d=gg(d,a,b,c,w[14],9,0xc33707d6);c=gg(c,d,a,b,w[3],14,0xf4d50d87);b=gg(b,c,d,a,w[8],20,0x455a14ed);
      a = gg(a,b,c,d,w[13],5,0xa9e3e905);d=gg(d,a,b,c,w[2],9,0xfcefa3f8);c=gg(c,d,a,b,w[7],14,0x676f02d9);b=gg(b,c,d,a,w[12],20,0x8d2a4c8a);
      a = hh(a,b,c,d,w[5],4,0xfffa3942);d=hh(d,a,b,c,w[8],11,0x8771f681);c=hh(c,d,a,b,w[11],16,0x6d9d6122);b=hh(b,c,d,a,w[14],23,0xfde5380c);
      a = hh(a,b,c,d,w[1],4,0xa4beea44);d=hh(d,a,b,c,w[4],11,0x4bdecfa9);c=hh(c,d,a,b,w[7],16,0xf6bb4b60);b=hh(b,c,d,a,w[10],23,0xbebfbc70);
      a = hh(a,b,c,d,w[13],4,0x289b7ec6);d=hh(d,a,b,c,w[0],11,0xeaa127fa);c=hh(c,d,a,b,w[3],16,0xd4ef3085);b=hh(b,c,d,a,w[6],23,0x04881d05);
      a = hh(a,b,c,d,w[9],4,0xd9d4d039);d=hh(d,a,b,c,w[12],11,0xe6db99e5);c=hh(c,d,a,b,w[15],16,0x1fa27cf8);b=hh(b,c,d,a,w[2],23,0xc4ac5665);
      a = ii(a,b,c,d,w[0],6,0xf4292244);d=ii(d,a,b,c,w[7],10,0x432aff97);c=ii(c,d,a,b,w[14],15,0xab9423a7);b=ii(b,c,d,a,w[5],21,0xfc93a039);
      a = ii(a,b,c,d,w[12],6,0x655b59c3);d=ii(d,a,b,c,w[3],10,0x8f0ccc92);c=ii(c,d,a,b,w[10],15,0xffeff47d);b=ii(b,c,d,a,w[1],21,0x85845dd1);
      a = ii(a,b,c,d,w[8],6,0x6fa87e4f);d=ii(d,a,b,c,w[15],10,0xfe2ce6e0);c=ii(c,d,a,b,w[6],15,0xa3014314);b=ii(b,c,d,a,w[13],21,0x4e0811a1);
      a = ii(a,b,c,d,w[4],6,0xf7537e82);d=ii(d,a,b,c,w[11],10,0xbd3af235);c=ii(c,d,a,b,w[2],15,0x2ad7d2bb);b=ii(b,c,d,a,w[9],21,0xeb86d391);
      a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
    }
    function toH(n: number): string { const h = ((n >>> 0) & 0xff).toString(16); return h.length < 2 ? '0' + h : h }
    return toH(a) + toH(a >>> 8) + toH(a >>> 16) + toH(a >>> 24) + toH(b) + toH(b >>> 8) + toH(b >>> 16) + toH(b >>> 24) + toH(c) + toH(c >>> 8) + toH(c >>> 16) + toH(c >>> 24) + toH(d) + toH(d >>> 8) + toH(d >>> 16) + toH(d >>> 24);
  }
  const digest = md5(message);
  const data = urlPath + '-36cd479b6b5-' + json + '-36cd479b6b5-' + digest;
  // AES-128-ECB via aes-js (proven implementation) with manual PKCS7 padding
  const keyBytes = utils.utf8.toBytes('e82ckenh8dichen8');
  const dataBytes = utils.utf8.toBytes(data);
  // PKCS7 pad manually
  const padLen = 16 - (dataBytes.length % 16);
  const padded = new Uint8Array(dataBytes.length + padLen);
  padded.set(dataBytes);
  for (let i = dataBytes.length; i < padded.length; i++) padded[i] = padLen;
  const ecb = new ModeOfOperation.ecb(keyBytes);
  const encrypted = ecb.encrypt(padded);
  return utils.hex.fromBytes(encrypted).toUpperCase();
}

// ---- 网易云音乐 ----
export async function searchNetease(keyword: string, apiUrl: string): Promise<SearchResult[]> {
  if (!apiUrl || !isHostnameAllowed(apiUrl)) return [];
  // eapi endpoint: use encryption
  if (apiUrl.indexOf('eapi') > -1) {
    try {
      const body = { s: keyword, type: 1, limit: 3, offset: 0, total: true };
      const params = eapiEncrypt('/api/cloudsearch/pc', body);
      const rt = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': 'os=pc; appver=2.9.7; MUSIC_U=; __csrf=', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        body: 'params=' + encodeURIComponent(params),
      });
      if (!rt.ok) return [];
      const resp = rt.resp;
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
  // Legacy plain POST
  try {
    const rt = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0',
      },
      body: 's=' + encodeURIComponent(keyword) + '&type=1&limit=3',
    });
    if (!rt.ok) return [];
    const resp = rt.resp;
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
  if (!apiUrl || !isHostnameAllowed(apiUrl)) return [];
  try {
    const rt = await fetchWithRetry(
      `${apiUrl}?w=${encodeURIComponent(keyword)}&format=json&n=3`,
      {
        headers: {
          'Referer': 'https://y.qq.com',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );
    if (!rt.ok) return [];
    const resp = rt.resp;
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
  if (!apiUrl || !isHostnameAllowed(apiUrl)) return [];
  try {
    const rt = await fetchWithRetry(
      `${apiUrl}?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!rt.ok) return [];
    const resp = rt.resp;
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


// ---- 咪咕音乐（v1 API）----
const MIGU_KEY = [0x4A, 0x6B, 0x38, 0x71, 0x7A, 0x75, 0x65, 0x50, 0x69, 0x4A, 0x31, 0x71, 0x45, 0x33, 0x6D, 0x44, 0x59, 0x68, 0x4C, 0x51, 0x33, 0x54, 0x37, 0x33, 0x44, 0x74, 0x44, 0x6F, 0x41, 0x68, 0x4C, 0x50];

function miguDecrypt(data: Uint8Array): string {
  const seed = data[3];
  const result: number[] = [];
  const keyLen = MIGU_KEY.length;
  for (let i = 4; i < data.length; i++) {
    result.push((data[i] + seed - MIGU_KEY[(i - 4) % keyLen]) & 0xFF);
  }
  return String.fromCharCode(...result);
}

export async function searchMiGu(keyword: string): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams({
      text: keyword,
      pageNo: '1',
      pageSize: '10',
      isCopyright: '1',
      sort: '1',
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 1, mvSong: 0, bestShow: 1 }),
    });
    const rt = await fetchWithRetry(
      `https://c.musicapp.migu.cn/v1.0/content/search_all.do?${params.toString()}`,
      {
        headers: {
          'ua': 'Android_migu',
          'version': '6.8.8',
          'channel': '014021I',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://h5.nf.migu.cn/',
        },
      }
    );
    if (!rt.ok) return [];
    const resp = rt.resp;
    if (!resp.ok) return [];

    const raw = new Uint8Array(await resp.arrayBuffer());
    const isEncrypted = String.fromCharCode(raw[0], raw[1], raw[2]) === '\xAB\xCD\x01';
    const body = isEncrypted ? JSON.parse(miguDecrypt(raw)) : JSON.parse(new TextDecoder().decode(raw));

    const songs = body?.songResultData?.result || [];
    return songs.map((s: any) => ({
      artist: (s.singers || []).map((si: any) => si.name).join(',') || '',
      title: s.name || '',
      album: (s.albums || []).map((a: any) => a.name).join(',') || s.album || '',
      cover_url: s.imgItems?.[s.imgItems.length - 1]?.img ? `https://d.musicapp.migu.cn${s.imgItems[s.imgItems.length - 1].img}` : undefined,
      sourceId: s.contentId ? String(s.contentId) : undefined,
      release_date: undefined,
      score: 0,
      source: 'migu',
    }));
  } catch {
    return [];
  }
}

// ---- 酷我音乐（v2 API）----
export async function searchKuWo(keyword: string): Promise<SearchResult[]> {
  try {
    const url = `https://kuwo.cn/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1&pn=0&rn=10&all=${encodeURIComponent(keyword)}`;
    const rt = await fetchWithRetry(url, {
      headers: {
        'Referer': 'https://kuwo.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!rt.ok) return [];
    const resp = rt.resp;
    if (!resp.ok) return [];

    const data = await resp.json();
    const songs = data?.abslist || [];
    return songs.map((s: any) => ({
      artist: s.ARTIST || '',
      title: s.NAME || '',
      album: s.ALBUM || '',
      cover_url: s.hts_MVPIC || (s.web_albumpic_short ? `https://img1.kuwo.cn/star/albumcover/${s.web_albumpic_short}` : undefined),
      sourceId: s.MUSICRID ? String(s.MUSICRID) : undefined,
      release_date: undefined,
      score: 0,
      source: 'kuwo',
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
        return utf8Decode(atob(data.content));
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

  // 并发去国内源搜索（与文本兜底一致的五源并发）
  const tasks: Promise<SearchResult[]>[] = [];

  const searchWithScoring = async (fn: (kw: string, url: string) => Promise<SearchResult[]>, url: string, sourceName: string) => {
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
  };

  const enrichTasks: Promise<void>[] = [];
  if (cfg.enable_netease && cfg.netease_api_url) {
    enrichTasks.push(searchWithScoring(searchNetease, cfg.netease_api_url, 'netease'));
  }
  if (cfg.enable_qqmusic && cfg.qqmusic_api_url) {
    enrichTasks.push(searchWithScoring(searchQQMusic, cfg.qqmusic_api_url, 'qqmusic'));
  }
  if (cfg.enable_kugou && cfg.kugou_api_url) {
    enrichTasks.push(searchWithScoring(searchKuGou, cfg.kugou_api_url, 'kugou'));
  }
  // 咪咕（需签名）和酷我（无需配置项），按开关启用
  enrichTasks.push((async () => {
    try {
      const results = await searchMiGu(keyword);
      for (const r of results) { r.score = scoreMatch(candidate, r); }
      if (results.length > 0) songloft.log.info(`[enrich] migu 返回 ${results.length} 条`);
      allResults.push(...results);
    } catch (e: any) { songloft.log.warn(`[enrich] migu 搜索异常: ${e.message || e}`); }
  })());
  if (cfg.enable_kuwo) {
    enrichTasks.push((async () => {
      try {
        const results = await searchKuWo(keyword);
        for (const r of results) { r.score = scoreMatch(candidate, r); }
        if (results.length > 0) songloft.log.info(`[enrich] kuwo 返回 ${results.length} 条`);
        allResults.push(...results);
      } catch (e: any) { songloft.log.warn(`[enrich] kuwo 搜索异常: ${e.message || e}`); }
    })());
  }

  await Promise.allSettled(enrichTasks);

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
// CD 翻录歌曲常见垃圾元数据：优先用文件名
const GARBAGE_TITLE = /^(?:trad|track|unknown|audio\s*track|cd\s*track|data\s*track|\d+)$/i;
const GARBAGE_ARTIST = /^(?:unknown|various|未知|佚名)$/i;

export function extractCandidate(filePath: string, existingTags?: { artist?: string; title?: string }): { artist: string; title: string } {
  // 清洗 DB 元数据
  if (existingTags?.artist && existingTags?.title) {
    const art = cleanFilenameNoise(existingTags.artist);
    const tit = cleanFilenameNoise(existingTags.title);
    // CD 翻录的垃圾元数据（如标题是"Track 01"、"trad 1"），退回到文件名提取
    if (!GARBAGE_TITLE.test(tit) && !GARBAGE_ARTIST.test(art)) {
      return { artist: art, title: tit };
    }
  }

  // 从文件名提取 "艺术家 - 歌名" 模式
  const fileName = cleanFilenameNoise(
    filePath.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '')
  );

  const match = fileName.match(/^(.+?)\s*-\s*(.+?)(?:\s*\(.*?\))?\s*$/);
  if (match) {
    return { artist: cleanFilenameNoise(match[1]), title: cleanFilenameNoise(match[2]) };
  }

  return { artist: '', title: fileName };
}

/** 剥离音质/版本标签，提高搜索匹配率 */
function cleanFilenameNoise(s: string): string {
  return s
    .replace(/\[(?:FLAC|MP3|WAV|APE|WMA|OGG|320k?|128k?|192k?|256k?|HQ|SQ|Hi[-\s]?Res|无损|高音质|MV)\]/gi, '')
    .replace(/\((?:Live|Remix|Cover|伴奏|纯音乐|Instrumental|Acoustic|Demo|Bonus\s?Track)\)/gi, '')
    .replace(/\s*(?:feat\.?|ft\.?)\s*.+?(?:\s*[-–—]\s*|$)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
