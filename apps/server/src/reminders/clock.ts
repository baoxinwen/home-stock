/**
 * 可注入时钟：生产用系统时钟，测试注入固定日期（规格第 10 节：调度器使用可注入时钟）。
 */
export interface Clock {
  /** 本地日期 YYYY-MM-DD */
  today(): string;
  /** 当前时刻 */
  now(): Date;
}

export class SystemClock implements Clock {
  today(): string {
    return localDate(this.now());
  }

  now(): Date {
    return new Date();
  }
}

/** Date → 本地日期字符串 YYYY-MM-DD */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → 本地时间戳 YYYY-MM-DDTHH:mm:ss */
export function localTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** b - a 的天数（两个 YYYY-MM-DD，同日为 0） */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
