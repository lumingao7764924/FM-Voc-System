import { randomUUID } from 'node:crypto';
import { BigQuery } from '@google-cloud/bigquery';
import type {
  AccessPolicy,
  AnalysisBatchCreateInput,
  AnalysisBatchDetail,
  AnalysisBatchSummary,
  IssueTaxonomyItem,
} from '@voc/shared';
import { DEFAULT_TAXONOMY_VERSION } from '@voc/shared';
import { env } from '../config.js';
import { sha256Hex } from '../crypto.js';
import { memoryListFactReviews } from '../import/store.js';
import { listTaxonomy } from '../taxonomy/store.js';
import {
  deriveBatchStatus,
  getMemoryBatch,
  insertAnalysisRun,
  listAnalysisCandidates,
  loadBatchDetail,
  memoryCountFormalIssues,
  memoryListRunsByBatch,
  persistFinishedBatch,
  persistFinishedRun,
  updateAnalysisRunStatus,
  upsertMemoryBatch,
  type MemIssue,
  type MemRun,
  type MemSegment,
} from './store.js';
import { classifyReview, resolveModelVersions } from './classify.js';

function nowIso() {
  return new Date().toISOString();
}

export async function createAnalysisBatch(input: {
  filters: AnalysisBatchCreateInput;
  access?: AccessPolicy;
  createdBy?: string;
}): Promise<AnalysisBatchSummary> {
  const limit = Math.min(
    env.analysisMaxReviews,
    Math.max(
      1,
      Number(input.filters.maxReviews ?? env.analysisMaxReviews) || env.analysisMaxReviews,
    ),
  );
  const candidates = await listAnalysisCandidates({
    filters: input.filters,
    limit,
    access: input.access,
  });

  const tax = await listTaxonomy({});
  const taxonomyVersion = tax.taxonomyVersion || DEFAULT_TAXONOMY_VERSION;
  const { modelVersion, promptVersion } = resolveModelVersions();
  const batchId = randomUUID();
  const createdAt = nowIso();

  const summary: AnalysisBatchSummary = {
    batchId,
    status: candidates.length ? 'queued' : 'failed',
    total: candidates.length,
    succeeded: 0,
    failed: candidates.length ? 0 : 1,
    pendingReview: 0,
    formalIssueCount: 0,
    modelVersion,
    promptVersion,
    taxonomyVersion,
    dryRun: env.importDryRun,
    createdAt,
    finishedAt: candidates.length ? null : createdAt,
    errorMessage: candidates.length
      ? null
      : '当前筛选下没有可分析的差评（需有正文且 1～3 星）',
    createdBy: input.createdBy?.trim() || null,
    filterSnapshot: { ...input.filters, maxReviews: limit },
    reviewIds: candidates.map((c) => c.reviewId),
  };
  upsertMemoryBatch(summary);

  if (!candidates.length) {
    await persistFinishedBatch(summary);
    return summary;
  }

  for (const c of candidates) {
    const inputHash = sha256Hex(
      JSON.stringify({
        text: c.reviewText,
        taxonomyVersion,
        modelVersion,
        promptVersion,
      }),
    );
    const run: MemRun = {
      analysis_run_id: randomUUID(),
      review_id: c.reviewId,
      review_version_id: c.reviewVersionId,
      batch_id: batchId,
      input_hash: inputHash,
      model_version: modelVersion,
      prompt_version: promptVersion,
      taxonomy_version: taxonomyVersion,
      analysis_status: 'queued',
      started_at: null,
      finished_at: null,
      error_code: null,
    };
    await insertAnalysisRun(run);
  }

  return summary;
}

