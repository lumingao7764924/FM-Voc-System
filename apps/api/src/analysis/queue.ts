import { processAnalysisBatch } from './service.js';

const active = new Set<string>();

/**
 * Fire-and-forget analysis worker. Survives browser disconnect;
 * does NOT survive API process restart (in-memory queue + batch status).
 */
export function enqueueAnalysisBatch(batchId: string): void {
  if (active.has(batchId)) return;
  active.add(batchId);

  setImmediate(() => {
    void processAnalysisBatch(batchId)
      .catch((err) => {
        console.error(`[analysis] background job failed ${batchId}`, err);
      })
      .finally(() => {
        active.delete(batchId);
      });
  });
}

export function isAnalysisBatchActive(batchId: string) {
  return active.has(batchId);
}
