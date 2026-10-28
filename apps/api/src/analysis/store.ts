import { BigQuery } from '@google-cloud/bigquery';
import type {
  AnalysisBatchCreateInput,
  AnalysisBatchDeleteResult,
  AnalysisBatchDetail,
  AnalysisBatchListResponse,
  AnalysisBatchStatus,
  AnalysisBatchSummary,
  AnalysisIssueTopItem,
  AnalysisRunStatus,
  IssueTaxonomyItem,
} from '@voc/shared';
import { env } from '../config.js';
import { bqTimestampString } from '../bqValue.js';
import { memoryListFactReviews } from '../import/store.js';
import {
  brandScopeParams,
  BRAND_SCOPE_PARAM_TYPES,
  filterMemoryReviews,
  normalizeReviewFilters,
  reviewFilterWhereSql,
  toFilterParams,
} from '../review/filters.js';
import type { AccessPolicy } from '@voc/shared';
import { applyBrandScopeToFilterBrand } from '../access/policy.js';

export type AnalysisCandidate = {
  reviewId: string;
  reviewVersionId: string;
  reviewText: string;
  rating: number | null;
};

export type MemRun = {
  analysis_run_id: string;
  review_id: string;
  review_version_id: string;
  batch_id: string;
  input_hash: string;
  model_version: string;
  prompt_version: string;
  taxonomy_version: string;
  analysis_status: AnalysisRunStatus;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  /** 是否已落库（避免流式缓冲上 UPDATE） */
  persisted?: boolean;
};

export type MemSegment = Record<string, unknown>;
export type MemIssue = Record<string, unknown> & {
  review_issue_id: string;
  review_id?: string;
  analysis_run_id: string;
  issue_l1_id: string;
  issue_l2_id: string | null;
  issue_l3_id: string | null;
  evidence_quote_original: string;
};

const memoryBatches = new Map<string, AnalysisBatchSummary>();
const memoryRuns = new Map<string, MemRun>();
const memorySegments: MemSegment[] = [];
const memoryIssues: MemIssue[] = [];

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

const NEGATIVE_RATING_MAX = 3;

/** 差评分析：在当前筛选上再限制为 1～3 星 */
export function effectiveNegativeRatingBounds(input: {
  ratingMin?: string;
  ratingMax?: string;
}): { ratingMin: string; ratingMax: string } {
  const filters = normalizeReviewFilters({
    ratingMin: input.ratingMin,
    ratingMax: input.ratingMax,
  });
  const min = filters.ratingMin ?? 1;
  const maxRaw = filters.ratingMax ?? NEGATIVE_RATING_MAX;
  const max = Math.min(maxRaw, NEGATIVE_RATING_MAX);
  const lo = Math.min(min, max);
  return { ratingMin: String(lo), ratingMax: String(max) };
}

export function getMemoryBatch(batchId: string): AnalysisBatchSummary | null {
  return memoryBatches.get(batchId) ?? null;
}

export function upsertMemoryBatch(summary: AnalysisBatchSummary) {
  memoryBatches.set(summary.batchId, summary);
}

export function memoryListRunsByBatch(batchId: string): MemRun[] {
  return [...memoryRuns.values()].filter((r) => r.batch_id === batchId);
}

