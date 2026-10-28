import ExcelJS from 'exceljs';
import { PRODUCT_MAPPING_HEADERS } from '@voc/shared';
import { loadWorkbookFromBuffer } from '../xlsx/loadWorkbook.js';

export interface ParsedMappingRow {
  sourceRowNumber: number;
  brandKey: string;
  internalSpu: string;
  internalSku: string;
  productNameCn: string;
  productNameEn: string;
  shadeCode: string;
  shadeName: string;
  mappingGranularity: string;
  sourceReference: string;
  parseErrorCodes: string[];
}

function cellStr(v: ExcelJS.CellValue | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && 'text' in v && typeof (v as { text: string }).text === 'string') {
    return (v as { text: string }).text.trim();
  }
  if (typeof v === 'object' && 'result' in v) {
    return cellStr((v as { result: ExcelJS.CellValue }).result);
  }
  return String(v).trim();
}

/** 合并单元格时后续行可能为空，向前填充结构列 */
const FILL_FORWARD_KEYS = ['brand_key', 'internal_spu'] as const;

/** 产品名仅在同一 SPU 内向前填充（色号多行）；跨 SPU 不沿用上一产品的名称 */
const FILL_FORWARD_WITHIN_SPU_KEYS = ['product_name_cn', 'product_name_en'] as const;

function pickWorksheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const preferred =
    wb.getWorksheet('01_内部SKU主数据') ??
    wb.getWorksheet('01_产品SKU对照') ??
    wb.worksheets.find((s) => s.name.includes('SKU') || s.name.includes('产品')) ??
    wb.worksheets[0];
  if (!preferred) {
    throw Object.assign(new Error('Workbook has no sheets'), { statusCode: 400 });
  }
  return preferred;
}

/**
 * 解析表头：新模板用 PRODUCT_MAPPING_HEADERS；
 * 旧表 `01_产品SKU对照` 允许用 alias_value 充当 internal_sku。
 */
function resolveColumnIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = (h || '').trim().toLowerCase();
    if (key) map.set(key, i);
  });

  const hasInternalSku = map.has('internal_sku');
  const hasAliasValue = map.has('alias_value');
  if (!hasInternalSku && hasAliasValue) {
    map.set('internal_sku', map.get('alias_value')!);
  }

  const required = ['brand_key', 'internal_spu', 'internal_sku', 'mapping_granularity'] as const;
  for (const col of required) {
    if (!map.has(col)) {
      throw Object.assign(
        new Error(
          `Missing column "${col}". Use voc_product_mapping_template.xlsx (sheet 01_内部SKU主数据).`,
        ),
        { statusCode: 400 },
      );
    }
  }
  return map;
}

export async function parseMappingWorkbook(buffer: Buffer): Promise<{
  sheetName: string;
  rows: ParsedMappingRow[];
  /** 无 internal_sku（含 `/`）被过滤的行数 */
  skippedNoSku: number;
}> {
  const wb = await loadWorkbookFromBuffer(buffer);
  const ws = pickWorksheet(wb);

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellStr(cell.value);
  });
  const colIndex = resolveColumnIndex(headers);

  const getByName = (row: ExcelJS.Row, name: string): string => {
    const idx = colIndex.get(name);
    if (idx == null) return '';
    return cellStr(row.getCell(idx + 1).value);
  };

  const fillState: Record<(typeof FILL_FORWARD_KEYS)[number], string> = {
    brand_key: '',
    internal_spu: '',
  };
  const nameFillState: Record<(typeof FILL_FORWARD_WITHIN_SPU_KEYS)[number], string> = {
    product_name_cn: '',
    product_name_en: '',
  };
  let nameFillSpuKey = '';
  let skippedNoSku = 0;

  const rows: ParsedMappingRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= 2) return; // EN header + ZH tip

    const raw: Record<string, string> = {};
    for (const h of PRODUCT_MAPPING_HEADERS) {
      raw[h] = getByName(row, h);
    }
    // 旧表可能多出的列不进 PRODUCT_MAPPING_HEADERS，internal_sku 已由 alias_value 映射

    // 先判断「单元格是否全空」：空尾行不能被合并单元格向前填充「造」成新行
    const rawEmpty = PRODUCT_MAPPING_HEADERS.every((h) => !raw[h]);
    if (rawEmpty) return;

    for (const k of FILL_FORWARD_KEYS) {
      if (raw[k]) fillState[k] = raw[k];
      else if (fillState[k]) raw[k] = fillState[k];
    }

    const spuKey = `${raw.brand_key.toLowerCase()}|${raw.internal_spu}`;
    if (spuKey !== nameFillSpuKey) {
      nameFillState.product_name_cn = '';
      nameFillState.product_name_en = '';
      nameFillSpuKey = spuKey;
    }
    for (const k of FILL_FORWARD_WITHIN_SPU_KEYS) {
      if (raw[k]) nameFillState[k] = raw[k];
      else if (nameFillState[k]) raw[k] = nameFillState[k];
    }

    // 示例行：灰色提示，source_reference 含「示例」时跳过
    const sourceRef = raw.source_reference || '';
    if (sourceRef.includes('示例') || sourceRef.toLowerCase().includes('example')) {
      return;
    }

    const errors: string[] = [];
    const brandKey = raw.brand_key.toLowerCase();
    const internalSpu = raw.internal_spu;
    // `/` 与空同义；无 SKU 的行直接跳过，不报错、不入库
    const internalSkuRaw = (raw.internal_sku || '').trim();
    const internalSku = !internalSkuRaw || internalSkuRaw === '/' ? '' : internalSkuRaw;
    if (!internalSku) {
      skippedNoSku += 1;
      return;
    }

    const granularity = (raw.mapping_granularity || 'sku').toLowerCase();
    const nameCn = raw.product_name_cn;
    const nameEn = raw.product_name_en;

    if (!brandKey) errors.push('missing_brand');
    if (!internalSpu) errors.push('missing_internal_spu');
    if (!granularity || !['sku', 'spu', 'brand_only'].includes(granularity)) {
      errors.push('bad_granularity');
    }
    if (!nameCn && !nameEn) errors.push('missing_product_name');

    // 组合装无 SPU 的套组：缺 SPU 已标错；含 + 的整行保留
    rows.push({
      sourceRowNumber: rowNumber,
      brandKey,
      internalSpu,
      internalSku,
      productNameCn: nameCn,
      productNameEn: nameEn,
      shadeCode: raw.shade_code,
      shadeName: raw.shade_name,
      mappingGranularity: granularity || 'sku',
      sourceReference: sourceRef || 'master_data_upload',
      parseErrorCodes: errors,
    });
  });

  return { sheetName: ws.name, rows, skippedNoSku };
}
