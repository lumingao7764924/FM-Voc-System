import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewListItem, ReviewListResponse, SyncMappingResult } from '@voc/shared';
import {
  REVIEW_LIST_COPY,
  labelProductMappingStatus,
} from '@voc/shared';
import { Loader2, RefreshCw, Tags } from 'lucide-react';
import { apiFetch } from '@/api';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader, PageTitle } from '@/components/page-header';
import { DataTable, type DataTableColumn, type DataTableFilterField } from '@/components/data-table';
import { TruncatedText } from '@/components/truncated-text';
import { buildListQuery } from '@/lib/list-query';
import { usePageRefresh } from '@/hooks/use-page-refresh';
import { useAuth } from '@/hooks/use-auth';

const EMPTY = '-';

/** 源表常见用 /、- 等当空值；展示时一律当空 */
function displayText(value: string | null | undefined) {
  const t = value?.trim() ?? '';
  if (!t || t === '/' || t === '-' || t === '—' || t === '–') return '';
  return t;
}

function hasPlatformSku(item: ReviewListItem) {
  return Boolean(displayText(item.platformSku));
}

function productLabel(item: ReviewListItem) {
  return (
    displayText(item.productNameCn) ||
    displayText(item.productNameEn) ||
    displayText(item.platformProductName) ||
    displayText(item.internalSku) ||
    EMPTY
  );
}

