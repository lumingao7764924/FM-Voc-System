/** Lightweight cross-component events (no extra service). */
import { notifyPageRefresh } from '@/hooks/use-page-refresh';

export const VOC_IMPORT_ACCEPTED = 'voc:import-accepted';
export const VOC_IMPORT_REFRESH = 'voc:import-refresh';

export function notifyImportAccepted(detail: {
  importBatchId: string;
  sourceFileName: string;
}) {
  window.dispatchEvent(new CustomEvent(VOC_IMPORT_ACCEPTED, { detail }));
  window.dispatchEvent(new CustomEvent(VOC_IMPORT_REFRESH));
  // 按路由定点：导入历史 + 该结果页 + 评论列表
  notifyPageRefresh([
    '/reviews/history',
    `/reviews/batches/${detail.importBatchId}`,
    '/reviews/list',
  ]);
}

export function notifyImportRefresh(batchId?: string) {
  window.dispatchEvent(new CustomEvent(VOC_IMPORT_REFRESH));
  notifyPageRefresh(
    batchId
      ? ['/reviews/history', `/reviews/batches/${batchId}`, '/reviews/list']
      : ['/reviews/history', '/reviews/list'],
  );
}