export async function listAnalysisCandidates(input: {
  filters: AnalysisBatchCreateInput;
  limit: number;
  access?: AccessPolicy;
}): Promise<AnalysisCandidate[]> {
  const rating = effectiveNegativeRatingBounds(input.filters);
  const scope = input.access
    ? applyBrandScopeToFilterBrand(input.filters.brand, input.access)
    : {
        brand: (input.filters.brand ?? '').trim(),
        allowedBrands: null as string[] | null,
        denyAll: false,
      };
  const filters = normalizeReviewFilters({
    ...input.filters,
    brand: scope.brand,
    ratingMin: rating.ratingMin,
    ratingMax: rating.ratingMax,
  });
  const scopeParams = brandScopeParams(scope.allowedBrands, scope.denyAll);
  const limit = Math.max(1, Math.min(input.limit, env.analysisMaxReviews));

  if (env.importDryRun) {
    const all = memoryListFactReviews();
    const mapped = all.map((r) => ({
      reviewId: String(r.review_id ?? ''),
      reviewVersionId: String(r.review_version_id ?? ''),
      reviewText: r.review_text_original != null ? String(r.review_text_original) : '',
      rating:
        r.rating_normalized_5 == null && r.rating_numeric == null
          ? null
          : Number(r.rating_normalized_5 ?? r.rating_numeric),
      brandKey: r.brand_key != null ? String(r.brand_key) : null,
      countryCode: r.country_code != null ? String(r.country_code) : null,
      platform: r.platform != null ? String(r.platform) : null,
      platformSku: r.platform_sku != null ? String(r.platform_sku) : null,
      platformProductName:
        r.platform_product_name != null ? String(r.platform_product_name) : null,
      internalSpu: r.internal_spu != null ? String(r.internal_spu) : null,
      internalSku: r.internal_sku != null ? String(r.internal_sku) : null,
      productNameCn: r.product_name_cn != null ? String(r.product_name_cn) : null,
      productNameEn: r.product_name_en != null ? String(r.product_name_en) : null,
      productMappingStatus: String(r.product_mapping_status ?? 'pending'),
      reviewScope: r.review_scope != null ? String(r.review_scope) : null,
      reviewTitle: r.review_title_original != null ? String(r.review_title_original) : null,
      reviewDateLocal:
        r.review_date_local != null
          ? String(
              typeof r.review_date_local === 'object' &&
                r.review_date_local &&
                'value' in (r.review_date_local as object)
                ? (r.review_date_local as { value: unknown }).value
                : r.review_date_local,
            )
          : null,
    }));
    const filtered = filterMemoryReviews(mapped, filters, {
      allowedBrands: scope.allowedBrands,
      denyAll: scope.denyAll,
    });
    return filtered
      .filter((r) => r.reviewText.trim().length > 0 && r.reviewVersionId)
      .slice(0, limit)
      .map((r) => ({
        reviewId: r.reviewId,
        reviewVersionId: r.reviewVersionId,
        reviewText: r.reviewText.trim(),
        rating: r.rating,
      }));
  }

  const table = `\`${env.gcpProjectId}.review_serving.v_review_current\``;
  const whereSql = reviewFilterWhereSql();
  const sql = `
    SELECT
      review_id,
      review_version_id,
      review_text_original,
      rating_normalized_5,
      rating_numeric
    FROM ${table}
    ${whereSql}
      AND review_text_original IS NOT NULL
      AND TRIM(review_text_original) != ''
      AND review_version_id IS NOT NULL
    ORDER BY review_date_local DESC NULLS LAST, review_id
    LIMIT @limit
  `;
  const params = {
    ...toFilterParams(filters),
    ...scopeParams,
    limit,
  };
  const [rows] = await getBq().query({
    query: sql,
    params,
    types: BRAND_SCOPE_PARAM_TYPES,
  });
  return (rows as Record<string, unknown>[]).map((r) => ({
    reviewId: String(r.review_id ?? ''),
    reviewVersionId: String(r.review_version_id ?? ''),
    reviewText: String(r.review_text_original ?? '').trim(),
    rating:
      r.rating_normalized_5 == null && r.rating_numeric == null
        ? null
        : Number(r.rating_normalized_5 ?? r.rating_numeric),
  }));
}

/** 仅写内存；终态再 flush 到 BQ，避开 streaming buffer UPDATE */
export async function insertAnalysisRun(row: MemRun): Promise<void> {
  memoryRuns.set(row.analysis_run_id, { ...row, persisted: false });
}

export async function updateAnalysisRunStatus(
  analysisRunId: string,
  patch: {
    analysis_status: AnalysisRunStatus;
    started_at?: string | null;
    finished_at?: string | null;
    error_code?: string | null;
  },
): Promise<void> {
  const cur = memoryRuns.get(analysisRunId);
  if (!cur) return;
  memoryRuns.set(analysisRunId, {
    ...cur,
    analysis_status: patch.analysis_status,
    started_at: patch.started_at !== undefined ? patch.started_at : cur.started_at,
    finished_at: patch.finished_at !== undefined ? patch.finished_at : cur.finished_at,
    error_code: patch.error_code !== undefined ? patch.error_code : cur.error_code,
  });
}

