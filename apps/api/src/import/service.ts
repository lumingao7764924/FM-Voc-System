import { v4 as uuidv4 } from 'uuid';
import {
  IDENTITY_RULE_VERSION,
  PARSER_VERSION,
  RATING_RULE_VERSION,
  SCHEMA_VERSION,
  TEMPLATE_VERSION,
  formatDuplicateInBatchMessage,
  labelImportIssueCode,
  type ImportBatchSummary,
  type ImportIssueItem,
} from '@voc/shared';
import { sha256Hex, canonicalJson } from '../crypto.js';
import { parseReviewWorkbook, type ParsedReviewRow } from './parseWorkbook.js';
import { computeSourceRowHash, isWeakSourceIdentity } from './sourceRowHash.js';
import * as store from './store.js';
import { lookupKey, lookupMappings } from '../mapping/store.js';

function sourceScopeId(platform: string, country: string, storeId?: string) {
  return ['scope', platform, country, storeId || 'public'].join('_');
}

function sourceSystem(platform: string) {
  const p = (platform || 'other').toLowerCase();
  if (p === 'other') return 'other';
  return `${p}_native`;
}

function previewText(row: ParsedReviewRow) {
  const t = (row.reviewTitle || row.reviewText || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 240) : undefined;
}

function issueFromRow(
  row: ParsedReviewRow,
  code: string,
  message: string,
): ImportIssueItem {
  return {
    sourceRowNumber: row.sourceRowNumber,
    code,
    message,
    brandKey: row.brandKey || undefined,
    platform: row.platform || undefined,
    platformSku: row.platformSku || undefined,
    preview: previewText(row),
  };
}

/** 写入 review_import_error.safe_message，供刷新后回填明细 */
export function encodeIssueSafeMessage(item: ImportIssueItem): string {
  return JSON.stringify({
    v: 1,
    sourceRowNumber: item.sourceRowNumber,
    code: item.code,
    message: item.message,
    brandKey: item.brandKey,
    platform: item.platform,
    platformSku: item.platformSku,
    preview: item.preview,
  });
}

function errorRowFromIssue(
  importBatchId: string,
  rawId: string,
  stage: 'parse' | 'dedup',
  severity: 'error' | 'warning',
  item: ImportIssueItem,
  createdAt: string,
) {
  return {
    error_id: uuidv4(),
    import_batch_id: importBatchId,
    raw_id: rawId,
    stage,
    error_code: item.code,
    severity,
    safe_message: encodeIssueSafeMessage(item),
    retryable: false,
    created_at: createdAt,
  };
}

function buildIdentity(row: ParsedReviewRow, importBatchId: string) {
  const scope = sourceScopeId(row.platform, row.countryCode, row.storeId || undefined);
  if (row.sourceReviewId) {
    const namespace = `${row.platform}|${sourceSystem(row.platform)}|${row.countryCode}|${scope}`;
    const reviewId = sha256Hex(
      canonicalJson({
        identity_rule_version: IDENTITY_RULE_VERSION,
        identity_namespace: namespace,
        source_review_id: row.sourceReviewId,
      }),
    );
    return {
      reviewId,
      identityNamespace: namespace,
      identityMethod: 'native_id',
      identityConfidence: 'verified',
      sourceReviewId: row.sourceReviewId,
      sourceScopeId: scope,
    };
  }
  const weak = isWeakSourceIdentity(row);
  const namespace = `${row.platform}|fingerprint|${row.countryCode}|${scope}`;
  const fingerprint = sha256Hex(
    canonicalJson({
      identity_rule_version: IDENTITY_RULE_VERSION,
      identity_namespace: namespace,
      platform_sku: row.platformSku,
      review_date: row.reviewDateKey || row.reviewDate,
      rating: row.rating,
      text: (row.reviewText || '').replace(/\s+/g, ' ').trim(),
      title: (row.reviewTitle || '').replace(/\s+/g, ' ').trim(),
      media: (row.mediaUrls || '').trim(),
      // 弱身份无唯一内容：按批次+行号生成 review_id，避免多行共用同一 id
      import_batch_id: weak ? importBatchId : '',
      source_row_number: weak ? row.sourceRowNumber : 0,
    }),
  );
  return {
    reviewId: fingerprint,
    identityNamespace: namespace,
    identityMethod: weak ? 'weak_row_v1' : 'fingerprint_v1',
    identityConfidence: 'fallback',
    sourceReviewId: null as string | null,
    sourceScopeId: scope,
  };
}

