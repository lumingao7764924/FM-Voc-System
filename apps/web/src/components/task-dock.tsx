import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, History, Loader2, Upload } from 'lucide-react';
import type { ImportBatchSummary, ImportStatus } from '@voc/shared';
import { labelImportStatus } from '@voc/shared';
import { apiFetch } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { notifyPageRefresh } from '@/hooks/use-page-refresh';
import { VOC_IMPORT_ACCEPTED, VOC_IMPORT_REFRESH } from '@/lib/import-events';
import { formatUploadedAt, isPendingStatus, isProcessingStatus } from '@/lib/import-status';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'voc-dock-batch-ids';

function isDone(status: ImportStatus) {
  return (
    status === 'completed' ||
    status === 'partial_failed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'deduplicated'
  );
}

function readSessionIds(): string[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeSessionIds(ids: string[]) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids.slice(0, 20)));
}

function addSessionId(id: string) {
  const ids = readSessionIds().filter((x) => x !== id);
  ids.unshift(id);
  writeSessionIds(ids);
}

/** 浮窗只显示本浏览器会话上传过的批次，不读历史上传 / BQ 列表 */
export function TaskDock() {
  const { openPath } = useWorkspaceTabs();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ImportBatchSummary[]>([]);
  const prevStatus = useRef<Map<string, ImportStatus>>(new Map());
  const openRef = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  openRef.current = open;

  const load = useCallback(async () => {
    const ids = readSessionIds();
    if (ids.length === 0) {
      setItems([]);
      return;
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          return await apiFetch<ImportBatchSummary>(`/api/imports/${id}`);
        } catch {
          return null;
        }
      }),
    );

    const next = results.filter((b): b is ImportBatchSummary => Boolean(b));

    for (const b of next) {
      const prev = prevStatus.current.get(b.importBatchId);
      if (prev && isPendingStatus(prev) && isDone(b.importStatus)) {
        // 定点路由：历史 + 这一条结果页 + 评论列表（导入完成后数据已入库）
        notifyPageRefresh(['/reviews/history', `/reviews/batches/${b.importBatchId}`, '/reviews/list']);
        if (!openRef.current) {
          const ok = b.importStatus === 'completed' || b.importStatus === 'partial_failed';
          toast({
            variant: ok ? 'success' : 'destructive',
            title: ok ? '导入完成' : '导入失败',
            description: `${b.sourceFileName} · ${labelImportStatus(b.importStatus)}`,
          });
        }
      }
      prevStatus.current.set(b.importBatchId, b.importStatus);
    }

    // Keep session order
    const byId = new Map(next.map((b) => [b.importBatchId, b]));
    setItems(ids.map((id) => byId.get(id)).filter((b): b is ImportBatchSummary => Boolean(b)));
  }, []);

  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }

    /** 有 queued/running 才继续轮询；全部结束后停止访问 */
    async function refreshAndMaybePoll() {
      clearTimer();
      try {
        await loadRef.current();
      } catch {
        // ignore
      }
      if (cancelled) return;
      const hasProcessing = [...prevStatus.current.values()].some(isProcessingStatus);
      if (hasProcessing) {
        timer = setTimeout(() => void refreshAndMaybePoll(), 1200);
      }
    }

    // 首屏拉一次展示列表；若无进行中任务则不再请求
    void refreshAndMaybePoll();

    function onAccepted(ev: Event) {
      const detail = (ev as CustomEvent<{ importBatchId: string }>).detail;
      if (detail?.importBatchId) addSessionId(detail.importBatchId);
      void refreshAndMaybePoll();
    }
    function onRefresh() {
      void refreshAndMaybePoll();
    }

    window.addEventListener(VOC_IMPORT_ACCEPTED, onAccepted);
    window.addEventListener(VOC_IMPORT_REFRESH, onRefresh);

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener(VOC_IMPORT_ACCEPTED, onAccepted);
      window.removeEventListener(VOC_IMPORT_REFRESH, onRefresh);
    };
  }, []);

  const pending = items.filter((b) => isPendingStatus(b.importStatus));
  const badgeCount = pending.length;

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(100vw-2.5rem,22rem)] flex-col items-end gap-3">
      {open ? (
        <div className="pointer-events-auto w-full overflow-hidden rounded-xl border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              导入任务
              {badgeCount > 0 ? (
                <Badge variant="secondary">{badgeCount} 进行中</Badge>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">本会话</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="导入历史"
                onClick={() => openPath('/reviews/history')}
              >
                <History className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="收起"
                onClick={() => setOpen(false)}
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {items.map((b) => {
              const pendingItem = isPendingStatus(b.importStatus);
              return (
                <li key={b.importBatchId}>
                  <button
                    type="button"
                    className={cn(
                      'block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                      pendingItem && 'bg-muted/30',
                    )}
                    onClick={() => openPath(`/reviews/batches/${b.importBatchId}`, b.sourceFileName)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{b.sourceFileName}</p>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {pendingItem ? <Loader2 className="size-3 animate-spin" /> : null}
                        {labelImportStatus(b.importStatus)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pendingItem
                        ? '后台处理中…'
                        : `${formatUploadedAt(b.uploadedAt)}${b.totalRows != null ? ` · ${b.totalRows} 行` : ''}`}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={open ? '收起导入任务' : '打开导入任务'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'pointer-events-auto relative flex size-11 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground',
          'shadow-lg shadow-black/25 ring-1 ring-black/5',
          'transition hover:scale-105 hover:shadow-xl active:scale-95',
          'dark:shadow-black/50',
        )}
      >
        {badgeCount > 0 ? (
          <Loader2 className="size-5 animate-spin" strokeWidth={2} />
        ) : (
          <Upload className="size-5" strokeWidth={2} />
        )}
        {badgeCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white shadow">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
