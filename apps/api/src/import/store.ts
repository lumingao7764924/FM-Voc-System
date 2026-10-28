import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { env } from '../config.js';
import type { ImportBatchListResponse, ImportBatchSummary, ImportIssueItem, ImportStatus } from '@voc/shared';
import { labelImportIssueMessage } from '@voc/shared';

const memoryBatches = new Map<string, ImportBatchSummary & { rawCount?: number }>();
/** dry-run / 同进程内已写入的 source_row_hash，供跨批查重 */
const memorySourceRowHashes = new Set<string>();
/** dry-run / 进程内评论事实行（按 review_id） */
const memoryFactReviews = new Map<string, Record<string, unknown>>();

let bq: BigQuery | null = null;
let storage: Storage | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function getStorage(): Storage {
  if (!storage) storage = new Storage({ projectId: env.gcpProjectId });
  return storage;
}

export function memoryListFactReviews(): Record<string, unknown>[] {
  return [...memoryFactReviews.values()];
}

export function memoryPatchFactReview(
  reviewId: string,
  patch: Record<string, unknown>,
): boolean {
  const cur = memoryFactReviews.get(reviewId);
  if (!cur) return false;
  memoryFactReviews.set(reviewId, { ...cur, ...patch });
  return true;
}

export function memoryGet(batchId: string) {
  return memoryBatches.get(batchId);
}

export function memorySet(summary: ImportBatchSummary) {
  memoryBatches.set(summary.importBatchId, summary);
}

export async function uploadRawFile(
  importBatchId: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ uri: string; generation: string; hash: string }> {
  const { sha256Hex } = await import('../crypto.js');
  const hash = sha256Hex(buffer);
  if (env.importDryRun) {
    return {
      uri: `dry-run://local/${importBatchId}/source.xlsx`,
      generation: '0',
      hash,
    };
  }
  const object = `imports/${importBatchId}/source.xlsx`;
  const file = getStorage().bucket(env.gcsRawBucket).file(object);
  await file.save(buffer, {
    contentType,
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { metadata: { sha256: hash } },
  });
  const [meta] = await file.getMetadata();
  return {
    uri: `gs://${env.gcsRawBucket}/${object}`,
    generation: String(meta.generation ?? ''),
    hash,
  };
}

export async function insertBatchRow(row: Record<string, unknown>) {
  if (env.importDryRun) return;
  await getBq().dataset('review_control').table('review_import_batch').insert([row]);
}

export async function insertRawRows(rows: Record<string, unknown>[]) {
  if (env.importDryRun || rows.length === 0) return;
  const bqClient = getBq();
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    try {
      await bqClient
        .dataset('review_raw')
        .table('raw_review_source')
        .insert(rows.slice(i, i + chunk), { ignoreUnknownValues: true });
    } catch (e) {
      throw formatInsertError('raw_review_source', e);
    }
  }
}

export async function insertFactRows(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const h = row.source_row_hash;
    if (typeof h === 'string' && h) memorySourceRowHashes.add(h);
    const id = row.review_id;
    if (typeof id === 'string' && id) memoryFactReviews.set(id, row);
  }
  if (env.importDryRun || rows.length === 0) return;
  const bqClient = getBq();
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    try {
      await bqClient
        .dataset('review_core')
        .table('fact_review')
        .insert(slice, { ignoreUnknownValues: true });
    } catch (e) {
      throw formatInsertError('fact_review', e);
    }
    // 查重索引：review_control.source_row_hash_registry（见 sql/ddl/base_tables.sql）
    try {
      await bqClient
        .dataset('review_control')
        .table('source_row_hash_registry')
        .insert(
          slice.map((r) => ({
            source_row_hash: r.source_row_hash,
            review_id: r.review_id,
            import_batch_id: r.import_batch_id,
            first_seen_at: r.first_seen_at ?? r.ingested_at,
          })),
          { ignoreUnknownValues: true },
        );
    } catch (e) {
      console.warn(
        '[import] source_row_hash_registry insert skipped (ensure table exists via sql/ddl/base_tables.sql)',
        e instanceof Error ? e.message : e,
      );
    }
  }
}