/** 一条评论分析结束后：一次性写入 run + segments + issues */
export async function persistFinishedRun(input: {
  analysisRunId: string;
  segments: MemSegment[];
  issues: MemIssue[];
}): Promise<void> {
  const run = memoryRuns.get(input.analysisRunId);
  if (!run) return;

  if (input.segments.length) memorySegments.push(...input.segments);
  if (input.issues.length) memoryIssues.push(...input.issues);

  if (env.importDryRun) {
    memoryRuns.set(input.analysisRunId, { ...run, persisted: true });
    return;
  }

  const ds = getBq().dataset('review_semantic');
  await ds.table('analysis_run').insert([
    {
      analysis_run_id: run.analysis_run_id,
      review_id: run.review_id,
      review_version_id: run.review_version_id,
      batch_id: run.batch_id,
      input_hash: run.input_hash,
      model_version: run.model_version,
      prompt_version: run.prompt_version,
      taxonomy_version: run.taxonomy_version,
      analysis_status: run.analysis_status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      error_code: run.error_code,
    },
  ]);
  if (input.segments.length) {
    await ds.table('fact_review_segment').insert(input.segments);
  }
  if (input.issues.length) {
    await ds.table('fact_review_issue').insert(input.issues);
  }
  memoryRuns.set(input.analysisRunId, { ...run, persisted: true });
}

export function buildTopIssuesForBatch(
  batchId: string,
  taxonomy: IssueTaxonomyItem[],
): AnalysisIssueTopItem[] {
  const runIds = [...memoryRuns.values()]
    .filter((r) => r.batch_id === batchId)
    .map((r) => r.analysis_run_id);
  const nameById = new Map(taxonomy.map((t) => [t.issueId, t]));
  const agg = new Map<
    string,
    { reviewIds: Set<string>; sample: string | null; level: number; name: string }
  >();

  for (const issue of memoryIssues) {
    if (!runIds.includes(String(issue.analysis_run_id))) continue;
    const key =
      (issue.issue_l2_id && String(issue.issue_l2_id)) ||
      (issue.issue_l3_id && String(issue.issue_l3_id)) ||
      String(issue.issue_l1_id);
    const meta = nameById.get(key);
    const cur = agg.get(key) ?? {
      reviewIds: new Set<string>(),
      sample: null,
      level: meta?.issueLevel ?? 2,
      name: meta?.issueNameCn ?? key,
    };
    cur.reviewIds.add(String(issue.review_id ?? ''));
    if (!cur.sample && issue.evidence_quote_original) {
      cur.sample = String(issue.evidence_quote_original);
    }
    agg.set(key, cur);
  }

  return [...agg.entries()]
    .map(([issueId, v]) => ({
      issueId,
      issueNameCn: v.name,
      issueLevel: v.level,
      reviewCount: v.reviewIds.size,
      sampleEvidence: v.sample,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount || a.issueNameCn.localeCompare(b.issueNameCn, 'zh'))
    .slice(0, 20);
}

export function getBatchDetail(
  batchId: string,
  taxonomy: IssueTaxonomyItem[],
): AnalysisBatchDetail | null {
  const summary = memoryBatches.get(batchId);
  if (!summary) return null;
  return {
    ...summary,
    topIssues: buildTopIssuesForBatch(batchId, taxonomy),
  };
}

async function buildTopIssuesFromBq(
  batchId: string,
  taxonomy: IssueTaxonomyItem[],
): Promise<AnalysisIssueTopItem[]> {
  const project = env.gcpProjectId;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT
          i.issue_l1_id,
          i.issue_l2_id,
          i.issue_l3_id,
          i.evidence_quote_original,
          i.review_id
        FROM \`${project}.review_semantic.fact_review_issue\` i
        INNER JOIN \`${project}.review_semantic.analysis_run\` r
          ON r.analysis_run_id = i.analysis_run_id
        WHERE r.batch_id = @batchId
      `,
      params: { batchId },
    });
    const nameById = new Map(taxonomy.map((t) => [t.issueId, t]));
    const agg = new Map<
      string,
      { reviewIds: Set<string>; sample: string | null; level: number; name: string }
    >();
    for (const raw of rows as Record<string, unknown>[]) {
      const l2 = raw.issue_l2_id != null ? String(raw.issue_l2_id) : '';
      const l3 = raw.issue_l3_id != null ? String(raw.issue_l3_id) : '';
      const l1 = raw.issue_l1_id != null ? String(raw.issue_l1_id) : '';
      const key = l2 || l3 || l1;
      if (!key) continue;
      const meta = nameById.get(key);
      const cur = agg.get(key) ?? {
        reviewIds: new Set<string>(),
        sample: null,
        level: meta?.issueLevel ?? 2,
        name: meta?.issueNameCn ?? key,
      };
      cur.reviewIds.add(String(raw.review_id ?? ''));
      if (!cur.sample && raw.evidence_quote_original) {
        cur.sample = String(raw.evidence_quote_original);
      }
      agg.set(key, cur);
    }
    return [...agg.entries()]
      .map(([issueId, v]) => ({
        issueId,
        issueNameCn: v.name,
        issueLevel: v.level,
        reviewCount: v.reviewIds.size,
        sampleEvidence: v.sample,
      }))
      .sort(
        (a, b) =>
          b.reviewCount - a.reviewCount || a.issueNameCn.localeCompare(b.issueNameCn, 'zh'),
      )
      .slice(0, 20);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Not found: Table|not found/i.test(msg)) return [];
    throw e;
  }
}

