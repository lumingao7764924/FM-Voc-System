import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisBatchListResponse,
  AnalysisBatchStatus,
  AnalysisBatchSummary,
  AnalysisClearResult,
  AnalysisBatchDeleteResult,
} from '@voc/shared';
import {
  ANALYSIS_HISTORY_COPY,
  ANALYTICS_COPY,
  canDeleteAnalysis,
} from '@voc/shared';
import { Loader2, Trash2 } from 'lucide-react';
import { apiFetch } from '@/api';
import { PageHeader, PageTitle } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { useAuth } from '@/hooks/use-auth';
import { usePageRefresh, notifyPageRefresh } from '@/hooks/use-page-refresh';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { buildListQuery } from '@/lib/list-query';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const STATUS_LABEL: Record<AnalysisBatchStatus, string> = {
  queued: ANALYSIS_HISTORY_COPY.statusQueued,
  running: ANALYSIS_HISTORY_COPY.statusRunning,
  succeeded: ANALYSIS_HISTORY_COPY.statusSucceeded,
  failed: ANALYSIS_HISTORY_COPY.statusFailed,
  // 历史数据可能仍是 partial，统一展示为已完成
  partial: ANALYSIS_HISTORY_COPY.statusSucceeded,
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function AnalysisHistoryPage({ isActive: _isActive = true }: { isActive?: boolean }) {
  const { access } = useAuth();
  const { openPath } = useWorkspaceTabs();
  const canDelete = access ? canDeleteAnalysis(access) : false;
  const isMobile = useIsMobile();
  const [items, setItems] = useState<AnalysisBatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const loadGenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(
    async (poll: boolean) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const gen = ++loadGenRef.current;
      if (!poll) setLoading(true);
      try {
        const res = await apiFetch<AnalysisBatchListResponse>(
          `/api/analysis/batches?${buildListQuery({ page, pageSize })}`,
        );
        if (gen !== loadGenRef.current) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
        const hasPending = res.items.some(
          (b) => b.status === 'queued' || b.status === 'running',
        );
        if (poll && hasPending) {
          timerRef.current = setTimeout(() => void load(true), 2000);
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        toast({
          title: ANALYSIS_HISTORY_COPY.loadFailed,
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  useEffect(() => {
    void load(true);
    return () => {
      loadGenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  usePageRefresh('/analytics/history', () => {
    void load(true);
  });

  async function onDeleteOne(batchId: string) {
    if (!canDelete) {
      toast({ title: ANALYSIS_HISTORY_COPY.needDeletePermission, variant: 'destructive' });
      return;
    }
    if (!window.confirm(ANALYSIS_HISTORY_COPY.deleteOneConfirm)) return;
    setBusyId(batchId);
    try {
      const res = await apiFetch<AnalysisBatchDeleteResult>(
        `/api/analysis/batches/${encodeURIComponent(batchId)}`,
        { method: 'DELETE' },
      );
      toast({ title: ANALYSIS_HISTORY_COPY.deleteOneOk, description: res.message });
      notifyPageRefresh('/analytics/history');
      await load(false);
    } catch (e) {
      toast({
        title: ANALYSIS_HISTORY_COPY.deleteOneFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onClearAll() {
    if (!canDelete) {
      toast({ title: ANALYSIS_HISTORY_COPY.needDeletePermission, variant: 'destructive' });
      return;
    }
    if (!window.confirm(ANALYTICS_COPY.clearAnalysisConfirm)) return;
    setClearBusy(true);
    try {
      const res = await apiFetch<AnalysisClearResult>('/api/analysis/clear', {
        method: 'POST',
        json: {},
      });
      toast({ title: ANALYTICS_COPY.clearAnalysisOk, description: res.message });
      setPage(1);
      notifyPageRefresh('/analytics/history');
      await load(false);
    } catch (e) {
      toast({
        title: ANALYTICS_COPY.clearAnalysisFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setClearBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title={<PageTitle>{ANALYSIS_HISTORY_COPY.pageTitle}</PageTitle>}
        actions={
          canDelete ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={clearBusy || loading}
              onClick={() => void onClearAll()}
            >
              {clearBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {clearBusy
                ? ANALYTICS_COPY.clearAnalysisBusy
                : ANALYSIS_HISTORY_COPY.clearAll}
            </Button>
          ) : null
        }
      />
      <p className="text-sm text-muted-foreground">{ANALYSIS_HISTORY_COPY.pageHint}</p>

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ANALYSIS_HISTORY_COPY.empty}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{ANALYSIS_HISTORY_COPY.colTime}</th>
                <th className="px-3 py-2 font-medium">{ANALYSIS_HISTORY_COPY.colStatus}</th>
                <th className="px-3 py-2 font-medium tabular-nums">
                  {ANALYSIS_HISTORY_COPY.colTotal}
                </th>
                <th className="px-3 py-2 font-medium tabular-nums">
                  {ANALYSIS_HISTORY_COPY.colIssues}
                </th>
                <th className="px-3 py-2 font-medium">{ANALYSIS_HISTORY_COPY.colModel}</th>
                <th className="px-3 py-2 font-medium text-right">
                  {ANALYSIS_HISTORY_COPY.colActions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((b) => (
                <tr
                  key={b.batchId}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() =>
                    openPath(
                      `/analytics/batches/${b.batchId}`,
                      `差评报告 ${b.batchId.slice(0, 8)}`,
                    )
                  }
                >
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {formatTime(b.createdAt)}
                    {b.createdBy ? (
                      <div className="text-[11px] text-muted-foreground/80">{b.createdBy}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[b.status] ?? b.status}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {b.succeeded + b.failed + b.pendingReview}/{b.total}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{b.formalIssueCount}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-muted-foreground">
                    {b.modelVersion}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div
                      className="inline-flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() =>
                          openPath(
                            `/analytics/batches/${b.batchId}`,
                            `差评报告 ${b.batchId.slice(0, 8)}`,
                          )
                        }
                      >
                        {ANALYSIS_HISTORY_COPY.viewReport}
                      </Button>
                      {canDelete ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1 text-destructive hover:text-destructive"
                          disabled={busyId === b.batchId || clearBusy}
                          onClick={() => void onDeleteOne(b.batchId)}
                        >
                          {busyId === b.batchId ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          {ANALYSIS_HISTORY_COPY.deleteOne}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > pageSize ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            共 {total} 条 · {page}/{pageCount}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-4" />
            {!isMobile ? '上一页' : null}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            {!isMobile ? '下一页' : null}
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
