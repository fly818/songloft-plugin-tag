/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 文本相似度评分（Ratcliff/Obershelp 算法）
// ============================================================

/**
 * 计算两个字符串的最长公共子串长度
 */
function longestCommonSubstring(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  // 用滚动数组优化空间
  let maxLen = 0;
  const prev = new Array(lenB + 1).fill(0);

  for (let i = 1; i <= lenA; i++) {
    const curr = new Array(lenB + 1).fill(0);
    for (let j = 1; j <= lenB; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) maxLen = curr[j];
      }
    }
    // 滚动
    for (let j = 0; j <= lenB; j++) {
      prev[j] = curr[j];
    }
  }
  return maxLen;
}

/**
 * Ratcliff/Obershelp 相似度（递归匹配最长公共子串）
 * Python difflib.SequenceMatcher.ratio() 的 JS 实现
 * 返回值 0.0 ~ 1.0
 */
export function sequenceSimilarity(a: string, b: string): number {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;
  if (a === b) return 1.0;

  const totalLen = a.length + b.length;
  if (totalLen === 0) return 1.0;

  const matches = matchingBlocks(a, b);
  const matchLen = matches.reduce((sum, m) => sum + m.length, 0);
  return (2.0 * matchLen) / totalLen;
}

interface MatchBlock {
  aStart: number;
  bStart: number;
  length: number;
}

function matchingBlocks(a: string, b: string): MatchBlock[] {
  const blocks: MatchBlock[] = [];
  _findMatchingBlocks(a, 0, a.length, b, 0, b.length, blocks);

  // 按 aStart 排序
  blocks.sort((x, y) => x.aStart - y.aStart);

  // 合并相邻/重叠的块
  const merged: MatchBlock[] = [];
  for (const block of blocks) {
    if (merged.length === 0) {
      merged.push(block);
      continue;
    }
    const last = merged[merged.length - 1];
    const lastAEnd = last.aStart + last.length;
    const lastBEnd = last.bStart + last.length;
    if (block.aStart <= lastAEnd && block.bStart <= lastBEnd) {
      // 重叠，扩展
      const newLen = Math.max(lastAEnd, block.aStart + block.length) - last.aStart;
      const maxLen = Math.max(a.length - last.aStart, b.length - last.bStart);
      last.length = Math.min(newLen, maxLen);
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function _findMatchingBlocks(
  a: string, aLo: number, aHi: number,
  b: string, bLo: number, bHi: number,
  blocks: MatchBlock[]
): void {
  // 找到 a[aLo:aHi] 和 b[bLo:bHi] 的最长公共子串
  let bestLen = 0;
  let bestA = -1;
  let bestB = -1;

  // 用 LCS 的 DP 来找最长匹配（单次调用可以更高效但此实现够用）
  const subA = a.substring(aLo, aHi);
  const subB = b.substring(bLo, bHi);
  const dp: number[][] = Array.from({ length: subA.length + 1 }, () =>
    new Array(subB.length + 1).fill(0)
  );

  for (let i = 1; i <= subA.length; i++) {
    for (let j = 1; j <= subB.length; j++) {
      if (subA[i - 1] === subB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > bestLen) {
          bestLen = dp[i][j];
          bestA = aLo + i - bestLen;
          bestB = bLo + j - bestLen;
        }
      }
    }
  }

  if (bestLen > 0) {
    // 递归处理匹配块前后的部分
    _findMatchingBlocks(a, aLo, bestA, b, bLo, bestB, blocks);
    blocks.push({ aStart: bestA, bStart: bestB, length: bestLen });
    _findMatchingBlocks(
      a, bestA + bestLen, aHi,
      b, bestB + bestLen, bHi,
      blocks
    );
  }
}

// ============================================================
// 刮削源权重
// ============================================================

export const SOURCE_WEIGHTS: Record<string, number> = {
  acoustid: 1.5,
  netease: 1.0,
  qqmusic: 0.95,
  kugou: 0.85,
  discogs: 0.8,
};

/**
 * 计算候选标签与搜索结果的匹配得分
 * 公式: 0.4 × artist_similarity + 0.6 × title_similarity
 * 再乘以源权重
 */
export function scoreMatch(
  candidate: { artist: string; title: string },
  result: { artist: string; title: string; source: string }
): number {
  const artistCand = (candidate.artist || '').trim().toLowerCase();
  const titleCand = (candidate.title || '').trim().toLowerCase();
  const artistRes = (result.artist || '').trim().toLowerCase();
  const titleRes = (result.title || '').trim().toLowerCase();

  if (!artistRes || !titleRes) return 0.0;

  const artistSim = sequenceSimilarity(artistCand, artistRes);
  const titleSim = sequenceSimilarity(titleCand, titleRes);
  const rawScore = 0.4 * artistSim + 0.6 * titleSim;
  const weight = SOURCE_WEIGHTS[result.source] || 0.8;
  return rawScore * weight;
}

/**
 * 判定分数是否达标
 */
export const SCORE_THRESHOLD = 0.8;

export function isScoreAcceptable(score: number): boolean {
  return score >= SCORE_THRESHOLD;
}