function summarizeFileScope(rows: ParsedReviewRow[]) {
  const platforms = [...new Set(rows.map((r) => r.platform).filter(Boolean))];
  const countries = [...new Set(rows.map((r) => r.countryCode).filter(Boolean))];
  const brands = [...new Set(rows.map((r) => r.brandKey).filter(Boolean))];
  return {
    platform: platforms.length === 1 ? platforms[0] : 'other',
    countryCode: countries.length === 1 ? countries[0] : 'XX',
    declaredBrandKey: brands.length === 1 ? brands[0] : null,
    sourceSystem:
      platforms.length === 1 ? sourceSystem(platforms[0]) : 'mixed_upload',
  };
}

/** Batch shell only — brand/platform/country come from Excel rows after upload. */
export async function createImportBatch(input: {
  requestIdempotencyKey: string;
  sourceFileName: string;
  uploadedBy: string;
}): Promise<ImportBatchSummary> {
  const importBatchId = uuidv4();
  const uploadedAt = new Date().toISOString();
  const summary: ImportBatchSummary = {
    importBatchId,
    importStatus: 'awaiting_upload',
    platform: 'other',
    countryCode: 'XX',
    declaredBrandKey: null,
    sourceFileName: input.sourceFileName,
    uploadedAt,
    completedAt: null,
    totalRows: null,
    newRows: null,
    updatedRows: null,
    duplicateRows: null,
    quarantinedRows: null,
    unmappedRows: null,
    textMissingRows: null,
    errorCode: null,
    errorMessage: null,
  };
  store.memorySet(summary);

  await store.insertBatchRow({
    import_batch_id: importBatchId,
    request_idempotency_key: input.requestIdempotencyKey,
    platform: 'other',
    source_system: 'mixed_upload',
    source_provider: 'voc_web_upload',
    country_code: 'XX',
    store_id: null,
    source_scope_id: 'scope_mixed_upload',
    declared_brand_key: null,
    source_file_name: input.sourceFileName,
    source_file_uri: `pending://${importBatchId}`,
    coverage_mode: 'unknown',
    coverage_verified: false,
    template_version: TEMPLATE_VERSION,
    parser_version: PARSER_VERSION,
    schema_version: SCHEMA_VERSION,
    uploaded_by: input.uploadedBy,
    uploaded_at: uploadedAt,
    import_status: 'awaiting_upload',
    media_status: 'not_started',
    bq_job_ids: [],
  });

  return summary;
}