function formatInsertError(table: string, e: unknown): Error {
  const anyErr = e as {
    message?: string;
    errors?: Array<{ errors?: Array<{ message?: string; reason?: string }> }>;
  };
  const sample = anyErr.errors?.[0]?.errors?.[0];
  const detail = sample
    ? `${sample.reason || 'error'}: ${sample.message || ''}`
    : anyErr.message || String(e);
  return Object.assign(new Error(`BigQuery insert ${table} failed — ${detail}`), {
    cause: e,
  });
}

/**
 * 按统一 source_row_hash 查历史是否已入库。
 * 优先 registry；表不存在时回退 fact_review；dry-run 只查本进程内存。
 */
export async function findExistingSourceRowHashes(
  hashes: string[],
): Promise<Set<string>> {
  const unique = [...new Set(hashes.filter(Boolean))];
  const found = new Set<string>();
  for (const h of unique) {
    if (memorySourceRowHashes.has(h)) found.add(h);
  }
  const remaining = unique.filter((h) => !found.has(h));
  if (env.importDryRun || remaining.length === 0) return found;

  const project = env.gcpProjectId;
  const chunk = 2000;
  for (let i = 0; i < remaining.length; i += chunk) {
    const slice = remaining.slice(i, i + chunk);
    let rows: Record<string, unknown>[] = [];
    try {
      const [result] = await getBq().query({
        query: `
          SELECT source_row_hash
          FROM \`${project}.review_control.source_row_hash_registry\`
          WHERE source_row_hash IN UNNEST(@hashes)
        `,
        params: { hashes: slice },
      });
      rows = result as Record<string, unknown>[];
    } catch {
      const [result] = await getBq().query({
        query: `
          SELECT DISTINCT source_row_hash
          FROM \`${project}.review_core.fact_review\`
          WHERE source_row_hash IN UNNEST(@hashes)
        `,
        params: { hashes: slice },
      });
      rows = result as Record<string, unknown>[];
    }
    for (const r of rows) {
      const h = r.source_row_hash;
      if (typeof h === 'string') {
        found.add(h);
        memorySourceRowHashes.add(h);
      }
    }
  }
  return found;
}

export async function insertObservations(rows: Record<string, unknown>[]) {
  if (env.importDryRun || rows.length === 0) return;
  const bqClient = getBq();
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await bqClient
      .dataset('review_core')
      .table('review_source_observation')
      .insert(rows.slice(i, i + chunk), { ignoreUnknownValues: true });
  }
}

export async function insertErrors(rows: Record<string, unknown>[]) {
  if (env.importDryRun || rows.length === 0) return;
  const bqClient = getBq();
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await bqClient
      .dataset('review_control')
      .table('review_import_error')
      .insert(rows.slice(i, i + chunk), { ignoreUnknownValues: true });
  }
}

export async function updateBatchStatus(
  importBatchId: string,
  patch: Partial<ImportBatchSummary> & { importStatus: ImportStatus },
  /** 进程重启后内存为空时，传入已读到的批次，避免写坏默认文件名/时间 */
  base?: ImportBatchSummary,
) {
  const current = memoryBatches.get(importBatchId) ?? base;
  const next: ImportBatchSummary = {
    ...(current ?? {
      importBatchId,
      importStatus: patch.importStatus,
      platform: 'other',
      countryCode: 'XX',
      declaredBrandKey: null,
      sourceFileName: 'source.xlsx',
      uploadedAt: new Date().toISOString(),
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
    }),
    ...patch,
  };
  memoryBatches.set(importBatchId, next);

  if (env.importDryRun) return;
  await getBq().dataset('review_control').table('review_import_batch').insert([
    {
      import_batch_id: importBatchId,
      request_idempotency_key: importBatchId,
      platform: next.platform,
      source_system: `${next.platform}_import`,
      source_provider: 'voc_web_upload',
      country_code: next.countryCode,
      source_scope_id: `scope_${next.platform}_${next.countryCode}`,
      source_file_name: next.sourceFileName,
      source_file_uri: `gs://${env.gcsRawBucket}/imports/${importBatchId}/source.xlsx`,
      coverage_mode: 'unknown',
      coverage_verified: false,
      template_version: 'voc_review_import_v1',
      parser_version: 'voc_xlsx_parser_v1',
      schema_version: 'v1.1',
      uploaded_by: 'system',
      // 保持原始 uploaded_at，避免“最新一行”排序被状态补丁打乱
      uploaded_at: next.uploadedAt,
      import_status: patch.importStatus,
      media_status: 'not_started',
      bq_job_ids: [],
      declared_brand_key: next.declaredBrandKey,
      total_rows: next.totalRows,
      new_rows: next.newRows,
      updated_rows: next.updatedRows ?? 0,
      duplicate_rows: next.duplicateRows ?? 0,
      quarantined_rows: next.quarantinedRows,
      unmapped_rows: next.unmappedRows,
      text_missing_rows: next.textMissingRows,
      completed_at: next.completedAt,
      error_code: next.errorCode,
      error_message: next.errorMessage,
    },
  ]);
}

