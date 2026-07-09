/// <reference types="@songloft/plugin-sdk" />

// ============================================================
// 结构化日志 — 统一日志格式，便于调试和追踪
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, any>;
  timestamp: number;
}

/**
 * 格式化日志消息
 */
function formatLog(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
  const prefix = `[${ts}] [${entry.module}]`;
  if (entry.data) {
    const dataStr = Object.entries(entry.data)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    return `${prefix} ${entry.message} ${dataStr}`;
  }
  return `${prefix} ${entry.message}`;
}

/**
 * 创建模块日志器
 */
export function createLogger(module: string) {
  return {
    debug(message: string, data?: Record<string, any>) {
      songloft.log.debug(formatLog({ level: 'debug', module, message, data, timestamp: Date.now() }));
    },
    info(message: string, data?: Record<string, any>) {
      songloft.log.info(formatLog({ level: 'info', module, message, data, timestamp: Date.now() }));
    },
    warn(message: string, data?: Record<string, any>) {
      songloft.log.warn(formatLog({ level: 'warn', module, message, data, timestamp: Date.now() }));
    },
    error(message: string, data?: Record<string, any>) {
      songloft.log.error(formatLog({ level: 'error', module, message, data, timestamp: Date.now() }));
    },
  };
}