export async function processAnalysisBatch(batchId: string): Promise<void> {
  const batch = getMemoryBatch(batchId);
  if (!batch || batch.total === 0) return;

  upsertMemoryBatch({ ...batch, status: 'running' });

  const tax = await listTaxonomy({ taxonomyVersion: batch.taxonomyVersion });
  const taxonomy: IssueTaxonomyItem[] = tax.items;
  const runs = memoryListRunsByBatch(batchId);

  let succeeded = 0;
  let failed = 0;
  let pendingReview = 0;
  /** 连续 LLM 不可达：熔断剩余，避免整批刷屏像死循环 */
  let consecutiveLlmUnreachable = 0;
  const LLM_UNREACHABLE_ABORT_AFTER = 3;

  for (let ri = 0; ri < runs.length; ri += 1) {
    const run = runs[ri]!;
    try {
      await updateAnalysisRunStatus(run.analysis_run_id, {
        analysis_status: 'running',
        started_at: nowIso(),
      });

      const text = await loadReviewText(run.review_id, run.review_version_id);
      if (!text.trim()) {
        await updateAnalysisRunStatus(run.analysis_run_id, {
          analysis_status: 'failed',
          finished_at: nowIso(),
          error_code: 'empty_text',
        });
        await persistFinishedRun({
          analysisRunId: run.analysis_run_id,
          segments: [],
          issues: [],
        });
        failed += 1;
        refreshBatchCounts(batchId, { succeeded, failed, pendingReview });
        continue;
      }

      const classified = await classifyReview({ reviewText: text, taxonomy });
      consecutiveLlmUnreachable = 0;

      const segmentRows: MemSegment[] = classified.segments.map((s) => ({
        segment_id: s.segmentId,
        review_id: run.review_id,
        review_version_id: run.review_version_id,
        analysis_run_id: run.analysis_run_id,
        segment_index: s.segmentIndex,
        segment_text_original: s.segmentTextOriginal,
        segment_text_translated_cn: null,
        segment_text_translated_en: null,
        aspect_term: s.aspectTerm,
        opinion_term: s.opinionTerm,
        sentiment: s.sentiment,
        sentiment_score: null,
        evidence_start: s.evidenceStart,
        evidence_end: s.evidenceEnd,
        segment_confidence: s.segmentConfidence,
        model_version: run.model_version,
        prompt_version: run.prompt_version,
      }));

      const issueRows: MemIssue[] = classified.issues.map((i) => ({
        review_issue_id: i.reviewIssueId,
        review_id: run.review_id,
        review_version_id: run.review_version_id,
        segment_id: i.segmentId,
        analysis_run_id: run.analysis_run_id,
        issue_l1_id: i.issueL1Id,
        issue_l2_id: i.issueL2Id,
        issue_l3_id: i.issueL3Id,
        issue_polarity: i.issuePolarity,
        severity_level: i.severityLevel,
        responsible_domain: i.responsibleDomain,
        evidence_quote_original: i.evidenceQuoteOriginal,
        evidence_quote_translated: null,
        classification_confidence: i.classificationConfidence,
        cluster_id: null,
        is_new_issue_candidate: false,
        is_safety_related: i.isSafetyRelated,
        is_product_controllable: i.isProductControllable,
        model_version: run.model_version,
        prompt_version: run.prompt_version,
        taxonomy_version: run.taxonomy_version,
      }));

      let status: MemRun['analysis_status'] = 'succeeded';
      let errorCode: string | null = null;
      if (classified.missingTaxonomy) {
        status = 'pending_review';
        errorCode = 'missing_taxonomy';
        pendingReview += 1;
      } else if (classified.hasSafety) {
        status = 'pending_review';
        errorCode = 'safety_related';
        pendingReview += 1;
      } else {
        succeeded += 1;
      }

      await updateAnalysisRunStatus(run.analysis_run_id, {
        analysis_status: status,
        finished_at: nowIso(),
        error_code: errorCode,
      });
      await persistFinishedRun({
        analysisRunId: run.analysis_run_id,
        segments: segmentRows,
        issues: issueRows,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const abortBatch =
        msg.startsWith('llm_unreachable') ||
        msg === 'llm_timeout' ||
        msg.startsWith('llm_protocol') ||
        /protocol_not_supported/i.test(msg) ||
        /客户端存在异常/i.test(msg);
      console.error(`[analysis] run failed ${run.analysis_run_id}`, e);
      await updateAnalysisRunStatus(run.analysis_run_id, {
        analysis_status: 'failed',
        finished_at: nowIso(),
        error_code: abortBatch
          ? msg.startsWith('llm_protocol') || /protocol_not_supported/i.test(msg)
            ? 'llm_protocol'
            : 'llm_unreachable'
          : 'classify_error',
      }).catch(() => undefined);
      await persistFinishedRun({
        analysisRunId: run.analysis_run_id,
        segments: [],
        issues: [],
      }).catch(() => undefined);
      failed += 1;

      if (abortBatch) {
        consecutiveLlmUnreachable += 1;
        // 协议错误一次即可停；网络错误累计 3 次
        const shouldAbort =
          msg.startsWith('llm_protocol') ||
          /protocol_not_supported/i.test(msg) ||
          consecutiveLlmUnreachable >= LLM_UNREACHABLE_ABORT_AFTER;
        if (shouldAbort) {
          const remaining = runs.slice(ri + 1);
          const abortCode =
            msg.startsWith('llm_protocol') || /protocol_not_supported/i.test(msg)
              ? 'llm_protocol'
              : 'llm_unreachable';
          console.error(
            `[analysis] abort batch ${batchId}: ${abortCode}, skip ${remaining.length} runs`,
          );
          for (const left of remaining) {
            await updateAnalysisRunStatus(left.analysis_run_id, {
              analysis_status: 'failed',
              finished_at: nowIso(),
              error_code: abortCode,
            }).catch(() => undefined);
            await persistFinishedRun({
              analysisRunId: left.analysis_run_id,
              segments: [],
              issues: [],
            }).catch(() => undefined);
            failed += 1;
          }
          refreshBatchCounts(batchId, { succeeded, failed, pendingReview });
          break;
        }
      } else {
        consecutiveLlmUnreachable = 0;
      }
    }

    refreshBatchCounts(batchId, { succeeded, failed, pendingReview });
  }

  const final = getMemoryBatch(batchId);
  if (final) {
    const done = succeeded + failed + pendingReview;
    const reviewIds =
      final.reviewIds?.length
        ? final.reviewIds
        : [...new Set(memoryListRunsByBatch(batchId).map((r) => r.review_id).filter(Boolean))];
    const next: AnalysisBatchSummary = {
      ...final,
      status: deriveBatchStatus({
        total: final.total,
        succeeded,
        failed,
        pendingReview,
        done,
      }),
      succeeded,
      failed,
      pendingReview,
      formalIssueCount: memoryCountFormalIssues(batchId),
      finishedAt: nowIso(),
      reviewIds,
    };
    await persistFinishedBatch(next);
  }
}

function refreshBatchCounts(
  batchId: string,
  counts: { succeeded: number; failed: number; pendingReview: number },
) {
  const mid = getMemoryBatch(batchId);
  if (!mid) return;
  const done = counts.succeeded + counts.failed + counts.pendingReview;
  upsertMemoryBatch({
    ...mid,
    status: deriveBatchStatus({
      total: mid.total,
      succeeded: counts.succeeded,
      failed: counts.failed,
      pendingReview: counts.pendingReview,
      done,
    }),
    succeeded: counts.succeeded,
    failed: counts.failed,
    pendingReview: counts.pendingReview,
    formalIssueCount: memoryCountFormalIssues(batchId),
  });
}

async function loadReviewText(reviewId: string, reviewVersionId: string): Promise<string> {
  if (env.importDryRun) {
    const row = memoryListFactReviews().find(
      (r) =>
        String(r.review_id) === reviewId &&
        String(r.review_version_id ?? '') === reviewVersionId,
    );
    return row?.review_text_original != null ? String(row.review_text_original) : '';
  }
  const bq = new BigQuery({ projectId: env.gcpProjectId });
  const table = `\`${env.gcpProjectId}.review_serving.v_review_current\``;
  const [rows] = await bq.query({
    query: `
      SELECT review_text_original
      FROM ${table}
      WHERE review_id = @reviewId AND review_version_id = @reviewVersionId
      LIMIT 1
    `,
    params: { reviewId, reviewVersionId },
  });
  const r = (rows as Record<string, unknown>[])[0];
  return r?.review_text_original != null ? String(r.review_text_original) : '';
}

export async function getAnalysisBatchDetail(
  batchId: string,
): Promise<AnalysisBatchDetail | null> {
  const tax = await listTaxonomy({});
  return loadBatchDetail(batchId, tax.items);
}