/** 内存优先；不在内存则读 BQ 批次表 + 问题明细 */
export async function loadBatchDetail(
  batchId: string,
  taxonomy: IssueTaxonomyItem[],
): Promise<AnalysisBatchDetail | null> {
  const id = batchId.trim();
  if (!id) return null;
  const mem = getBatchDetail(id, taxonomy);
  if (mem) return mem;
  if (env.importDryRun) return null;

  const project = env.gcpProjectId;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT *
        FROM \`${project}.review_semantic.analysis_batch\`
        WHERE batch_id = @batchId
        LIMIT 1
      `,
      params: { batchId: id },
    });
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    const summary = mapBatchRow(row);
    const topIssues = await buildTopIssuesFromBq(id, taxonomy);
    return { ...summary, topIssues };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Not found: Table|not found/i.test(msg)) return null;
    throw e;
  }
}

export function deriveBatchStatus(counts: {
  total: number;
  succeeded: number;
  failed: number;
  pendingReview: number;
  done: number;
}): AnalysisBatchStatus {
  if (counts.total === 0) return 'failed';
  if (counts.done < counts.total) {
    return counts.done === 0 ? 'queued' : 'running';
  }
  // 批次只区分完成 / 失败：全部 run 失败才算失败；含待复核也算完成
  if (counts.failed === counts.total) return 'failed';
  return 'succeeded';
}

export function memoryCountFormalIssues(batchId: string): number {
  const runIds = new Set(
    [...memoryRuns.values()].filter((r) => r.batch_id === batchId).map((r) => r.analysis_run_id),
  );
  return memoryIssues.filter((i) => runIds.has(String(i.analysis_run_id))).length;
}

export function collectMemoryIssuesForBatch(batchId: string): MemIssue[] {
  const runIds = new Set(
    [...memoryRuns.values()].filter((r) => r.batch_id === batchId).map((r) => r.analysis_run_id),
  );
  return memoryIssues.filter((i) => runIds.has(String(i.analysis_run_id)));
}

function clearMemoryAnalysisArtifacts() {
  const batchCount = memoryBatches.size;
  const runCount = memoryRuns.size;
  const segmentCount = memorySegments.length;
  const issueCount = memoryIssues.length;
  memoryBatches.clear();
  memoryRuns.clear();
  memorySegments.length = 0;
  memoryIssues.length = 0;
  return { batchCount, runCount, segmentCount, issueCount };
}

