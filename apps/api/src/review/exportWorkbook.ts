import ExcelJS from 'exceljs';
import { REVIEW_IMPORT_HEADERS } from '@voc/shared';
import { bqDateString, bqDateTimeString, bqTimestampString } from '../bqValue.js';

/** 与导入模板第 2 行提示一致；解析时会跳过这一行 */
const REVIEW_IMPORT_HEADER_TIPS = [
  '品牌 skt/tp',
  '平台 amazon/tiktokshop/shopify/other',
  '市场，暂默认US',
  '店铺ID，可空',
  '渠道显示名',
  '平台原生评论ID，有则填',
  '评论日期 YYYY-MM-DD',
  '评分 1-5',
  '标题，可空',
  '正文，可空',
  '平台SKU（原样，含组合SKU）',
  '平台商品名（中文/原名）',
  'Amazon ASIN，可空',
  '平台商品ID，可空',
  '图片URL，多张用|分隔',
  '源更新时间，可空',
  '有用票数，可空',
  '商家回复，可空',
] as const;

const COLUMN_WIDTHS = [14, 16, 14, 18, 20, 28, 22, 12, 36, 48, 22, 36, 16, 20, 28, 22, 14, 36];

/** Excel 单元格上限，超长正文截断以免整本写失败 */
const EXCEL_CELL_MAX = 32767;

function clip(s: string): string {
  return s.length <= EXCEL_CELL_MAX ? s : s.slice(0, EXCEL_CELL_MAX);
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v && 'value' in v) return text((v as { value: unknown }).value);
  const s = String(v).trim();
  return s === '[object Object]' ? '' : s;
}

/** 源表常用 `/`、`-` 表示空 SKU / 品名 */
function blankish(v: unknown): string {
  const s = text(v);
  if (!s || s === '/' || s === '-' || s === '—' || s === '–') return '';
  return s;
}

function finiteInStars(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

function formatRating(raw: unknown, normalized: unknown): string {
  const fromRaw = finiteInStars(raw);
  if (fromRaw != null && Math.abs(fromRaw - Math.round(fromRaw)) < 1e-6) {
    return String(Math.round(fromRaw));
  }
  const fromNorm = finiteInStars(normalized);
  if (fromNorm != null) return String(Math.round(fromNorm));
  if (fromRaw != null) return String(Math.round(fromRaw));
  return '';
}

/** 有非零时刻则带时间，否则只出日历日，便于按原模板再导入 */
export function exportReviewDate(row: Record<string, unknown>): string {
  const dt = bqDateTimeString(row.review_created_at_local);
  if (dt && dt.length > 10 && !dt.endsWith('00:00:00')) return dt;
  return bqDateString(row.review_date_local) ?? (dt ? dt.slice(0, 10) : '');
}

function formatCount(v: unknown): string {
  const s = text(v);
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/** 一行对齐 REVIEW_IMPORT_HEADERS。渠道名、媒体 URL 从原始导入行补回。 */
export function reviewRowToImportCells(row: Record<string, unknown>): string[] {
  const cells = [
    text(row.brand_key),
    text(row.platform),
    text(row.country_code),
    text(row.store_id),
    text(row.source_channel_label),
    text(row.source_review_id),
    exportReviewDate(row),
    formatRating(row.rating_raw, row.rating_normalized_5 ?? row.rating_numeric),
    text(row.review_title_original ?? row.review_title),
    text(row.review_text_original ?? row.review_text),
    blankish(row.platform_sku),
    blankish(row.platform_product_name),
    text(row.asin),
    text(row.platform_product_id),
    text(row.media_urls),
    bqTimestampString(row.source_updated_at) ?? text(row.source_updated_at),
    formatCount(row.helpful_vote_count),
    text(row.seller_reply_text),
  ];
  if (cells.length !== REVIEW_IMPORT_HEADERS.length) {
    throw new Error('export columns drifted from review import template');
  }
  return cells.map(clip);
}

export function reviewExportFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `voc_reviews_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.xlsx`;
}

export async function buildReviewExportWorkbook(rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('01_评论导入');
  ws.addRow([...REVIEW_IMPORT_HEADERS]);
  ws.addRow([...REVIEW_IMPORT_HEADER_TIPS]);

  const header = ws.getRow(1);
  header.font = { bold: true };
  const tip = ws.getRow(2);
  tip.font = { italic: true, size: 9, color: { argb: 'FF666666' } };

  for (const row of rows) {
    ws.addRow(reviewRowToImportCells(row));
  }

  COLUMN_WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