function bqTimestamp(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v && 'value' in v) {
    return String((v as { value: unknown }).value);
  }
  return String(v);
}

function mapBqBatchRow(r: Record<string, unknown>): ImportBatchSummary {
  return {
    importBatchId: String(r.import_batch_id),
    importStatus: r.import_status as ImportStatus,
    platform: String(r.platform),
    countryCode: String(r.country_code),
    declaredBrandKey: (r.declared_brand_key as string) ?? null,
    sourceFileName: String(r.source_file_name),
    uploadedAt: bqTimestamp(r.uploaded_at) ?? new Date().toISOString(),
    completedAt: bqTimestamp(r.completed_at),
    totalRows: r.total_rows == null ? null : Number(r.total_rows),
    newRows: r.new_rows == null ? null : Number(r.new_rows),
    updatedRows: r.updated_rows == null ? null : Number(r.updated_rows),
    duplicateRows: r.duplicate_rows == null ? null : Number(r.duplicate_rows),
    quarantinedRows: r.quarantined_rows == null ? null : Number(r.quarantined_rows),
    unmappedRows: r.unmapped_rows == null ? null : Number(r.unmapped_rows),
    textMissingRows: r.text_missing_rows == null ? null : Number(r.text_missing_rows),
    errorCode: (r.error_code as string) ?? null,
    errorMessage: (r.error_message as string) ?? null,
  };
}

function stripDetails(s: ImportBatchSummary): ImportBatchSummary {
  const { quarantineItems: _q, duplicateItems: _d, ...rest } = s;
  return rest;
}

function humanizeIssueMessage(code: string, message: string): string {
  return labelImportIssueMessage(code, message);
}

function decodeIssueSafeMessage(
  safeMessage: string,
  errorCode: string,
): ImportIssueItem {
  try {
    const o = JSON.parse(safeMessage) as Record<string, unknown>;
    if (o && o.v === 1 && o.sourceRowNumber != null) {
      const code = String(o.code || errorCode);
      return {
        sourceRowNumber: Number(o.sourceRowNumber),
        code,
        message: humanizeIssueMessage(code, String(o.message || code)),
        brandKey: o.brandKey ? String(o.brandKey) : undefined,
        platform: o.platform ? String(o.platform) : undefined,
        platformSku: o.platformSku ? String(o.platformSku) : undefined,
        preview: o.preview ? String(o.preview) : undefined,
      };
    }
  } catch {
    // legacy plain text
  }
  const m = safeMessage.match(/^Row\s+(\d+):\s*(.*)$/i);
  const code = errorCode;
  return {
    sourceRowNumber: m ? Number(m[1]) : 0,
    code,
    message: humanizeIssueMessage(code, m?.[2] || safeMessage),
  };
}

function payloadStr(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const v = (payload as Record<string, unknown>)[key];
  return v == null ? '' : String(v).trim();
}