function mapBatchRow(r: Record<string, unknown>): AnalysisBatchSummary {
  let filterSnapshot: AnalysisBatchCreateInput = {};
  let reviewIds: string[] | undefined;
  try {
    if (r.filter_snapshot_json) {
      const parsed = JSON.parse(String(r.filter_snapshot_json)) as AnalysisBatchCreateInput & {
        _reviewIds?: unknown;
      };
      const { _reviewIds, ...rest } = parsed;
      filterSnapshot = rest;
      if (Array.isArray(_reviewIds)) {
        reviewIds = _reviewIds.map((x) => String(x)).filter(Boolean);
      }
    }
  } catch {
    filterSnapshot = {};
  }
  return {
    batchId: String(r.batch_id ?? ''),
    status: String(r.analysis_status ?? 'failed') as AnalysisBatchStatus,
    total: Number(r.total_count ?? 0),
    succeeded: Number(r.succeeded_count ?? 0),
    failed: Number(r.failed_count ?? 0),
    pendingReview: Number(r.pending_review_count ?? 0),
    formalIssueCount: Number(r.formal_issue_count ?? 0),
    modelVersion: String(r.model_version ?? ''),
    promptVersion: String(r.prompt_version ?? ''),
    taxonomyVersion: String(r.taxonomy_version ?? ''),
    dryRun: false,
    createdAt: bqTimestampString(r.created_at) ?? new Date().toISOString(),
    finishedAt: bqTimestampString(r.finished_at),
    errorMessage: r.error_message != null ? String(r.error_message) : null,
    createdBy: r.created_by != null ? String(r.created_by) : null,
    filterSnapshot,
    reviewIds,
  };
}

function batchToRow(s: AnalysisBatchSummary): Record<string, unknown> {
  return {
    batch_id: s.batchId,
    analysis_status: s.status,
    total_count: s.total,
    succeeded_count: s.succeeded,
    failed_count: s.failed,
    pending_review_count: s.pendingReview,
    formal_issue_count: s.formalIssueCount,
    model_version: s.modelVersion,
    prompt_version: s.promptVersion,
    taxonomy_version: s.taxonomyVersion,
    filter_snapshot_json: JSON.stringify({
      ...(s.filterSnapshot ?? {}),
      _reviewIds: s.reviewIds ?? [],
    }),
    created_by: s.createdBy,
    created_at: s.createdAt,
    finished_at: s.finishedAt,
    error_message: s.errorMessage,
  };
}

