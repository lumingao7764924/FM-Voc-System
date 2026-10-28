import ExcelJS from 'exceljs';
import {
  REVIEW_IMPORT_HEADERS,
  SCHEMA_VERSION,
  PARSER_VERSION,
} from '@voc/shared';
import { loadWorkbookFromBuffer } from '../xlsx/loadWorkbook.js';

export interface ParsedReviewRow {
  sourceRowNumber: number;
  brandKey: string;
  platform: string;
  countryCode: string;
  storeId: string;
  sourceChannelLabel: string;
  sourceReviewId: string;
  /** BQ review_date_local：YYYY-MM-DD */
  reviewDate: string;
  /** 查重键用：有源表时刻则为 YYYY-MM-DD HH:mm:ss，否则同 reviewDate */
  reviewDateKey: string;
  rating: string;
  reviewTitle: string;
  reviewText: string;
  platformSku: string;
  platformProductName: string;
  asin: string;
  platformProductId: string;
  mediaUrls: string;
  sourceUpdatedAt: string;
  helpfulVoteCount: string;
  sellerReplyText: string;
  parseErrorCodes: string[];
}

function cellStr(v: ExcelJS.CellValue | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) {
    // Excel 日期单元格：用本地墙钟，避免 toISOString 因时区错日；有时刻则带上
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    const hh = v.getHours();
    const mm = v.getMinutes();
    const ss = v.getSeconds();
    if (hh === 0 && mm === 0 && ss === 0) return `${y}/${mo}/${d}`;
    return `${y}/${mo}/${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  if (typeof v === 'object' && 'text' in v && typeof (v as { text: string }).text === 'string') {
    return (v as { text: string }).text.trim();
  }
  if (typeof v === 'object' && 'result' in v) {
    return cellStr((v as { result: ExcelJS.CellValue }).result);
  }
  return '';
}

/** 源表占位符：与空同义（无 SKU/品名时常填 `/`） */
function blankishField(s: string): string {
  const t = s.trim();
  if (!t || t === '/') return '';
  return t;
}

/**
 * 兼容多种源表日期写法，先把 `-` 换成 `/`（避免部分环境对 `YYYY-MM-DD` 解析异常）。
 * 例：2026/9/13 2:45:00、2026-07-29 18:02:38、2026-07-29、2026-10-04T00:00:00.000Z
 *
 * - date：写入 BQ 的日历日 YYYY-MM-DD
 * - dateKey：查重 / fingerprint 用；有时刻则带 HH:mm:ss，提高同日不同时评论的区分度
 */
export function normalizeReviewDate(raw: string): {
  date: string;
  dateKey: string;
  ok: boolean;
} {
  if (!raw?.trim()) return { date: '', dateKey: '', ok: false };

  const s = raw
    .trim()
    .replace(/T/gi, ' ')
    .replace(/-/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/(\d{1,2}:\d{2}(?::\d{2})?)\.\d+/, '$1')
    .replace(/(?:Z|[+-]\d{2}:\d{2})$/i, '')
    .trim();

  const m = s.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!m) return { date: raw.trim(), dateKey: raw.trim(), ok: false };

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2018 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    return { date: '', dateKey: '', ok: false };
  }
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    return { date: '', dateKey: '', ok: false };
  }

  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (m[4] != null) {
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = m[6] != null ? Number(m[6]) : 0;
    if (hh > 23 || mi > 59 || ss > 59) {
      return { date: '', dateKey: '', ok: false };
    }
    const dateKey = `${date} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return { date, dateKey, ok: true };
  }

  return { date, dateKey: date, ok: true };
}

export async function parseReviewWorkbook(buffer: Buffer): Promise<{
  sheetName: string;
  rows: ParsedReviewRow[];
}> {
  const wb = await loadWorkbookFromBuffer(buffer);
  const ws =
    wb.getWorksheet('01_评论导入') ??
    wb.worksheets.find((s) => s.name.includes('评论')) ??
    wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('Workbook has no sheets'), { statusCode: 400 });

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell.value);
  });

  const expected = [...REVIEW_IMPORT_HEADERS];
  for (let i = 0; i < expected.length; i++) {
    if ((headers[i] || '') !== expected[i]) {
      throw Object.assign(
        new Error(
          `Invalid header at column ${i + 1}: expected ${expected[i]}, got ${headers[i] || '(empty)'}. Use voc review import template.`,
        ),
        { statusCode: 400 },
      );
    }
  }

  const rows: ParsedReviewRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 2) return; // header + tip row
    const get = (name: (typeof REVIEW_IMPORT_HEADERS)[number]) => {
      const idx = REVIEW_IMPORT_HEADERS.indexOf(name);
      return cellStr(row.getCell(idx + 1).value);
    };

    const values = REVIEW_IMPORT_HEADERS.map((h) => get(h));
    if (values.every((v) => !v)) return;

    const errors: string[] = [];
    const rating = get('rating');
    const ratingNum = Number(rating);
    if (!rating || !Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      errors.push('bad_rating');
    }
    const { date, dateKey, ok } = normalizeReviewDate(get('review_date'));
    if (!ok) errors.push('bad_date');
    // platform_sku 为空 = 店铺评论，不隔离；由导入写入 review_scope=store
    // brand_key / platform：开放字符串，仅要求非空
    const platform = get('platform').toLowerCase();
    const brand = get('brand_key').toLowerCase();
    if (!platform) errors.push('missing_platform');
    if (!brand) errors.push('missing_brand');

    rows.push({
      sourceRowNumber: rowNumber,
      brandKey: brand,
      platform,
      countryCode: get('country_code') || 'US',
      storeId: get('store_id'),
      sourceChannelLabel: get('source_channel_label'),
      sourceReviewId: get('source_review_id'),
      reviewDate: date,
      reviewDateKey: dateKey,
      rating,
      reviewTitle: get('review_title'),
      reviewText: get('review_text'),
      platformSku: blankishField(get('platform_sku')),
      platformProductName: blankishField(get('platform_product_name')),
      asin: get('asin'),
      platformProductId: get('platform_product_id'),
      mediaUrls: get('media_urls'),
      sourceUpdatedAt: get('source_updated_at'),
      helpfulVoteCount: get('helpful_vote_count'),
      sellerReplyText: get('seller_reply_text'),
      parseErrorCodes: errors,
    });
  });

  return { sheetName: ws.name, rows };
}

export { SCHEMA_VERSION, PARSER_VERSION };