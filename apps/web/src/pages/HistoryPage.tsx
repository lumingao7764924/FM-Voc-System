import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ImportBatchListResponse, ImportBatchSummary } from '@voc/shared';
import {
  IMPORT_RESULT_STAT_LABEL,
  IMPORT_STATUS_LABEL,
  labelImportStatus,
  type ImportStatus,
} from '@voc/shared';
import { apiFetch } from '@/api';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { usePageRefresh } from '@/hooks/use-page-refresh';
import { PageHeader } from '@/components/page-header';
import { ListFiltersPanel, type ListFilterField } from '@/components/list-filters';
import { formatUploadedAt, isProcessingStatus } from '@/lib/import-status';
import { buildListQuery } from '@/lib/list-query';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export function HistoryPage({ isActive: _isActive = true }: { isActive?: boolean }) {
  const { openPath } = useWorkspaceTabs();
  const isMobile = useIsMobile();
  const [items, setItems] = useState<ImportBatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadGenRef = useRef(0);

  const load = useCallback(
    async (poll: boolean) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const gen = ++loadGenRef.current;
      if (!poll) setLoading(true);
      try {
        const res = await apiFetch<ImportBatchListResponse>(
          `/api/imports?${buildListQuery({
            page,
            pageSize,
            q: filters.q,
            status: filters.status,
          })}`,
        );
        if (gen !== loadGenRef.current) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
        const hasPending = res.items.some((b) => isProcessingStatus(b.importStatus));
        if (poll && hasPending) {
          timerRef.current = setTimeout(() => void load(true), 2000);
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        toast({
          title: '加载失败',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
        setLoading(false);
      }
    },
    [page, pageSize, filters.q, filters.status],
  );

  useEffect(() => {
    void load(true);
    return () => {
      loadGenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  usePageRefresh('/reviews/history', () => {
    void load(true);
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(filters.q || filters.status);

  const filterFields: ListFilterField[] = useMemo(
    () => [
      {
        id: 'q',
        label: '文件名 / 批次 ID',
        placeholder: '文件名 / 批次 ID',
      },
      {
        id: 'status',
        label: '状态',
        type: 'select',
        options: [
          { value: '', label: '全部状态' },
          ...(Object.keys(IMPORT_STATUS_LABEL) as ImportStatus[]).map((s) => ({
            value: s,
            label: IMPORT_STATUS_LABEL[s],
          })),
        ],
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="导入历史"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/reviews/import">新建上传</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <ListFiltersPanel
          filters={filterFields}
          values={filters}
          onChange={(next) => {
            setFilters({ q: next.q ?? '', status: next.status ?? '' });
            setPage(1);
          }}
        />
        {!loading || total > 0 ? (
          <span className="text-sm text-muted-foreground">共 {total} 条</span>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载历史…
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">暂无记录</CardTitle>
            <CardDescription>
              {hasFilters
                ? '当前筛选条件下没有批次。'
                : '上传第一份评论文件后，批次会出现在这里。'}
            </CardDescription>
          </CardHeader>
          {!hasFilters ? (
            <CardContent>
              <Button asChild variant="outline">
                <Link to="/reviews/import">去上传</Link>
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {items.length > 0 ? (
        <div className="relative">
          <div
            className={`grid gap-3 sm:grid-cols-2${loading ? ' pointer-events-none opacity-60' : ''}`}
          >
            {items.map((b) => (
              <button
                key={b.importBatchId}
                type="button"
                className="block w-full text-left"
                onClick={() => openPath(`/reviews/batches/${b.importBatchId}`, b.sourceFileName)}
              >
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate text-base">{b.sourceFileName}</CardTitle>
                      <Badge variant="secondary">{labelImportStatus(b.importStatus)}</Badge>
                    </div>
                    <CardDescription className="break-all text-xs">
                      {b.importBatchId}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <p>{formatUploadedAt(b.uploadedAt)}</p>
                    <p>
                      {IMPORT_RESULT_STAT_LABEL.totalRows} {b.totalRows ?? '-'} ·{' '}
                      {IMPORT_RESULT_STAT_LABEL.newRows} {b.newRows ?? '-'} ·{' '}
                      {IMPORT_RESULT_STAT_LABEL.quarantinedRows} {b.quarantinedRows ?? '-'} ·{' '}
                      {IMPORT_RESULT_STAT_LABEL.duplicateRows} {b.duplicateRows ?? '-'}
                    </p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
          {loading ? (
            <div
              className="absolute inset-0 z-[2] flex items-center justify-center bg-background/40 backdrop-blur-[1px]"
              aria-busy
              aria-label="加载中"
            >
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          {isMobile ? (
            <span>共 {total} 条</span>
          ) : (
            <span>
              共 {total} 条 · 第 {page}/{pageCount} 页
            </span>
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              下一页
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