/** 批次终态一次性写入 BQ（避开 streaming UPDATE） */
export async function persistFinishedBatch(summary: AnalysisBatchSummary): Promise<void> {
  upsertMemoryBatch(summary);
  if (env.importDryRun) return;
  try {
    await getBq()
      .dataset('review_semantic')
      .table('analysis_batch')
      .insert([batchToRow(summary)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Not found: Table|not found/i.test(msg)) {
      console.warn('[analysis] analysis_batch table missing; skip persist', msg);
      return;
    }
    throw e;
  }
}

export async function listAnalysisBatches(input: {
  page?: number;
  pageSize?: number;
}): Promise<AnalysisBatchListResponse> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const memItems = [...memoryBatches.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  if (env.importDryRun) {
    return {
      items: memItems.slice(offset, offset + pageSize),
      total: memItems.length,
      page,
      pageSize,
    };
  }

  const project = env.gcpProjectId;
  const table = `\`${project}.review_semantic.analysis_batch\``;
  try {
    const [[countRows], [rows]] = await Promise.all([
      getBq().query({ query: `SELECT COUNT(1) AS total FROM ${table}` }),
      getBq().query({
        query: `
          SELECT *
          FROM ${table}
          ORDER BY created_at DESC
          LIMIT @limit OFFSET @offset
        `,
        params: { limit: pageSize, offset },
      }),
    ]);
    const bqItems = (rows as Record<string, unknown>[]).map(mapBatchRow);
    const bqIds = new Set(bqItems.map((i) => i.batchId));
    // 进行中的内存批次（尚未 persist）插到最前
    const runningMem = memItems.filter(
      (m) =>
        !bqIds.has(m.batchId) &&
        (m.status === 'queued' || m.status === 'running'),
    );
    const merged = [...runningMem, ...bqItems];
    const bqTotal = Number((countRows as Record<string, unknown>[])[0]?.total ?? 0);
    return {
      items: merged.slice(0, pageSize),
      total: bqTotal + runningMem.length,
      page,
      pageSize,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Not found: Table|not found/i.test(msg)) {
      return {
        items: memItems.slice(offset, offset + pageSize),
        total: memItems.length,
        page,
        pageSize,
      };
    }
    throw e;
  }
}

export async function deleteAnalysisBatch(batchId: string): Promise<AnalysisBatchDeleteResult> {
  const id = batchId.trim();
  if (!id) {
    return {
      batchId: '',
      dryRun: env.importDryRun,
      deletedRuns: 0,
      deletedSegments: 0,
      deletedIssues: 0,
      message: '缺少 batchId',
    };
  }

  const runs = memoryListRunsByBatch(id);
  const runIds = new Set(runs.map((r) => r.analysis_run_id));
  let deletedSegments = 0;
  let deletedIssues = 0;
  for (let i = memorySegments.length - 1; i >= 0; i -= 1) {
    if (runIds.has(String(memorySegments[i].analysis_run_id))) {
      memorySegments.splice(i, 1);
      deletedSegments += 1;
    }
  }
  for (let i = memoryIssues.length - 1; i >= 0; i -= 1) {
    if (runIds.has(String(memoryIssues[i].analysis_run_id))) {
      memoryIssues.splice(i, 1);
      deletedIssues += 1;
    }
  }
  for (const r of runs) memoryRuns.delete(r.analysis_run_id);
  memoryBatches.delete(id);
  const deletedRuns = runs.length;

  if (env.importDryRun) {
    return {
      batchId: id,
      dryRun: true,
      deletedRuns,
      deletedSegments,
      deletedIssues,
      message: `已从内存删除批次 ${id}`,
    };
  }

  const project = env.gcpProjectId;
  const bqClient = getBq();
  try {
    // 先按 batch 找 run id，再删明细
    const [runRows] = await bqClient.query({
      query: `
        SELECT analysis_run_id
        FROM \`${project}.review_semantic.analysis_run\`
        WHERE batch_id = @batchId
      `,
      params: { batchId: id },
    });
    const bqRunIds = (runRows as Record<string, unknown>[]).map((r) =>
      String(r.analysis_run_id ?? ''),
    ).filter(Boolean);

    if (bqRunIds.length) {
      await bqClient.query({
        query: `
          DELETE FROM \`${project}.review_semantic.fact_review_issue\`
          WHERE analysis_run_id IN UNNEST(@ids)
        `,
        params: { ids: bqRunIds },
        types: { ids: ['STRING'] },
      });
      await bqClient.query({
        query: `
          DELETE FROM \`${project}.review_semantic.fact_review_segment\`
          WHERE analysis_run_id IN UNNEST(@ids)
        `,
        params: { ids: bqRunIds },
        types: { ids: ['STRING'] },
      });
      await bqClient.query({
        query: `
          DELETE FROM \`${project}.review_semantic.analysis_run\`
          WHERE batch_id = @batchId
        `,
        params: { batchId: id },
      });
    }
    await bqClient.query({
      query: `
        DELETE FROM \`${project}.review_semantic.analysis_batch\`
        WHERE batch_id = @batchId
      `,
      params: { batchId: id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/Not found: Table|not found/i.test(msg)) throw e;
  }

  return {
    batchId: id,
    dryRun: false,
    deletedRuns: Math.max(deletedRuns, 0),
    deletedSegments,
    deletedIssues,
    message: `已删除批次 ${id}`,
  };
}

/** 清空 AI 分析产物（batch / run / segment / issue）；不影响评论、分类树、权限 */
export async function clearAnalysisArtifacts(): Promise<{
  dryRun: boolean;
  memory: { batchCount: number; runCount: number; segmentCount: number; issueCount: number };
  bigQuery: { analysisRun: number; segment: number; issue: number; batch: number } | null;
}> {
  const memory = clearMemoryAnalysisArtifacts();
  if (env.importDryRun) {
    return { dryRun: true, memory, bigQuery: null };
  }

  const project = env.gcpProjectId;
  const bqClient = getBq();

  async function deleteAll(table: string): Promise<number> {
    const fq = `\`${project}.review_semantic.${table}\``;
    try {
      const [[before]] = await bqClient.query({
        query: `SELECT COUNT(1) AS c FROM ${fq}`,
      });
      const count = Number((before as { c?: unknown })?.c ?? 0);
      if (count > 0) {
        await bqClient.query({ query: `DELETE FROM ${fq} WHERE TRUE` });
      }
      return count;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Not found: Table|not found/i.test(msg)) return 0;
      throw e;
    }
  }

  const issue = await deleteAll('fact_review_issue');
  const segment = await deleteAll('fact_review_segment');
  const analysisRun = await deleteAll('analysis_run');
  const batch = await deleteAll('analysis_batch');

  return {
    dryRun: false,
    memory,
    bigQuery: { analysisRun, segment, issue, batch },
  };
}
