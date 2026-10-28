import type { ImportBatchSummary } from '@voc/shared';
import { processImportFile } from './service.js';

const active = new Set<string>();

/**
 * Fire-and-forget import worker. Survives browser disconnect;
 * does NOT survive API process restart (in-memory queue).
 */
export function enqueueImportJob(input: {
  importBatchId: string;
  buffer: Buffer;
  contentType: string;
  uploadedBy: string;
}): void {
  const { importBatchId } = input;
  if (active.has(importBatchId)) return;
  active.add(importBatchId);

  setImmediate(() => {
    void processImportFile(input)
      .catch((err) => {
        console.error(`[import] background job failed ${importBatchId}`, err);
      })
      .finally(() => {
        active.delete(importBatchId);
      });
  });
}

export function isImportJobActive(importBatchId: string) {
  return active.has(importBatchId);
}

export type { ImportBatchSummary };
