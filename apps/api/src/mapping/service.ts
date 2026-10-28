import { v4 as uuidv4 } from 'uuid';
import {
  MAPPING_RULE_VERSION,
  type ProductMappingUploadResult,
} from '@voc/shared';
import { env } from '../config.js';
import { sha256Hex, canonicalJson } from '../crypto.js';
import { parseMappingWorkbook, type ParsedMappingRow } from './parseWorkbook.js';
import * as store from './store.js';

function rowKey(row: ParsedMappingRow) {
  return `${row.brandKey}|${row.internalSku}`;
}

function expandTechFields(
  row: ParsedMappingRow,
  opts: {
    mappingPublicationId: string;
    uploadedBy: string;
    validFrom: string;
  },
): Record<string, unknown> {
  const mappingVersionId = sha256Hex(
    canonicalJson({
      brand_key: row.brandKey,
      internal_sku: row.internalSku,
      publication: opts.mappingPublicationId,
      valid_from: opts.validFrom,
    }),
  );
  const productScopeId = sha256Hex(
    canonicalJson({ brand_key: row.brandKey, internal_sku: row.internalSku }),
  );

  return {
    mapping_version_id: mappingVersionId,
    mapping_publication_id: opts.mappingPublicationId,
    platform: '*',
    country_code: '*',
    marketplace_id: null,
    store_id: null,
    authorization_key: null,
    product_scope_id: productScopeId,
    alias_type: 'seller_sku',
    alias_value: row.internalSku,
    parent_product_id: null,
    platform_product_id: null,
    platform_parent_id: null,
    platform_variant_id: null,
    asin: null,
    platform_sku: row.internalSku,
    brand_key: row.brandKey,
    internal_spu: row.internalSpu || null,
    internal_sku: row.internalSku,
    mapping_granularity: row.mappingGranularity,
    product_name_cn: row.productNameCn || null,
    product_name_en: row.productNameEn || null,
    brand_name: null,
    category_l1: null,
    category_l2: null,
    category_l3: null,
    product_family: null,
    product_type: null,
    product_status: null,
    variant_name: row.shadeCode || null,
    shade_name: row.shadeName || null,
    size_or_volume: null,
    valid_from: opts.validFrom,
    valid_to: null,
    mapping_status: 'confirmed',
    mapping_method: 'master_data',
    mapping_confidence: null,
    mapping_rule_version: MAPPING_RULE_VERSION,
    approved_by: opts.uploadedBy,
    approved_at: opts.validFrom,
    source_reference: row.sourceReference,
  };
}

export async function processMappingUpload(input: {
  buffer: Buffer;
  uploadedBy: string;
}): Promise<ProductMappingUploadResult> {
  const { rows, skippedNoSku } = await parseMappingWorkbook(input.buffer);
  if (rows.length === 0 && skippedNoSku === 0) {
    throw Object.assign(new Error('No data rows found in mapping workbook'), {
      statusCode: 400,
    });
  }

  const invalid = rows.filter((r) => r.parseErrorCodes.length > 0);
  if (invalid.length > 0) {
    const sample = invalid
      .slice(0, 5)
      .map((r) => `行 ${r.sourceRowNumber}: ${r.parseErrorCodes.join(',')}`)
      .join('；');
    throw Object.assign(
      new Error(`校验失败 ${invalid.length} 行。${sample}`),
      { statusCode: 400 },
    );
  }

  // 同文件内同一 brand_key+internal_sku：保留最底下一行（Excel 靠后）
  const lastByKey = new Map<string, ParsedMappingRow>();
  for (const row of rows) {
    lastByKey.set(rowKey(row), row);
  }

  const uniqueRows = [...lastByKey.values()];
  const duplicateSkipped = rows.length - uniqueRows.length;
  const dryRun = env.importDryRun;

  if (uniqueRows.length === 0) {
    return {
      mappingPublicationId: '',
      added: 0,
      updated: 0,
      skipped: duplicateSkipped + skippedNoSku,
      duplicateSkipped,
      noSkuSkipped: skippedNoSku,
      totalRows: 0,
      dryRun,
      message: `无有效 SKU 可导入（无SKU跳过 ${skippedNoSku}）${dryRun ? '（干跑，未写 BigQuery）' : ''}`,
    };
  }

  const mappingPublicationId = uuidv4();
  const validFrom = new Date().toISOString();

  const keys = uniqueRows.map((r) => ({
    brandKey: r.brandKey,
    internalSku: r.internalSku,
  }));
  const existing = await store.findExistingMappingKeys(keys);

  let added = 0;
  let updated = 0;
  const bqRows: Record<string, unknown>[] = [];
  const overwriteKeys: Array<{ brandKey: string; internalSku: string }> = [];

  for (const row of uniqueRows) {
    const key = store.lookupKey(row.brandKey, row.internalSku);
    const isUpdate = existing.has(key);
    if (isUpdate) {
      updated += 1;
      overwriteKeys.push({ brandKey: row.brandKey, internalSku: row.internalSku });
    } else {
      added += 1;
    }
    bqRows.push(
      expandTechFields(row, {
        mappingPublicationId,
        uploadedBy: input.uploadedBy,
        validFrom,
      }),
    );
  }

  await store.invalidateAndInsertMappings(overwriteKeys, bqRows, validFrom);

  const parts = [`新增 ${added}`, `覆盖 ${updated}`];
  if (duplicateSkipped) parts.push(`重复跳过 ${duplicateSkipped}`);
  if (skippedNoSku) parts.push(`无SKU跳过 ${skippedNoSku}`);

  return {
    mappingPublicationId,
    added,
    updated,
    skipped: duplicateSkipped + skippedNoSku,
    duplicateSkipped,
    noSkuSkipped: skippedNoSku,
    totalRows: uniqueRows.length,
    dryRun,
    message: `${parts.join('，')}${dryRun ? '（干跑，未写 BigQuery）' : ''}`,
  };
}
