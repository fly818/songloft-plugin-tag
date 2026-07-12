/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 并发控制：简单信号量
// ============================================================

export function createSemaphore(max: number) {
  let current = 0;
  const queue: (() => void)[] = [];
  return {
    async acquire() {
      if (current < max) { current++; return; }
      await new Promise<void>(r => queue.push(r));
    },
    release() {
      current--;
      if (queue.length > 0) queue.shift()!();
    },
  };
}
