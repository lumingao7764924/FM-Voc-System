import type { ImportBatchSummary } from '@voc/shared';
import { labelImportBatchError } from '@voc/shared';
import { isImportJobActive } from './queue.js';
import * as store from './store.js';

const STALE_AWAITING_MS = 3 * 60 * 1000;

/**
 * 进程内任务已不在，但 BQ/内存仍显示 queued/running（或过久的 awaiting_upload）时，
 * 标为失败，避免前端无限轮询。
 */
export async function healBatchIfOrphaned(
  batch: ImportBatchSummary,
): Promise<ImportBatchSummary> {
  const id = batch.importBatchId;
  if (isImportJobActive(id)) return batch;

  const processing = batch.importStatus === 'queued' || batch.importStatus === 'running';
  let staleAwaiting = false;
  if (batch.importStatus === 'awaiting_upload') {
    const t = Date.parse(batch.uploadedAt);
    // 无法解析时间戳也视为陈旧（常见于 BQ 时间字段序列化异常）
    staleAwaiting = !Number.isFinite(t) || Date.now() - t > STALE_AWAITING_MS;
  }
  if (!processing && !staleAwaiting) return batch;

  const errorCode = processing ? 'job_interrupted' : 'job_interrupted_stale';
  const message = labelImportBatchError(errorCode);

  await store.updateBatchStatus(
    id,
    {
      importStatus: 'failed',
      completedAt: new Date().toISOString(),
      errorCode,
      errorMessage: message,
    },
    batch,
  );

  return store.memoryGet(id)!;
}
