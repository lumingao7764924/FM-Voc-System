import JSZip from 'jszip';

const SPREADSHEET_NS =
  /xmlns:([A-Za-z_][\w.-]*)="(?:http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/spreadsheetml\/main)"/g;

const ISO_DATE_CELL =
  /<c\b([^>]*?)\st=(["'])d\2([^>]*)>\s*<v>([^<]+)<\/v>\s*<\/c>/g;

/**
 * 部分导出把 OOXML 写成带前缀的标签（`<x:workbook>`），日期格用 `t="d"` 的 ISO 文本。
 * Excel 能打开；ExcelJS 只匹配无前缀标签，并且对 `t="d"` 做 parseFloat，
 * `2026-10-04T00:00:00.000Z` 会变成序列日 2026（1905-07-18）。
 * 普通 xlsx 检测后原样返回。
 */
export async function normalizeOoxmlBuffer(input: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    return input;
  }

  let changed = false;
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const path = entry.name.replace(/^\/+/, '');
    if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue;
    const raw = await entry.async('nodebuffer');
    const next = normalizeXmlPart(path, raw.toString('utf8'));
    if (next === null) continue;
    zip.file(entry.name, next);
    changed = true;
  }
  if (!changed) return input;
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

function normalizeXmlPart(path: string, xml: string): string | null {
  let text = xml;
  let changed = false;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    changed = true;
  }

  const prefixes = new Set<string>();
  for (const match of text.matchAll(SPREADSHEET_NS)) {
    if (match[1]) prefixes.add(match[1]);
  }
  for (const prefix of prefixes) {
    const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`<${esc}:`, 'g'), '<')
      .replace(new RegExp(`</${esc}:`, 'g'), '</')
      .replace(new RegExp(`\\sxmlns:${esc}="[^"]*"`, 'g'), '');
    changed = true;
  }

  if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(path)) {
    const rewritten = rewriteIsoDateCells(text);
    if (rewritten !== text) {
      text = rewritten;
      changed = true;
    }
  }

  return changed ? text : null;
}

/** `t="d"` 的 ISO 日期改成文本，避免 ExcelJS 只 parseFloat 到年份。零点视为日历日。 */
function rewriteIsoDateCells(xml: string): string {
  if (!xml.includes('t="d"') && !xml.includes("t='d'")) return xml;
  return xml.replace(ISO_DATE_CELL, (full, before: string, _quote: string, after: string, value: string) => {
    const text = isoDateToCellText(value);
    if (!text) return full.replace(/\st=(["'])d\1/, ' t="str"');
    const attrs = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    return `<c${attrs ? ` ${attrs}` : ''} t="str"><v>${escapeXml(text)}</v></c>`;
  });
}

function isoDateToCellText(raw: string): string | null {
  const m = raw
    .trim()
    .match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i,
    );
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mi = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (hh > 23 || mi > 59 || ss > 59) return null;
  const date = `${y}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  if (m[4] == null || (hh === 0 && mi === 0 && ss === 0)) return date;
  return `${date} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
