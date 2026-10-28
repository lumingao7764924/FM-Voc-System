import ExcelJS from 'exceljs';
import { ISSUE_TAXONOMY_HEADERS } from '@voc/shared';
import { buildBeautySkincareSeedIssues } from './seedCatalog.js';
import { loadWorkbookFromBuffer } from '../xlsx/loadWorkbook.js';

export type ParsedTaxonomyRow = {
  sourceRowNumber: number;
  issueId: string;
  parentIssueId: string;
  issueLevel: number;
  issueNameCn: string;
  issueNameEn: string;
  issueDescription: string;
  positiveExamples: string[];
  negativeExamples: string[];
  exclusionRules: string[];
  issueOwnerTeam: string;
  defaultSeverity: number | null;
  isSafetyRelated: boolean;
  isProductControllable: boolean;
  isLogisticsRelated: boolean;
  activeStatus: string;
  parseErrorCodes: string[];
};

function cellStr(v: ExcelJS.CellValue | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) {
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  if (typeof v === 'object' && 'text' in v && typeof (v as { text: string }).text === 'string') {
    return (v as { text: string }).text.trim();
  }
  if (typeof v === 'object' && 'result' in v) {
    return cellStr((v as { result: ExcelJS.CellValue }).result);
  }
  return String(v).trim();
}

function splitList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[|;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === '是';
}

function slugifyId(name: string, level: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '')
    .slice(0, 48);
  return `l${level}_${base || 'issue'}`;
}

export async function parseTaxonomyWorkbook(buffer: Buffer): Promise<{
  sheetName: string;
  rows: ParsedTaxonomyRow[];
}> {
  const wb = await loadWorkbookFromBuffer(buffer);
  const ws =
    wb.getWorksheet('01_问题分类') ??
    wb.worksheets.find((s) => s.name.includes('分类') || s.name.toLowerCase().includes('taxonomy')) ??
    wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('Workbook has no sheets'), { statusCode: 400 });

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell.value);
  });

  const expected = [...ISSUE_TAXONOMY_HEADERS];
  for (let i = 0; i < expected.length; i++) {
    if ((headers[i] || '') !== expected[i]) {
      throw Object.assign(
        new Error(
          `Invalid header at column ${i + 1}: expected ${expected[i]}, got ${headers[i] || '(empty)'}. Use voc issue taxonomy template.`,
        ),
        { statusCode: 400 },
      );
    }
  }

  const rows: ParsedTaxonomyRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 2) return;
    const get = (name: (typeof ISSUE_TAXONOMY_HEADERS)[number]) => {
      const idx = ISSUE_TAXONOMY_HEADERS.indexOf(name);
      return cellStr(row.getCell(idx + 1).value);
    };
    const values = ISSUE_TAXONOMY_HEADERS.map((h) => get(h));
    if (values.every((v) => !v)) return;

    const errors: string[] = [];
    const nameCn = get('issue_name_cn');
    if (!nameCn) errors.push('missing_name');

    let level = Number(get('issue_level') || '0');
    if (![1, 2, 3].includes(level)) {
      errors.push('bad_level');
      level = 0;
    }

    let issueId = get('issue_id');
    if (!issueId && nameCn && level) issueId = slugifyId(nameCn, level);
    if (!issueId) errors.push('missing_id');

    const parent = get('parent_issue_id');
    if (level >= 2 && !parent) errors.push('missing_parent');
    if (level === 1 && parent) errors.push('l1_has_parent');

    const sevRaw = get('default_severity');
    let defaultSeverity: number | null = null;
    if (sevRaw) {
      const n = Number(sevRaw);
      if (!Number.isFinite(n) || n < 1 || n > 5) errors.push('bad_severity');
      else defaultSeverity = n;
    }

    const active = (get('active_status') || 'active').toLowerCase();
    if (active !== 'active' && active !== 'inactive') errors.push('bad_status');

    rows.push({
      sourceRowNumber: rowNumber,
      issueId,
      parentIssueId: parent,
      issueLevel: level,
      issueNameCn: nameCn,
      issueNameEn: get('issue_name_en'),
      issueDescription: get('issue_description'),
      positiveExamples: splitList(get('positive_examples')),
      negativeExamples: splitList(get('negative_examples')),
      exclusionRules: splitList(get('exclusion_rules')),
      issueOwnerTeam: get('issue_owner_team'),
      defaultSeverity,
      isSafetyRelated: parseBool(get('is_safety_related')),
      isProductControllable: parseBool(get('is_product_controllable')),
      isLogisticsRelated: parseBool(get('is_logistics_related')),
      activeStatus: active === 'inactive' ? 'inactive' : 'active',
      parseErrorCodes: errors,
    });
  });

  return { sheetName: ws.name, rows };
}

/** 下载用：完整美妆护肤差评分类表（可直接导入） */
export async function buildTaxonomyTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const tip = wb.addWorksheet('00_说明');
  tip.getColumn(1).width = 18;
  tip.getColumn(2).width = 72;
  tip.getRow(1).getCell(1).value = '美妆护肤问题分类树';
  tip.getRow(2).getCell(1).value = '来源';
  tip.getRow(2).getCell(2).value = 'VOC 差评说明（SKT/TP）';
  tip.getRow(3).getCell(1).value = '用法';
  tip.getRow(3).getCell(2).value = '工作台「问题分类树」→ 导入 Excel';

  const ws = wb.addWorksheet('01_问题分类');
  ws.addRow([...ISSUE_TAXONOMY_HEADERS]);
  ws.addRow([
    '提示行可删',
    '',
    '',
    '中文名',
    '英文名',
    '说明',
    '样例用|分隔',
    '',
    '',
    '责任域',
    '1-5',
    'yes/no',
    'yes/no',
    'yes/no',
    'active',
  ]);

  for (const s of buildBeautySkincareSeedIssues()) {
    ws.addRow([
      s.issueId,
      s.parentIssueId ?? '',
      s.issueLevel,
      s.issueNameCn,
      s.issueNameEn ?? '',
      s.issueDescription ?? '',
      (s.positiveExamples ?? []).join('|'),
      '',
      '',
      s.issueOwnerTeam ?? '',
      s.defaultSeverity ?? '',
      s.isSafetyRelated ? 'yes' : 'no',
      s.isProductControllable ? 'yes' : 'no',
      s.isLogisticsRelated ? 'yes' : 'no',
      'active',
    ]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