function previewFromRaw(payload: unknown, rawText: string | null): string | undefined {
  const title = payloadStr(payload, 'review_title');
  const text = payloadStr(payload, 'review_text') || (rawText || '').trim();
  const t = (title || text).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 240) : undefined;
}

function itemsNeedRawEnrich(items: ImportIssueItem[]): boolean {
  return items.some((i) => {
    if (i.sourceRowNumber <= 0) return false;
    const messageIsBareCode = !i.message || i.message === i.code;
    const missingMeta = !i.brandKey && !i.platform && !i.platformSku;
    return messageIsBareCode || missingMeta;
  });
}

/** 用 raw_review_source 补齐旧 error 行缺失的品牌/平台/SKU/评论摘要 */
async function enrichIssuesFromRaw(
  importBatchId: string,
  items: ImportIssueItem[],
): Promise<ImportIssueItem[]> {
  if (items.length === 0 || !itemsNeedRawEnrich(items)) return items;
  const rowNums = [...new Set(items.map((i) => i.sourceRowNumber).filter((n) => n > 0))];
  if (rowNums.length === 0) return items;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT
          source_row_number,
          platform,
          raw_text,
          raw_payload
        FROM \`${env.gcpProjectId}.review_raw.raw_review_source\`
        WHERE import_batch_id = @id
          AND source_row_number IN UNNEST(@rows)
      `,
      params: { id: importBatchId, rows: rowNums },
    });
    const byRow = new Map<number, Record<string, unknown>>();
    for (const r of rows as Record<string, unknown>[]) {
      byRow.set(Number(r.source_row_number), r);
    }
    return items.map((item) => {
      const raw = byRow.get(item.sourceRowNumber);
      if (!raw) {
        return { ...item, message: humanizeIssueMessage(item.code, item.message) };
      }
      let payload: unknown = raw.raw_payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const brandKey = item.brandKey || payloadStr(payload, 'brand_key') || undefined;
      const platform =
        item.platform || payloadStr(payload, 'platform') || String(raw.platform || '') || undefined;
      const platformSku = item.platformSku || payloadStr(payload, 'platform_sku') || undefined;
      const preview =
        item.preview ||
        previewFromRaw(payload, raw.raw_text == null ? null : String(raw.raw_text));
      return {
        ...item,
        message: humanizeIssueMessage(item.code, item.message),
        brandKey,
        platform,
        platformSku,
        preview,
      };
    });
  } catch (e) {
    console.error('[import] enrichIssuesFromRaw failed', e);
    return items.map((i) => ({ ...i, message: humanizeIssueMessage(i.code, i.message) }));
  }
}

/** 从 review_import_error 回填隔离 / 重复明细（刷新历史结果用） */
export async function loadIssueItems(importBatchId: string): Promise<{
  quarantineItems: ImportIssueItem[];
  duplicateItems: ImportIssueItem[];
}> {
  const empty = { quarantineItems: [] as ImportIssueItem[], duplicateItems: [] as ImportIssueItem[] };
  if (env.importDryRun) return empty;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT stage, error_code, safe_message
        FROM \`${env.gcpProjectId}.review_control.review_import_error\`
        WHERE import_batch_id = @id
        ORDER BY created_at ASC
      `,
      params: { id: importBatchId },
    });
    const quarantineItems: ImportIssueItem[] = [];
    const duplicateItems: ImportIssueItem[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      const stage = String(r.stage || '');
      const code = String(r.error_code || '');
      const item = decodeIssueSafeMessage(String(r.safe_message || ''), code);
      if (stage === 'dedup' || code.startsWith('duplicate_')) {
        duplicateItems.push(item);
      } else {
        quarantineItems.push(item);
      }
    }
    return {
      quarantineItems: await enrichIssuesFromRaw(importBatchId, quarantineItems),
      duplicateItems: await enrichIssuesFromRaw(importBatchId, duplicateItems),
    };
  } catch (e) {
    console.error('[import] loadIssueItems failed', e);
    return empty;
  }
}