function previewText(item: ReviewListItem) {
  const t = [item.reviewTitle, item.reviewText].filter(Boolean).join(' · ');
  return t || EMPTY;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${n} 星`,
}));

const COLUMNS: DataTableColumn<ReviewListItem>[] = [
  {
    id: 'date',
    header: REVIEW_LIST_COPY.colDate,
    className: 'whitespace-nowrap text-xs',
    cell: (r) => r.reviewDateLocal || EMPTY,
  },
  {
    id: 'rating',
    header: REVIEW_LIST_COPY.colRating,
    className: 'whitespace-nowrap',
    cell: (r) => (r.rating != null ? `${r.rating}` : EMPTY),
  },
  {
    id: 'brand',
    header: REVIEW_LIST_COPY.colBrand,
    cell: (r) => r.brandKey || EMPTY,
  },
  {
    id: 'country',
    header: REVIEW_LIST_COPY.colCountry,
    cell: (r) => r.countryCode || EMPTY,
  },
  {
    id: 'platform',
    header: REVIEW_LIST_COPY.colPlatform,
    className: 'whitespace-nowrap',
    cell: (r) => r.platform || EMPTY,
  },
  {
    id: 'sku',
    header: REVIEW_LIST_COPY.colPlatformSku,
    className: 'font-mono text-xs max-w-[8rem]',
    cell: (r) => {
      const sku = displayText(r.platformSku);
      return <TruncatedText text={sku || null} empty={EMPTY} className="font-mono text-xs" />;
    },
  },
  {
    id: 'product',
    header: REVIEW_LIST_COPY.colProduct,
    className: 'max-w-[12rem]',
    cell: (r) => {
      const label = productLabel(r);
      return <TruncatedText text={label === EMPTY ? null : label} empty={EMPTY} />;
    },
  },
  {
    id: 'mapped',
    header: REVIEW_LIST_COPY.colMapped,
    cell: (r) => {
      // 无平台 SKU：不适用映射，显示空值而非「未映射」
      if (!hasPlatformSku(r)) return EMPTY;
      const status = r.productMappingStatus;
      const tone =
        status === 'confirmed'
          ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : status === 'conflict'
            ? 'border-destructive/40 bg-destructive/15 text-destructive'
            : status === 'invalid'
              ? 'border-border bg-muted text-muted-foreground'
              : 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-400';
      return (
        <Badge variant="outline" className={tone}>
          {labelProductMappingStatus(status)}
        </Badge>
      );
    },
  },
  {
    id: 'text',
    header: REVIEW_LIST_COPY.colText,
    className: 'max-w-[16rem] text-muted-foreground',
    cell: (r) => {
      const t = previewText(r);
      return (
        <TruncatedText
          text={t === EMPTY ? null : t}
          empty={EMPTY}
          className="text-muted-foreground"
        />
      );
    },
  },
];

export function ReviewListPage({ isActive: _isActive = true }: { isActive?: boolean }) {
  const { canFlag } = useAuth();
  const canSyncMapping = canFlag('editMapping');
  const [items, setItems] = useState<ReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState({
    brand: '',
    country: '',
    mapped: '',
    ratingMin: '',
    ratingMax: '',
    q: '',
  });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncMappingResult | null>(null);
  const loadGenRef = useRef(0);

  const loadList = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const res = await apiFetch<ReviewListResponse>(
        `/api/reviews?${buildListQuery({
          page,
          pageSize,
          brand: filters.brand,
          country: filters.country,
          mapped: filters.mapped,
          ratingMin: filters.ratingMin,
          ratingMax: filters.ratingMax,
          q: filters.q,
        })}`,
      );
      if (gen !== loadGenRef.current) return;
      setItems(res.items);
      setTotal(res.total);
      setBrands(res.brands ?? []);
      setCountries(res.countries ?? []);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      toast({
        title: '加载失败',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    void loadList();
    return () => {
      loadGenRef.current += 1;
    };
  }, [loadList]);

  usePageRefresh('/reviews/list', () => {
    void loadList();
  });

  const onSyncMapping = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await apiFetch<SyncMappingResult>('/api/reviews/sync-mapping', {
        method: 'POST',
        json: {},
      });
      setSyncResult(res);
      await loadList();
    } catch (e) {
      toast({
        title: REVIEW_LIST_COPY.syncFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  }, [loadList]);

  const filterFields: DataTableFilterField[] = useMemo(
    () => [
      {
        id: 'brand',
        label: REVIEW_LIST_COPY.filterBrand,
        type: 'select',
        options: [
          { value: '', label: '全部品牌' },
          ...brands.map((b) => ({ value: b, label: b })),
        ],
      },
      {
        id: 'country',
        label: REVIEW_LIST_COPY.filterCountry,
        type: 'select',
        options: [
          { value: '', label: '全部地区' },
          ...countries.map((c) => ({ value: c, label: c })),
        ],
      },
      {
        id: 'mapped',
        label: REVIEW_LIST_COPY.filterMapped,
        type: 'select',
        options: [
          { value: '', label: REVIEW_LIST_COPY.filterMappedAll },
          { value: 'yes', label: REVIEW_LIST_COPY.filterMappedYes },
          { value: 'no', label: REVIEW_LIST_COPY.filterMappedNo },
        ],
      },
      {
        id: 'ratingMin',
        label: REVIEW_LIST_COPY.filterRatingMin,
        type: 'select',
        options: [{ value: '', label: '不限' }, ...RATING_OPTIONS],
      },
      {
        id: 'ratingMax',
        label: REVIEW_LIST_COPY.filterRatingMax,
        type: 'select',
        options: [{ value: '', label: '不限' }, ...RATING_OPTIONS],
      },
      {
        id: 'q',
        label: REVIEW_LIST_COPY.filterQ,
        placeholder: REVIEW_LIST_COPY.filterQPlaceholder,
      },
    ],
    [brands, countries],
  );

  const hasFilters = Object.values(filters).some((v) => v.trim() !== '');

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <PageTitle>
            {REVIEW_LIST_COPY.pageTitle}
            {!loading ? (
              <Badge variant="secondary" className="ml-2 align-middle text-sm font-normal">
                {total}
              </Badge>
            ) : null}
          </PageTitle>
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={items}
        getRowKey={(r) => r.reviewId}
        loading={loading}
        emptyText={hasFilters ? REVIEW_LIST_COPY.emptyFiltered : REVIEW_LIST_COPY.empty}
        pagination
        clientPagination={false}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        filters={filterFields}
        filterValues={filters}
        onFilterChange={(next) => {
          setFilters({
            brand: next.brand ?? '',
            country: next.country ?? '',
            mapped: next.mapped ?? '',
            ratingMin: next.ratingMin ?? '',
            ratingMax: next.ratingMax ?? '',
            q: next.q ?? '',
          });
          setPage(1);
        }}
        filterActions={
          canSyncMapping ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={syncing}
              onClick={() => void onSyncMapping()}
            >
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {syncing ? REVIEW_LIST_COPY.syncMappingLoading : REVIEW_LIST_COPY.syncMapping}
            </Button>
          ) : null
        }
      />

      <Dialog
        open={syncResult != null}
        onOpenChange={(open) => {
          if (!open) setSyncResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {REVIEW_LIST_COPY.syncResultTitle}
              {syncResult?.dryRun ? (
                <Tags className="size-4 text-amber-500" aria-label="干跑模式" />
              ) : null}
            </DialogTitle>
            <DialogDescription className="sr-only">
              同步映射完成统计
            </DialogDescription>
          </DialogHeader>
          {syncResult ? (
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-muted-foreground">{REVIEW_LIST_COPY.syncResultCandidates}</span>
                <span className="font-medium tabular-nums">{syncResult.candidates}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-muted-foreground">{REVIEW_LIST_COPY.syncResultMatchable}</span>
                <span className="font-medium tabular-nums">{syncResult.matchable}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-muted-foreground">{REVIEW_LIST_COPY.syncResultSynced}</span>
                <span className="font-medium tabular-nums">{syncResult.synced}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-muted-foreground">{REVIEW_LIST_COPY.syncResultUnmapped}</span>
                <span className="font-medium tabular-nums">{syncResult.stillUnmapped}</span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setSyncResult(null)}>
              {REVIEW_LIST_COPY.syncResultOk}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
