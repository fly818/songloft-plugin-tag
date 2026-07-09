/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 熔断器 — 数据源连续失败后自动熔断，避免无效请求
// ============================================================

interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number;
}

const states: Record<string, CircuitState> = {};
const FAILURE_THRESHOLD = 10;   // 连续失败 10 次后熔断
const RECOVERY_TIMEOUT = 60000; // 熔断 60 秒

/**
 * 记录失败
 */
export function circuitFailure(source: string): void {
  const now = Date.now();
  let s = states[source];
  if (!s) {
    s = { failures: 0, lastFailure: 0, openUntil: 0 };
    states[source] = s;
  }
  s.failures++;
  s.lastFailure = now;
  if (s.failures >= FAILURE_THRESHOLD) {
    s.openUntil = now + RECOVERY_TIMEOUT;
    songloft.log.warn(`[circuit] ${source} 熔断 ${RECOVERY_TIMEOUT / 1000}s (连续失败 ${s.failures} 次)`);
  }
}

/**
 * 记录成功
 */
export function circuitSuccess(source: string): void {
  const s = states[source];
  if (s) {
    s.failures = 0;
    s.openUntil = 0;
  }
}

/**
 * 检查是否熔断
 */
export function circuitIsOpen(source: string): boolean {
  const s = states[source];
  if (!s) return false;
  if (Date.now() < s.openUntil) return true;
  // 恢复期：允许 1 次试探
  if (s.failures >= FAILURE_THRESHOLD && Date.now() >= s.openUntil) {
    s.failures = FAILURE_THRESHOLD - 1;
    return false;
  }
  return false;
}

/**
 * 获取熔断状态
 */
export function circuitStatus(): Record<string, { failures: number; open: boolean; openUntil: number }> {
  const result: Record<string, { failures: number; open: boolean; openUntil: number }> = {};
  for (const [k, v] of Object.entries(states)) {
    result[k] = {
      failures: v.failures,
      open: Date.now() < v.openUntil,
      openUntil: v.openUntil,
    };
  }
  return result;
}

/**
 * 重置熔断器
 */
export function circuitReset(source?: string): void {
  if (source) {
    delete states[source];
  } else {
    for (const k of Object.keys(states)) {
      delete states[k];
    }
  }
}