async function withIssueItems(batch: ImportBatchSummary): Promise<ImportBatchSummary> {
  let quarantineItems = batch.quarantineItems;
  let duplicateItems = batch.duplicateItems;

  if (quarantineItems === undefined || duplicateItems === undefined) {
    const issues = await loadIssueItems(batch.importBatchId);
    quarantineItems = quarantineItems ?? issues.quarantineItems;
    duplicateItems = duplicateItems ?? issues.duplicateItems;
  } else if (
    itemsNeedRawEnrich(quarantineItems) ||
    itemsNeedRawEnrich(duplicateItems)
  ) {
    quarantineItems = await enrichIssuesFromRaw(batch.importBatchId, quarantineItems);
    duplicateItems = await enrichIssuesFromRaw(batch.importBatchId, duplicateItems);
  }

  return {
    ...batch,
    quarantineItems: quarantineItems ?? [],
    duplicateItems: duplicateItems ?? [],
  };
}

export async function fetchBatch(importBatchId: string): Promise<ImportBatchSummary | null> {
  const mem = memoryBatches.get(importBatchId);
  if (mem) {
    const hydrated = await withIssueItems(mem);
    if (hydrated !== mem) memoryBatches.set(importBatchId, hydrated);
    return hydrated;
  }
  if (env.importDryRun) return null;
  const [rows] = await getBq().query({
    query: `
      SELECT *
      FROM \`${env.gcpProjectId}.review_control.review_import_batch\`
      WHERE import_batch_id = @id
      ORDER BY COALESCE(completed_at, uploaded_at) DESC, uploaded_at DESC
      LIMIT 1
    `,
    params: { id: importBatchId },
  });
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const mapped = await withIssueItems(mapBqBatchRow(r));
  memoryBatches.set(importBatchId, mapped);
  return mapped;
}

/** 历史上传列表：dry-run 用内存；写真库时读 review_control.review_import_batch */
export async function listBatches(opts: {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
} = {}): Promise<ImportBatchListResponse> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? opts.pageSize ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);
  const page = opts.page ?? Math.floor(offset / limit) + 1;
  const pageSize = opts.pageSize ?? limit;
  const q = (opts.q ?? '').trim().toLowerCase();
  const status = (opts.status ?? '').trim().toLowerCase();

  const filterMem = (items: ImportBatchSummary[]) => {
    let next = items;
    if (status) next = next.filter((b) => b.importStatus.toLowerCase() === status);
    if (q) {
      next = next.filter((b) => {
        const hay = `${b.sourceFileName} ${b.importBatchId}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return next;
  };

  const fromMemory = [...memoryBatches.values()]
    .map(stripDetails)
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));

  if (env.importDryRun) {
    const filtered = filterMem(fromMemory);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  try {
    // BQ 侧先取较大窗口再与内存合并筛选分页（批次量通常不大）
    const fetchLimit = Math.min(500, Math.max(limit + offset, 100));
    const [rows] = await getBq().query({
      query: `
        SELECT * EXCEPT(rn)
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY import_batch_id
              ORDER BY COALESCE(completed_at, uploaded_at) DESC
            ) AS rn
          FROM \`${env.gcpProjectId}.review_control.review_import_batch\`
        )
        WHERE rn = 1
        ORDER BY COALESCE(completed_at, uploaded_at) DESC
        LIMIT @fetchLimit
      `,
      params: { fetchLimit },
    });
    const fromBq = (rows as Record<string, unknown>[]).map(mapBqBatchRow);
    const memById = new Map(fromMemory.map((b) => [b.importBatchId, b]));
    const merged = fromBq.map((b) => memById.get(b.importBatchId) ?? b);
    for (const m of fromMemory) {
      if (!merged.some((b) => b.importBatchId === m.importBatchId)) merged.unshift(m);
    }
    const sorted = merged.sort((a, b) =>
      String(b.uploadedAt).localeCompare(String(a.uploadedAt)),
    );
    const filtered = filterMem(sorted);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      page,
      pageSize,
    };
  } catch (e) {
    console.error('[import] listBatches BQ failed, falling back to memory', e);
    const filtered = filterMem(fromMemory);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      page,
      pageSize,
    };
  }
}
