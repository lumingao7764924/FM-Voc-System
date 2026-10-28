import type { ImportStatus } from '@voc/shared';
import { IMPORT_STATUS_LABEL, labelImportStatus } from '@voc/shared';

/** @deprecated 请用 @voc/shared 的 IMPORT_STATUS_LABEL / labelImportStatus */
export const STATUS_LABEL = IMPORT_STATUS_LABEL;

export { labelImportStatus };

export function isPendingStatus(status: ImportStatus) {
  return status === 'awaiting_upload' || status === 'queued' || status === 'running';
}

/** 仍在后台处理中（用于轮询）；不含 awaiting_upload，避免空壳批次无限刷新 */
export function isProcessingStatus(status: ImportStatus) {
  return status === 'queued' || status === 'running';
}

export function formatUploadedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}
