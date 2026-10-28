/**
 * BigQuery DATE / TIMESTAMP / DATETIME 常以 `{ value: string }` 返回；
 * API 对外统一输出字符串，避免前端出现 `[object Object]`。
 */

export function bqDateString(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s.slice(0, 10) : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // 仅取日历日时仍避免时区错日：用 UTC 组件不合适；这里只作兜底
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  if (typeof v === 'object' && v && 'value' in v) {
    return bqDateString((v as { value: unknown }).value);
  }
  const s = String(v).trim();
  if (!s || s === '[object Object]') return null;
  return s.slice(0, 10);
}

/** 无时区墙上时钟：YYYY-MM-DD HH:mm:ss（不带 Z / 时区） */
export function bqDateTimeString(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim().replace('T', ' ').replace(/Z$/i, '');
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    if (!m[2]) return m[1];
    const hh = m[2].padStart(2, '0');
    const mi = m[3];
    const ss = (m[4] ?? '00').padStart(2, '0');
    return `${m[1]} ${hh}:${mi}:${ss}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    const hh = String(v.getHours()).padStart(2, '0');
    const mi = String(v.getMinutes()).padStart(2, '0');
    const ss = String(v.getSeconds()).padStart(2, '0');
    if (hh === '00' && mi === '00' && ss === '00') return `${y}-${mo}-${d}`;
    return `${y}-${mo}-${d} ${hh}:${mi}:${ss}`;
  }
  if (typeof v === 'object' && v && 'value' in v) {
    return bqDateTimeString((v as { value: unknown }).value);
  }
  const s = String(v).trim();
  if (!s || s === '[object Object]') return null;
  return bqDateTimeString(s);
}

export function bqTimestampString(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'object' && v && 'value' in v) {
    return bqTimestampString((v as { value: unknown }).value);
  }
  const s = String(v);
  return s === '[object Object]' ? null : s;
}

/** 列表展示：统一 YYYY-MM-DD HH:mm:ss；无源时刻时补 00:00:00（入库仍可只存 DATE） */
export function formatReviewDisplayTime(opts: {
  dateLocal?: unknown;
  createdAtLocal?: unknown;
}): string | null {
  const dt = bqDateTimeString(opts.createdAtLocal);
  if (dt && dt.length > 10) return dt;
  const day = bqDateString(opts.dateLocal) ?? (dt && dt.length === 10 ? dt : null);
  if (!day) return null;
  return `${day} 00:00:00`;
}
