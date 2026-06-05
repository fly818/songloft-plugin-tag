/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// fpcalc 跨平台动态下载 + 调用模块
// ============================================================

/** Chromaprint fpcalc 各平台下载源 */
const FPCALC_VERSION = '1.5.1';
const FPCALC_BASE = `https://github.com/acoustid/chromaprint/releases/download/v${FPCALC_VERSION}`;

interface PlatformInfo {
  os: string;
  arch: string;
  ext: string;       // 压缩包扩展名
  binName: string;   // 解压后的二进制文件名
}

function detectPlatform(): PlatformInfo {
  // QuickJS 环境下通过 navigator 或 os 模块检测（保守兜底）
  let os = 'linux';
  let arch = 'x86_64';

  // 尝试从现有信息推断
  if (typeof navigator !== 'undefined') {
    const ua = (navigator as any).userAgent || '';
    if (ua.includes('Win')) os = 'windows';
    else if (ua.includes('Mac')) os = 'macos';
    else if (ua.includes('Linux')) os = 'linux';
  }

  // 架构检测（保守默认 x86_64）
  // QuickJS 环境下无法直接获取，由用户手动选择或自动尝试
  const platformMap: Record<string, PlatformInfo> = {
    'linux-x86_64':   { os: 'linux',   arch: 'x86_64',  ext: '.tar.gz', binName: 'fpcalc' },
    'linux-aarch64':  { os: 'linux',   arch: 'aarch64', ext: '.tar.gz', binName: 'fpcalc' },
    'macos-x86_64':   { os: 'macos',   arch: 'x86_64',  ext: '.tar.gz', binName: 'fpcalc' },
    'macos-arm64':    { os: 'macos',   arch: 'arm64',   ext: '.tar.gz', binName: 'fpcalc' },
    'windows-x86_64': { os: 'windows', arch: 'x86_64',  ext: '.zip',    binName: 'fpcalc.exe' },
  };

  // 构建 key 并查找
  const key = `${os}-${arch}`;
  return platformMap[key] || platformMap['linux-x86_64'];
}

function getDownloadUrl(info: PlatformInfo): string {
  const platformTag = `${info.os}-${info.arch}`;
  return `${FPCALC_BASE}/chromaprint-fpcalc-${FPCALC_VERSION}-${platformTag}${info.ext}`;
}

/**
 * 检查 fpcalc 是否已安装可用
 */
export async function isFpcalcAvailable(): Promise<boolean> {
  try {
    // command.exists 只查插件 bin/，试运行更可靠（覆盖系统PATH）
    const r = await songloft.command.exec('fpcalc', ['-version'], { timeout: 5000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 下载并安装 fpcalc
 * 返回 { success, error? }
 */
export async function installFpcalc(): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. 已安装
    if (await songloft.command.exists('fpcalc')) {
      songloft.log.info('[fpcalc] 已可用，无需安装');
      return { success: true };
    }
    // 2. 尝试 chmod（bin/ 已有但没权限）
    try { await songloft.command.exec('chmod', ['+x', 'fpcalc']); } catch { /* ok */ }
    if (await songloft.command.exists('fpcalc')) {
      songloft.log.info('[fpcalc] 本地安装完成');
      return { success: true };
    }
    // 3. Alpine: apk add chromaprint
    try {
      await songloft.command.exec('apk', ['add', '--no-cache', 'chromaprint']);
      if (await songloft.command.exists('fpcalc')) {
        songloft.log.info('[fpcalc] apk 安装完成');
        return { success: true };
      }
    } catch { /* 非 Alpine 环境 */ }

    // 4. 网络下载（Debian/Ubuntu/macOS/Windows）
    const info = detectPlatform();
    const url = getDownloadUrl(info);
    songloft.log.info(`[fpcalc] 下载: ${url}`);
    await songloft.command.download(url, `fpcalc${info.ext}`);
    if (info.ext === '.tar.gz') {
      await songloft.command.exec('tar', ['-xzf', `fpcalc${info.ext}`, '--strip-components=1']);
    } else if (info.ext === '.zip') {
      await songloft.command.exec('unzip', ['-o', `fpcalc${info.ext}`]);
    }
    try { await songloft.command.deleteBin(`fpcalc${info.ext}`); } catch { /* ok */ }
    if (info.os !== 'windows') {
      await songloft.command.exec('chmod', ['+x', info.binName]);
    }
    songloft.log.info('[fpcalc] 下载安装完成');
    return { success: true };
  } catch (e: any) {
    songloft.log.error(`[fpcalc] 安装失败: ${e.message || e}`);
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 提取音频指纹
 * 返回 { fingerprint, duration } 或 null
 */
export async function extractFingerprint(filePath: string): Promise<{
  fingerprint: string;
  duration: number;
} | null> {
  try {
    const result = await songloft.command.exec('fpcalc', ['-json', '/app/' + filePath], { timeout: 15000 });
    if (result.exitCode !== 0) {
      songloft.log.warn(`[fpcalc] 执行失败 (exit=${result.exitCode}): ${result.stderr}`);
      return null;
    }
    const data = JSON.parse(result.stdout);
    if (!data.fingerprint) {
      songloft.log.warn('[fpcalc] 返回数据缺少 fingerprint');
      return null;
    }
    return {
      fingerprint: data.fingerprint,
      duration: data.duration || 0,
    };
  } catch (e: any) {
    songloft.log.warn(`[fpcalc] 调用异常: ${e.message || e}`);
    return null;
  }
}

/**
 * 获取当前平台信息（供 UI 展示）
 */
export function getPlatformInfo(): { os: string; arch: string; downloadUrl: string } {
  const info = detectPlatform();
  return {
    os: info.os,
    arch: info.arch,
    downloadUrl: getDownloadUrl(info),
  };
}
