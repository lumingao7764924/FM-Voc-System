import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ImportBatchSummary, ImportIssueItem } from '@voc/shared';
import {
  IMPORT_RESULT_HINT,
  IMPORT_RESULT_SECTION,
  IMPORT_RESULT_STAT_LABEL,
  labelImportStatus,
} from '@voc/shared';
import { apiFetch } from '../api';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { InfoHint } from '@/components/info-hint';
import { PageTitle } from '@/components/page-header';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { usePageRefresh } from '@/hooks/use-page-refresh';
import { isPendingStatus, isProcessingStatus } from '@/lib/import-status';

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
        <span>{label}</span>
        {hint ? (
          <InfoHint title={label} label={`${label}说明`}>
            {hint}
          </InfoHint>
        ) : null}
      </p>
    </div>
  );
}

function metaLine(item: ImportIssueItem) {
  const parts = [item.brandKey, item.platform, item.platformSku].filter(Boolean);
  return parts.length ? parts.join(' / ') : '-';
}

const ISSUE_COLUMNS: DataTableColumn<ImportIssueItem>[] = [
  {
    id: 'row',
    header: IMPORT_RESULT_SECTION.colRow,
    width: 'minmax(3.5rem, 4.5rem)',
    className: 'tabular-nums',
    cell: (item) => item.sourceRowNumber,
  },
  {
    id: 'message',
    header: IMPORT_RESULT_SECTION.colMessage,
    width: 'minmax(5em, 1.4fr)',
    className: 'break-words whitespace-normal',
    cell: (item) => item.message,
  },
  {
    id: 'meta',
    header: IMPORT_RESULT_SECTION.colMeta,
    width: 'minmax(5em, 1fr)',
    className: 'break-words whitespace-normal text-muted-foreground',
    cell: (item) => metaLine(item),
  },
  {
    id: 'preview',
    header: IMPORT_RESULT_SECTION.colReviewContent,
    width: 'minmax(5em, 1.2fr)',
    className: 'break-words whitespace-normal text-muted-foreground',
    cell: (item) => item.preview || '-',
  },
];

function IssueTable({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: ImportIssueItem[];
  emptyText: string;
}) {
  return (
    <DataTable
      title={title}
      titleCount={items.length}
      columns={ISSUE_COLUMNS}
      rows={items}
      getRowKey={(item) => `${item.sourceRowNumber}-${item.code}-${item.message}`}
      emptyText={emptyText}
      pagination={false}
      virtual
      virtualHeight={360}
      estimateRowHeight={88}
    />
  );
}

export function BatchPage({
  batchId: batchIdProp,
  isActive = true,
}: {
  batchId?: string;
  isActive?: boolean;
}) {
  const { id: paramId } = useParams();
  const id = batchIdProp ?? paramId;
  const { renameTab } = useWorkspaceTabs();
  const [batch, setBatch] = useState<ImportBatchSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadedOnce = useRef(false);
  const cancelledRef = useRef(false);

  const fetchBatch = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<ImportBatchSummary>(`/api/imports/${id}`);
      if (cancelledRef.current) return;
      setBatch(data);
      setLoadFailed(false);
      loadedOnce.current = true;
      renameTab(`batch:${id}`, data.sourceFileName || `结果 ${id.slice(0, 8)}`);
    } catch (e) {
      if (cancelledRef.current) return;
      setLoadFailed(true);
      toast({
        title: '加载失败',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  }, [id, renameTab]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!id || loadedOnce.current) return;
    void fetchBatch();
    return () => {
      cancelledRef.current = true;
    };
  }, [id, fetchBatch]);

  // 按本页路由订阅：/reviews/batches/<id>
  usePageRefresh(id ? `/reviews/batches/${id}` : [], () => {
    void fetchBatch();
  });

  useEffect(() => {
    if (!id || !isActive || !batch || !isProcessingStatus(batch.importStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const data = await apiFetch<ImportBatchSummary>(`/api/imports/${id}`);
        if (cancelled) return;
        setBatch(data);
        setLoadFailed(false);
        if (isProcessingStatus(data.importStatus)) {
          timer = setTimeout(() => void poll(), 1500);
        }
      } catch {
        if (cancelled) return;
        timer = setTimeout(() => void poll(), 3000);
      }
    }

    timer = setTimeout(() => void poll(), 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, isActive, batch?.importStatus]);

  if (!batch) {
    if (loadFailed) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-destructive">加载批次失败</p>
          <Button asChild variant="outline">
            <Link to="/reviews/import">返回导入</Link>
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">加载批次…</p>;
  }

  const statusLabel = labelImportStatus(batch.importStatus);
  const quarantineItems = batch.quarantineItems ?? [];
  const duplicateItems = batch.duplicateItems ?? [];
  const pending = isPendingStatus(batch.importStatus);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PageTitle>{IMPORT_RESULT_SECTION.pageTitle}</PageTitle>
          <Badge variant="secondary">{statusLabel}</Badge>
          {batch.importStatus === 'partial_failed' ? (
            <InfoHint title={statusLabel} label={`${statusLabel}说明`}>
              {IMPORT_RESULT_HINT.partial}
            </InfoHint>
          ) : null}
          {pending ? (
            <span className="text-xs text-muted-foreground">自动刷新中…</span>
          ) : null}
        </div>
        <p className="break-all text-sm text-muted-foreground">
          批次 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{batch.importBatchId}</code>
          <span className="mx-1.5 text-muted-foreground/60">|</span>
          {batch.sourceFileName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={IMPORT_RESULT_STAT_LABEL.totalRows} value={batch.totalRows ?? '-'} />
        <Stat label={IMPORT_RESULT_STAT_LABEL.newRows} value={batch.newRows ?? '-'} />
        <Stat
          label={IMPORT_RESULT_STAT_LABEL.quarantinedRows}
          value={batch.quarantinedRows ?? '-'}
          hint={IMPORT_RESULT_HINT.quarantined}
        />
        <Stat
          label={IMPORT_RESULT_STAT_LABEL.unmappedRows}
          value={batch.unmappedRows ?? '-'}
          hint={IMPORT_RESULT_HINT.unmapped}
        />
        <Stat label={IMPORT_RESULT_STAT_LABEL.textMissingRows} value={batch.textMissingRows ?? '-'} />
        <Stat
          label={IMPORT_RESULT_STAT_LABEL.duplicateRows}
          value={batch.duplicateRows ?? '-'}
          hint={IMPORT_RESULT_HINT.duplicate}
        />
      </div>

      {batch.errorMessage ? (
        <p className="text-sm text-destructive">{batch.errorMessage}</p>
      ) : null}

      <IssueTable
        title={IMPORT_RESULT_SECTION.quarantineTitle}
        items={quarantineItems}
        emptyText={IMPORT_RESULT_SECTION.quarantineEmpty}
      />

      <IssueTable
        title={IMPORT_RESULT_SECTION.duplicateTitle}
        items={duplicateItems}
        emptyText={IMPORT_RESULT_SECTION.duplicateEmpty}
      />
    </div>
  );
}