export async function processImportFile(input: {
  importBatchId: string;
  buffer: Buffer;
  contentType: string;
  uploadedBy: string;
}): Promise<ImportBatchSummary> {
  const existing = await store.fetchBatch(input.importBatchId);
  if (!existing) {
    throw Object.assign(new Error('Batch not found'), { statusCode: 404 });
  }
  if (
    existing.importStatus !== 'awaiting_upload' &&
    existing.importStatus !== 'queued' &&
    existing.importStatus !== 'failed'
  ) {
    throw Object.assign(new Error('Batch not awaiting upload'), { statusCode: 409 });
  }

  await store.updateBatchStatus(input.importBatchId, { importStatus: 'running' });

  try {
    const uploaded = await store.uploadRawFile(
      input.importBatchId,
      input.buffer,
      input.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const { sheetName, rows } = await parseReviewWorkbook(input.buffer);
    if (rows.length === 0) {
      throw Object.assign(new Error('No data rows in workbook'), { statusCode: 400 });
    }

    const fileScope = summarizeFileScope(rows);
    const ingestedAt = new Date().toISOString();

    const rawRows: Record<string, unknown>[] = [];
    const factRows: Record<string, unknown>[] = [];
    const obsRows: Record<string, unknown>[] = [];
    const errRows: Record<string, unknown>[] = [];
    const quarantineItems: ImportIssueItem[] = [];
    const duplicateItems: ImportIssueItem[] = [];
    const seenRowHash = new Map<string, number>();
    type PendingRow = {
      row: ParsedReviewRow;
      rawId: string;
      sourceRowHash: string;
      sheetName: string;
      skipDedup: boolean;
    };
    const pending: PendingRow[] = [];

    let newRows = 0;
    let quarantined = 0;
    let duplicates = 0;
    let unmapped = 0;
    let textMissing = 0;

    for (const row of rows) {
      const rowScope = sourceScopeId(row.platform, row.countryCode, row.storeId || undefined);
      const rawId = sha256Hex(
        canonicalJson({
          import_batch_id: input.importBatchId,
          source_sheet: sheetName,
          source_row_number: row.sourceRowNumber,
        }),
      );
      const sourceRowHash = computeSourceRowHash(row);
      const payload = {
        brand_key: row.brandKey,
        platform: row.platform,
        country_code: row.countryCode,
        store_id: row.storeId,
        source_channel_label: row.sourceChannelLabel,
        source_review_id: row.sourceReviewId,
        review_date: row.reviewDate,
        review_date_key: row.reviewDateKey,
        rating: row.rating,
        review_title: row.reviewTitle,
        review_text: row.reviewText,
        platform_sku: row.platformSku,
        platform_product_name: row.platformProductName,
        asin: row.asin,
        platform_product_id: row.platformProductId,
        media_urls: row.mediaUrls,
        source_updated_at: row.sourceUpdatedAt,
        helpful_vote_count: row.helpfulVoteCount,
        seller_reply_text: row.sellerReplyText,
      };

      const quarantinedRow = row.parseErrorCodes.length > 0;
      rawRows.push({
        raw_id: rawId,
        import_batch_id: input.importBatchId,
        source_sheet: sheetName,
        source_row_number: row.sourceRowNumber,
        platform: row.platform || 'other',
        country_code: row.countryCode || 'XX',
        source_scope_id: rowScope,
        raw_payload: JSON.stringify(payload),
        raw_text: row.reviewText || null,
        source_row_hash: sourceRowHash,
        parser_version: PARSER_VERSION,
        schema_version: SCHEMA_VERSION,
        parse_status: quarantinedRow ? 'quarantined' : 'parsed',
        parse_error_codes: row.parseErrorCodes,
        ingested_at: ingestedAt,
      });

      if (quarantinedRow) {
        quarantined += 1;
        const code = row.parseErrorCodes[0];
        const labels = row.parseErrorCodes.map((c) => labelImportIssueCode(c));
        const item = issueFromRow(row, code, labels.join('；'));
        quarantineItems.push(item);
        errRows.push(
          errorRowFromIssue(input.importBatchId, rawId, 'parse', 'error', item, ingestedAt),
        );
        continue;
      }

      const weak = isWeakSourceIdentity(row);
      // 无可靠唯一键：跳过内容查重，直接入库（避免星评误杀）
      if (!weak) {
        const firstDupRow = seenRowHash.get(sourceRowHash);
        if (firstDupRow != null) {
          duplicates += 1;
          const item = issueFromRow(
            row,
            'duplicate_in_batch',
            formatDuplicateInBatchMessage(firstDupRow),
          );
          duplicateItems.push(item);
          errRows.push(
            errorRowFromIssue(input.importBatchId, rawId, 'dedup', 'warning', item, ingestedAt),
          );
          continue;
        }
        seenRowHash.set(sourceRowHash, row.sourceRowNumber);
      }
      pending.push({ row, rawId, sourceRowHash, sheetName, skipDedup: weak });
    }

    // 与 BigQuery / 本进程已入库记录查重（同一 hash 规则）；弱身份跳过
    const existingHashes = await store.findExistingSourceRowHashes(
      pending.filter((p) => !p.skipDedup).map((p) => p.sourceRowHash),
    );

    // 批量查内部 SKU 映射：brand_key + platform_sku → internal_sku
    const mappingHits = await lookupMappings(
      pending
        .filter((p) => p.row.platformSku && p.row.brandKey)
        .map((p) => ({ brandKey: p.row.brandKey, platformSku: p.row.platformSku })),
    );

    for (const { row, rawId, sourceRowHash, sheetName: srcSheet, skipDedup } of pending) {
      if (!skipDedup && existingHashes.has(sourceRowHash)) {
        duplicates += 1;
        const item = issueFromRow(
          row,
          'duplicate_in_history',
          labelImportIssueCode('duplicate_in_history'),
        );
        duplicateItems.push(item);
        errRows.push(
          errorRowFromIssue(input.importBatchId, rawId, 'dedup', 'warning', item, ingestedAt),
        );
        continue;
      }
      if (!skipDedup) {
        existingHashes.add(sourceRowHash);
      }

      const identity = buildIdentity(row, input.importBatchId);
      const contentHash = sha256Hex(
        canonicalJson({
          title: row.reviewTitle,
          text: row.reviewText,
          rating: row.rating,
          media: row.mediaUrls,
        }),
      );
      const reviewVersion = 1;
      const reviewVersionId = sha256Hex(
        canonicalJson({
          review_id: identity.reviewId,
          review_version: reviewVersion,
          content_hash: contentHash,
        }),
      );
      const textAvailable = Boolean(row.reviewText || row.reviewTitle);
      if (!textAvailable) textMissing += 1;
      const reviewScope = row.platformSku ? 'product' : 'store';

      const hit =
        reviewScope === 'product' && row.brandKey && row.platformSku
          ? mappingHits.get(lookupKey(row.brandKey, row.platformSku))
          : undefined;

      let productMappingStatus: string = 'pending';
      let brandKeyOut: string | null = null;
      let internalSpu: string | null = null;
      let internalSku: string | null = null;
      let productNameCn: string | null = null;
      let productNameEn: string | null = null;
      let mappingVersionId: string | null = null;
      let mappingPublicationId: string | null = null;
      let mappingRuleVersion: string | null = null;
      let productGranularity =
        reviewScope === 'store' ? 'store' : row.platformSku ? 'variant' : 'unknown';

      if (reviewScope === 'store') {
        // 店铺评论：不计入待映射；brand_key 可保留上传提示但不冒充已确认映射
        productMappingStatus = 'pending';
        brandKeyOut = row.brandKey || null;
      } else if (hit?.productMappingStatus === 'confirmed') {
        productMappingStatus = 'confirmed';
        brandKeyOut = hit.brandKey;
        internalSpu = hit.internalSpu;
        internalSku = hit.internalSku;
        productNameCn = hit.productNameCn;
        productNameEn = hit.productNameEn;
        mappingVersionId = hit.mappingVersionId || null;
        mappingPublicationId = hit.mappingPublicationId || null;
        mappingRuleVersion = hit.mappingRuleVersion || null;
        productGranularity =
          hit.mappingGranularity === 'spu'
            ? 'spu'
            : hit.mappingGranularity === 'sku'
              ? 'sku'
              : 'variant';
      } else if (hit?.productMappingStatus === 'conflict') {
        productMappingStatus = 'conflict';
        brandKeyOut = row.brandKey || null;
        unmapped += 1;
      } else {
        // 未命中：pending；不把上传 brand 冒充已确认品牌（仍写出提示值便于待映射清单）
        productMappingStatus = 'pending';
        brandKeyOut = row.brandKey || null;
        unmapped += 1;
      }

      const ratingNum = Number(row.rating);
      factRows.push({
        review_id: identity.reviewId,
        review_version_id: reviewVersionId,
        review_version: reviewVersion,
        source_review_id: identity.sourceReviewId,
        identity_namespace: identity.identityNamespace,
        identity_method: identity.identityMethod,
        identity_rule_version: IDENTITY_RULE_VERSION,
        identity_confidence: identity.identityConfidence,
        content_hash: contentHash,
        import_batch_id: input.importBatchId,
        raw_id: rawId,
        source_sheet: srcSheet,
        source_row_number: row.sourceRowNumber,
        source_row_hash: sourceRowHash,
        first_seen_at: ingestedAt,
        source_updated_at: row.sourceUpdatedAt || null,
        observed_at: ingestedAt,
        observation_time_basis: row.sourceUpdatedAt ? 'source_updated' : 'ingested',
        ingested_at: ingestedAt,
        schema_version: SCHEMA_VERSION,
        platform: row.platform,
        source_system: sourceSystem(row.platform),
        country_code: row.countryCode,
        store_id: row.storeId || null,
        source_scope_id: identity.sourceScopeId,
        date_precision: row.reviewDateKey.includes(' ') ? 'datetime' : 'date',
        review_created_at_local: row.reviewDateKey.includes(' ') ? row.reviewDateKey : null,
        review_created_at_utc: null,
        review_date_local: row.reviewDate,
        rating_raw: row.rating,
        rating_numeric: ratingNum,
        rating_scale_min: 1,
        rating_scale_max: 5,
        rating_rule_version: RATING_RULE_VERSION,
        rating_normalized_5: ratingNum,
        review_title_original: row.reviewTitle || null,
        review_text_original: row.reviewText || null,
        helpful_vote_count: row.helpfulVoteCount ? Number(row.helpfulVoteCount) : null,
        seller_reply_text: row.sellerReplyText || null,
        review_status: 'unknown',
        text_available: textAvailable,
        data_quality_status: 'valid',
        platform_product_id: row.platformProductId || null,
        asin: row.asin || null,
        platform_sku: row.platformSku || null,
        platform_product_name: row.platformProductName || null,
        review_scope: reviewScope,
        product_granularity: productGranularity,
        product_mapping_status: productMappingStatus,
        mapping_version_id: mappingVersionId,
        mapping_publication_id: mappingPublicationId,
        mapping_rule_version: mappingRuleVersion,
        mapping_updated_at: hit ? ingestedAt : null,
        brand_key: brandKeyOut,
        internal_spu: internalSpu,
        internal_sku: internalSku,
        product_name_cn: productNameCn,
        product_name_en: productNameEn,
      });

      obsRows.push({
        observation_id: sha256Hex(canonicalJson({ raw_id: rawId })),
        raw_id: rawId,
        import_batch_id: input.importBatchId,
        review_id: identity.reviewId,
        review_version_id: reviewVersionId,
        source_scope_id: identity.sourceScopeId,
        observed_at: ingestedAt,
        ingested_at: ingestedAt,
        observation_time_basis: row.sourceUpdatedAt ? 'source_updated' : 'ingested',
        observed_content_hash: contentHash,
        version_order_status: 'confirmed',
        helpful_vote_count: row.helpfulVoteCount ? Number(row.helpfulVoteCount) : null,
        seller_reply_text: row.sellerReplyText || null,
      });
      newRows += 1;
    }

    await store.insertRawRows(rawRows);
    await store.insertFactRows(factRows);
    await store.insertObservations(obsRows);
    await store.insertErrors(errRows);

    const completedAt = new Date().toISOString();
    const status =
      quarantined > 0 && newRows > 0
        ? 'partial_failed'
        : quarantined > 0 && newRows === 0
          ? 'failed'
          : 'completed';

    const summary: ImportBatchSummary = {
      ...existing,
      platform: fileScope.platform,
      countryCode: fileScope.countryCode,
      declaredBrandKey: fileScope.declaredBrandKey,
      importStatus: status,
      completedAt,
      totalRows: rows.length,
      newRows,
      updatedRows: 0,
      duplicateRows: duplicates,
      quarantinedRows: quarantined,
      unmappedRows: unmapped,
      textMissingRows: textMissing,
      errorCode: null,
      errorMessage: null,
      quarantineItems,
      duplicateItems,
    };
    store.memorySet(summary);
    await store.updateBatchStatus(input.importBatchId, {
      importStatus: status,
      completedAt,
      totalRows: rows.length,
      newRows,
      updatedRows: 0,
      duplicateRows: duplicates,
      quarantinedRows: quarantined,
      unmappedRows: unmapped,
      textMissingRows: textMissing,
      errorCode: null,
      errorMessage: null,
      platform: fileScope.platform,
      countryCode: fileScope.countryCode,
      declaredBrandKey: fileScope.declaredBrandKey,
      quarantineItems,
      duplicateItems,
    });

    void uploaded;
    void fileScope.sourceSystem;
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import failed';
    await store.updateBatchStatus(input.importBatchId, {
      importStatus: 'failed',
      completedAt: new Date().toISOString(),
      errorCode: 'import_failed',
      errorMessage: message.slice(0, 500),
    });
    throw e;
  }
}
