import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisBatchDetail,
  AnalysisBatchSummary,
  AnalyticsBreakdownDimension,
  AnalyticsBreakdownResponse,
  AnalyticsOverviewResponse,
  AnalyticsTrendGranularity,
  AnalyticsTrendMetric,
  AnalyticsTrendResponse,
  ReviewListItem,
  ReviewListResponse,
} from '@voc/shared';
import { ANALYTICS_COPY } from '@voc/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { apiFetch } from '@/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ListFiltersPanel,
  type ListFilterField,
} from '@/components/list-filters';
import { PageHeader, PageTitle } from '@/components/page-header';
import { TruncatedText } from '@/components/truncated-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { buildListQuery } from '@/lib/list-query';
import { cn } from '@/lib/utils';
import { usePageRefresh, notifyPageRefresh } from '@/hooks/use-page-refresh';
import { useWorkspaceTabs } from '@/components/workspace-tabs';

type AnalyticsFilters = {
  dateFrom: string;
  dateTo: string;
  brand: string;
  spu: string;
  sku: string;
  country: string;
  platform: string;
  ratingMin: string;
  ratingMax: string;
};

const EMPTY_FILTERS: AnalyticsFilters = {
  dateFrom: '',
  dateTo: '',
  brand: '',
  spu: '',
  sku: '',
  country: '',
  platform: '',
  ratingMin: '',
  ratingMax: '',
};

/** 本地日历日 YYYY-MM-DD */
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 默认近 30 天（含今天），减轻未选日期时全量按日聚合压力 */
function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { dateFrom: toYmd(from), dateTo: toYmd(to) };
}

function defaultAnalyticsFilters(): AnalyticsFilters {
  return { ...EMPTY_FILTERS, ...defaultDateRange() };
}

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${n} 星`,
}));

const RATING_ANY = '__any__';

/** 内部 SPU / SKU / 平台 SKU：相同值只显示一次，避免 SKINTIFIC-x · SKINTIFIC-x · SKINTIFIC-x */
function productCodesLine(item: ReviewListItem): string {
  const unique: string[] = [];
  for (const raw of [item.internalSpu, item.internalSku, item.platformSku]) {
    const v = raw?.trim() ?? '';
    if (!v || unique.includes(v)) continue;
    unique.push(v);
  }
  return unique.join(' · ');
}

function pct(rate: number | null | undefined) {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function num(n: number | null | undefined, digits = 2) {
  if (n == null) return '—';
  return n.toFixed(digits);
}

function analyticsQuery(filters: AnalyticsFilters, extra?: Record<string, string | number>) {
  return buildListQuery({
    page: 1,
    pageSize: 20,
    ...filters,
    ...extra,
  });
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function formatTrendValue(metric: AnalyticsTrendMetric, point: AnalyticsTrendResponse['points'][number]) {
  if (metric === 'count') return String(point.reviewCount);
  if (metric === 'avg') return num(point.avgRating);
  return pct(point.lowStarRate);
}

function trendRawValue(
  metric: AnalyticsTrendMetric,
  point: AnalyticsTrendResponse['points'][number],
): number {
  if (metric === 'count') return point.reviewCount;
  if (metric === 'avg') return point.avgRating ?? 0;
  return (point.lowStarRate ?? 0) * 100;
}

function formatAxisPeriod(period: string): string {
  const week = period.match(/^(\d{4})-W(\d{1,2})$/i);
  if (week) {
    const { start, end } = isoWeekToRange(Number(week[1]), Number(week[2]));
    return `${start.getUTCMonth() + 1}/${start.getUTCDate()}-${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
  }
  const day = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `${Number(day[2])}/${Number(day[3])}`;
  return period;
}

/** ISO 周 → 该周周一～周日（UTC 日历日，与 BQ FORMAT_DATE %G-W%V 对齐） */
function isoWeekToRange(isoYear: number, isoWeek: number): { start: Date; end: Date } {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  const start = new Date(mondayWeek1);
  start.setUTCDate(mondayWeek1.getUTCDate() + (isoWeek - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start, end };
}

function formatPeriodLabel(period: string): string {
  const week = period.match(/^(\d{4})-W(\d{1,2})$/i);
  if (week) {
    const { start, end } = isoWeekToRange(Number(week[1]), Number(week[2]));
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return `${fmt(start)}～${fmt(end)}`;
  }
  return period;
}

function niceCeiling(n: number): number {
  if (n <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  const m = n / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * pow;
}

function SimpleTrendChart({
  points,
  metric,
}: {
  points: AnalyticsTrendResponse['points'];
  metric: AnalyticsTrendMetric;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 280 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 左右留足空间：周标签形如 8/17-8/23，避免贴边被裁切
  const pad = { top: 8, right: 36, bottom: 24, left: 40 };
  const AXIS_FS = 10;
  const innerW = Math.max(1, size.w - pad.left - pad.right);
  const innerH = Math.max(1, size.h - pad.top - pad.bottom);

  const axisTextProps = {
    fill: 'currentColor',
    fontSize: AXIS_FS,
    fontWeight: 300 as const,
    className: 'text-muted-foreground',
  };

  if (points.length === 0) {
    return (
      <div
        ref={wrapRef}
        className="flex h-full w-full items-center justify-center text-[10px] font-light text-muted-foreground"
      >
        暂无趋势数据
      </div>
    );
  }

  const values = points.map((p) => trendRawValue(metric, p));
  const dataMax = Math.max(...values, 0);
  const yMax =
    metric === 'avg'
      ? Math.min(5, Math.max(niceCeiling(dataMax || 1), dataMax, 1))
      : niceCeiling(dataMax || 1);
  const yMin = 0;
  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (yMax * i) / yTicks);

  const xAt = (i: number) =>
    points.length === 1 ? pad.left + innerW / 2 : pad.left + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) =>
    pad.top + innerH - ((v - yMin) / Math.max(yMax - yMin, 0.001)) * innerH;

  const linePath = points
    .map((_, i) => {
      const x = xAt(i);
      const y = yAt(values[i] ?? 0);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const showLabel = (i: number) =>
    i === 0 || i === points.length - 1 || i % labelStep === 0;

  const formatTick = (v: number) => {
    if (metric === 'lowRate') return `${Math.round(v)}%`;
    if (metric === 'avg') return v.toFixed(1);
    return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));
  };

  const active = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div ref={wrapRef} className="relative h-full w-full min-h-0">
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="absolute inset-0 text-foreground"
        role="img"
        aria-label="趋势折线图"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {tickValues.map((tv) => {
          const y = yAt(tv);
          return (
            <g key={`y-${tv}`}>
              <line
                x1={pad.left}
                x2={size.w - pad.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
              />
              <text x={pad.left - 6} y={y + 3} textAnchor="end" {...axisTextProps}>
                {formatTick(tv)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) =>
          showLabel(i) ? (
            <text
              key={`x-${p.period}`}
              x={xAt(i)}
              y={size.h - 6}
              textAnchor={
                i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'
              }
              {...axisTextProps}
            >
              {formatAxisPeriod(p.period)}
            </text>
          ) : null,
        )}

        <path
          d={linePath}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => {
          const x = xAt(i);
          const y = yAt(values[i] ?? 0);
          const hitW = Math.max(innerW / points.length, 8);
          return (
            <g key={p.period}>
              <circle cx={x} cy={y} r={2} className="fill-primary" />
              <rect
                x={x - hitW / 2}
                y={pad.top}
                width={hitW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}
      </svg>

      {active && hoverIdx != null ? (
        <div className="pointer-events-none absolute right-2 top-1 rounded-md border bg-background/95 px-2.5 py-1.5 text-[11px] font-light shadow-sm">
          <div className="tabular-nums text-foreground">{formatTrendValue(metric, active)}</div>
          <div className="text-muted-foreground">{formatPeriodLabel(active.period)}</div>
          <div className="mt-0.5 tabular-nums text-muted-foreground">
            {active.reviewCount} 条 · 均星 {num(active.avgRating)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AnalyticsPage({ isActive: _isActive = true }: { isActive?: boolean }) {
  const { openPath } = useWorkspaceTabs();
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultAnalyticsFilters);
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [trend, setTrend] = useState<AnalyticsTrendResponse | null>(null);
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdownResponse | null>(null);
  const [granularity, setGranularity] = useState<AnalyticsTrendGranularity>('day');
  const [trendMetric, setTrendMetric] = useState<AnalyticsTrendMetric>('count');
  const [dimension, setDimension] = useState<AnalyticsBreakdownDimension>('spu');
  const [breakdownPage, setBreakdownPage] = useState(1);
  const breakdownPageSize = 10;
  const [loading, setLoading] = useState(true);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const loadGenRef = useRef(0);
  const breakdownGenRef = useRef(0);

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState('');
  const [drillFilters, setDrillFilters] = useState<AnalyticsFilters>(EMPTY_FILTERS);
  const [drillRatingMin, setDrillRatingMin] = useState('');
  const [drillRatingMax, setDrillRatingMax] = useState('');
  const [drillItems, setDrillItems] = useState<ReviewListItem[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillPage, setDrillPage] = useState(1);
  const [drillLoading, setDrillLoading] = useState(false);
  const drillGenRef = useRef(0);

  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analysisBatch, setAnalysisBatch] = useState<AnalysisBatchDetail | null>(null);
  const analyzePollRef = useRef<number | null>(null);

  const loadOverviewTrend = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const [ov, tr] = await Promise.all([
        apiFetch<AnalyticsOverviewResponse>(
          `/api/analytics/overview?${analyticsQuery(filters)}`,
        ),
        apiFetch<AnalyticsTrendResponse>(
          `/api/analytics/trend?${analyticsQuery(filters, { granularity })}`,
        ),
      ]);
      if (gen !== loadGenRef.current) return;
      setOverview(ov);
      setTrend(tr);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      toast({
        title: ANALYTICS_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [filters, granularity]);

  const loadBreakdown = useCallback(async () => {
    const gen = ++breakdownGenRef.current;
    setBreakdownLoading(true);
    try {
      const bd = await apiFetch<AnalyticsBreakdownResponse>(
        `/api/analytics/breakdown?${analyticsQuery(filters, {
          dimension,
          page: breakdownPage,
          pageSize: breakdownPageSize,
        })}`,
      );
      if (gen !== breakdownGenRef.current) return;
      setBreakdown(bd);
    } catch (e) {
      if (gen !== breakdownGenRef.current) return;
      toast({
        title: ANALYTICS_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      if (gen === breakdownGenRef.current) setBreakdownLoading(false);
    }
  }, [filters, dimension, breakdownPage]);

  useEffect(() => {
    void loadOverviewTrend();
    return () => {
      loadGenRef.current += 1;
    };
  }, [loadOverviewTrend]);

  useEffect(() => {
    void loadBreakdown();
    return () => {
      breakdownGenRef.current += 1;
    };
  }, [loadBreakdown]);

  usePageRefresh('/analytics', () => {
    void loadOverviewTrend();
    void loadBreakdown();
  });

  useEffect(() => {
    return () => {
      if (analyzePollRef.current != null) {
        window.clearInterval(analyzePollRef.current);
        analyzePollRef.current = null;
      }
    };
  }, []);

  const pollAnalysisBatch = useCallback(
    (batchId: string) => {
      if (analyzePollRef.current != null) {
        window.clearInterval(analyzePollRef.current);
      }
      const tick = async () => {
        try {
          const detail = await apiFetch<AnalysisBatchDetail>(
            `/api/analysis/batches/${encodeURIComponent(batchId)}`,
          );
          setAnalysisBatch(detail);
          const done =
            detail.status === 'succeeded' ||
            detail.status === 'failed' ||
            detail.status === 'partial';
          if (done) {
            if (analyzePollRef.current != null) {
              window.clearInterval(analyzePollRef.current);
              analyzePollRef.current = null;
            }
            setAnalyzeBusy(false);
            notifyPageRefresh('/analytics/history');
            if (detail.status === 'failed' && detail.total === 0) {
              toast({
                title: ANALYTICS_COPY.analyzeEmpty,
                description: detail.errorMessage ?? undefined,
              });
            } else {
              toast({
                title: ANALYTICS_COPY.analyzeDone,
                description: `${detail.succeeded}/${detail.total} 成功 · 正式问题 ${detail.formalIssueCount}`,
              });
              openPath(
                `/analytics/batches/${batchId}`,
                `差评报告 ${batchId.slice(0, 8)}`,
              );
            }
          }
        } catch (e) {
          if (analyzePollRef.current != null) {
            window.clearInterval(analyzePollRef.current);
            analyzePollRef.current = null;
          }
          setAnalyzeBusy(false);
          toast({
            title: ANALYTICS_COPY.analyzeFailed,
            description: e instanceof Error ? e.message : undefined,
            variant: 'destructive',
          });
        }
      };
      void tick();
      analyzePollRef.current = window.setInterval(() => {
        void tick();
      }, 1500);
    },
    [openPath],
  );

  const startNegativeAnalysis = useCallback(async () => {
    const max = 50;
    const ok = window.confirm(
      ANALYTICS_COPY.analyzeConfirm.replace('{max}', String(max)),
    );
    if (!ok) return;
    setAnalyzeBusy(true);
    setAnalysisBatch(null);
    try {
      const summary = await apiFetch<AnalysisBatchSummary>('/api/analysis/batches', {
        method: 'POST',
        json: {
          ...filters,
          maxReviews: max,
        },
      });
      setAnalysisBatch({ ...summary, topIssues: [] });
      if (summary.total === 0) {
        setAnalyzeBusy(false);
        toast({
          title: ANALYTICS_COPY.analyzeEmpty,
          description: summary.errorMessage ?? undefined,
        });
        return;
      }
      toast({
        title: ANALYTICS_COPY.analyzeStarted,
        description: summary.dryRun
          ? ANALYTICS_COPY.analyzeDryRunHint
          : ANALYTICS_COPY.analyzeLiveHint,
      });
      pollAnalysisBatch(summary.batchId);
    } catch (e) {
      setAnalyzeBusy(false);
      toast({
        title: ANALYTICS_COPY.analyzeFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  }, [filters, pollAnalysisBatch]);

  const loadDrill = useCallback(async () => {
    const gen = ++drillGenRef.current;
    setDrillLoading(true);
    try {
      const res = await apiFetch<ReviewListResponse>(
        `/api/reviews?${buildListQuery({
          page: drillPage,
          pageSize: 20,
          ...drillFilters,
          ratingMin: drillRatingMin,
          ratingMax: drillRatingMax,
        })}`,
      );
      if (gen !== drillGenRef.current) return;
      setDrillItems(res.items);
      setDrillTotal(res.total);
    } catch (e) {
      if (gen !== drillGenRef.current) return;
      toast({
        title: ANALYTICS_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      if (gen === drillGenRef.current) setDrillLoading(false);
    }
  }, [drillFilters, drillRatingMin, drillRatingMax, drillPage]);

  useEffect(() => {
    if (!drillOpen) return;
    void loadDrill();
  }, [drillOpen, loadDrill]);

  const filterFields: ListFilterField[] = useMemo(() => {
    const brands = overview?.brands ?? [];
    const countries = overview?.countries ?? [];
    const platforms = overview?.platforms ?? [];
    return [
      { id: 'dateFrom', label: ANALYTICS_COPY.filterDateFrom, type: 'date' },
      { id: 'dateTo', label: ANALYTICS_COPY.filterDateTo, type: 'date' },
      {
        id: 'brand',
        label: ANALYTICS_COPY.filterBrand,
        type: 'select',
        options: [
          { value: '', label: '全部品牌' },
          ...brands.map((b) => ({ value: b, label: b })),
        ],
      },
      {
        id: 'spu',
        label: ANALYTICS_COPY.filterSpu,
        placeholder: '内部 SPU',
      },
      {
        id: 'sku',
        label: ANALYTICS_COPY.filterSku,
        placeholder: '内部 SKU',
      },
      {
        id: 'country',
        label: ANALYTICS_COPY.filterCountry,
        type: 'select',
        options: [
          { value: '', label: '全部国家' },
          ...countries.map((c) => ({ value: c, label: c })),
        ],
      },
      {
        id: 'platform',
        label: ANALYTICS_COPY.filterPlatform,
        type: 'select',
        options: [
          { value: '', label: '全部平台' },
          ...platforms.map((p) => ({ value: p, label: p })),
        ],
      },
      {
        id: 'ratingMin',
        label: ANALYTICS_COPY.filterRatingMin,
        type: 'select',
        options: [{ value: '', label: '不限' }, ...RATING_OPTIONS],
      },
      {
        id: 'ratingMax',
        label: ANALYTICS_COPY.filterRatingMax,
        type: 'select',
        options: [{ value: '', label: '不限' }, ...RATING_OPTIONS],
      },
    ];
  }, [overview?.brands, overview?.countries, overview?.platforms]);

  function openDrill(title: string, patch: Partial<AnalyticsFilters>) {
    setDrillTitle(title);
    setDrillFilters({ ...filters, ...patch });
    setDrillRatingMin(filters.ratingMin);
    setDrillRatingMax(filters.ratingMax);
    setDrillPage(1);
    setDrillOpen(true);
  }

  const emptyText =
    overview?.emptyReason === 'filtered_empty'
      ? ANALYTICS_COPY.emptyFiltered
      : ANALYTICS_COPY.empty;

  const dimLabels: Record<AnalyticsBreakdownDimension, string> = {
    brand: ANALYTICS_COPY.dimBrand,
    spu: ANALYTICS_COPY.dimSpu,
    sku: ANALYTICS_COPY.dimSku,
    country: ANALYTICS_COPY.dimCountry,
    platform: ANALYTICS_COPY.dimPlatform,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<PageTitle>{ANALYTICS_COPY.pageTitle}</PageTitle>}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={analyzeBusy || Boolean(overview?.emptyReason)}
              onClick={() => void startNegativeAnalysis()}
            >
              {analyzeBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {analyzeBusy ? ANALYTICS_COPY.analyzeRunning : ANALYTICS_COPY.analyzeButton}
            </Button>
            <ListFiltersPanel
              filters={filterFields}
              values={filters}
              onChange={(next) => {
                setBreakdownPage(1);
                const cleared = !Object.values(next).some((v) => String(v ?? '').trim());
                const dates = cleared ? defaultDateRange() : null;
                setFilters({
                  dateFrom: dates ? dates.dateFrom : (next.dateFrom ?? ''),
                  dateTo: dates ? dates.dateTo : (next.dateTo ?? ''),
                  brand: next.brand ?? '',
                  spu: next.spu ?? '',
                  sku: next.sku ?? '',
                  country: next.country ?? '',
                  platform: next.platform ?? '',
                  ratingMin: next.ratingMin ?? '',
                  ratingMax: next.ratingMax ?? '',
                });
              }}
            />
          </>
        }
      />

      {loading && !overview ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : null}

      {overview && overview.emptyReason ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : null}

      {analyzeBusy && analysisBatch ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {ANALYTICS_COPY.analyzeRunning}
          {' · '}
          {analysisBatch.succeeded + analysisBatch.failed + analysisBatch.pendingReview}/
          {analysisBatch.total}
          （完成后将自动打开报告）
        </p>
      ) : null}

      {overview && !overview.emptyReason ? (
        <>
          <div
            className={cn(
              'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
              loading && 'opacity-60',
            )}
          >
            <MetricCard label={ANALYTICS_COPY.metricTotal} value={String(overview.totalReviews)} />
            <MetricCard label={ANALYTICS_COPY.metricAvgRating} value={num(overview.avgRating)} />
            <MetricCard label={ANALYTICS_COPY.metricLowStarRate} value={pct(overview.lowStarRate)} />
            <MetricCard
              label={ANALYTICS_COPY.metricHighStarRate}
              value={pct(overview.highStarRate)}
            />
            <MetricCard
              label={ANALYTICS_COPY.metricMappedRate}
              value={pct(overview.mappedSpuRate)}
              hint={`${overview.mappedSpuCount}/${overview.totalReviews}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
            <Card className="flex h-[28rem] flex-col shadow-none">
              <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 py-3">
                <CardTitle className="text-base">{ANALYTICS_COPY.trendTitle}</CardTitle>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['count', ANALYTICS_COPY.trendCount],
                      ['avg', ANALYTICS_COPY.trendAvg],
                      ['lowRate', ANALYTICS_COPY.trendLowRate],
                    ] as const
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={trendMetric === id ? 'secondary' : 'ghost'}
                      onClick={() => setTrendMetric(id)}
                    >
                      {label}
                    </Button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-border" />
                  {(
                    [
                      ['day', ANALYTICS_COPY.trendDay],
                      ['week', ANALYTICS_COPY.trendWeek],
                    ] as const
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={granularity === id ? 'secondary' : 'ghost'}
                      onClick={() => setGranularity(id)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="relative min-h-0 flex-1 px-2 pb-2 pt-0">
                {loading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : null}
                <div className="h-full w-full">
                  <SimpleTrendChart points={trend?.points ?? []} metric={trendMetric} />
                </div>
              </CardContent>
            </Card>

            <Card className="flex h-[28rem] flex-col shadow-none">
              <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 py-3">
                <CardTitle className="text-base">{ANALYTICS_COPY.breakdownTitle}</CardTitle>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(dimLabels) as AnalyticsBreakdownDimension[]).map((id) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={dimension === id ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setDimension(id);
                        setBreakdownPage(1);
                      }}
                    >
                      {dimLabels[id]}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="relative flex min-h-0 flex-1 flex-col px-0 pb-0">
                {breakdownLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      加载中…
                    </div>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-[1] bg-card">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">{ANALYTICS_COPY.colKey}</th>
                        <th className="px-4 py-2 font-medium tabular-nums">
                          {ANALYTICS_COPY.colCount}
                        </th>
                        <th className="px-4 py-2 font-medium tabular-nums">
                          {ANALYTICS_COPY.colAvg}
                        </th>
                        <th className="px-4 py-2 font-medium tabular-nums">
                          {ANALYTICS_COPY.colLowRate}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {!breakdownLoading && (breakdown?.items ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            暂无分布数据（可能多为未映射）
                          </td>
                        </tr>
                      ) : (
                        (breakdown?.items ?? []).map((row) => (
                          <tr
                            key={row.key}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                            onClick={() => {
                              const patch: Partial<AnalyticsFilters> = {};
                              if (dimension === 'brand') patch.brand = row.key;
                              if (dimension === 'spu') patch.spu = row.key;
                              if (dimension === 'sku') patch.sku = row.key;
                              if (dimension === 'country') patch.country = row.key;
                              if (dimension === 'platform') patch.platform = row.key;
                              openDrill(`${dimLabels[dimension]}：${row.key}`, patch);
                            }}
                          >
                            <td className="max-w-[12rem] px-4 py-2.5 font-medium">
                              <TruncatedText text={row.key} className="font-medium" />
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">{row.reviewCount}</td>
                            <td className="px-4 py-2.5 tabular-nums">{num(row.avgRating)}</td>
                            <td className="px-4 py-2.5 tabular-nums">{pct(row.lowStarRate)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {(breakdown?.total ?? 0) > breakdownPageSize ? (
                  <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={breakdownPage <= 1 || breakdownLoading}
                      onClick={() => setBreakdownPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {breakdownPage} /{' '}
                      {Math.max(1, Math.ceil((breakdown?.total ?? 0) / breakdownPageSize))}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        breakdownLoading ||
                        breakdownPage * breakdownPageSize >= (breakdown?.total ?? 0)
                      }
                      onClick={() => setBreakdownPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      <Sheet open={drillOpen} onOpenChange={setDrillOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-none gap-0 overflow-hidden p-0 sm:max-w-none md:max-w-lg"
        >
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="shrink-0 space-y-3 border-b px-5 pb-4 pr-12 pt-5 text-left">
              <div className="min-w-0 space-y-1">
                <SheetTitle className="text-base">{ANALYTICS_COPY.drillTitle}</SheetTitle>
                <SheetDescription className="truncate">
                  {drillTitle || '当前筛选下的评论原文'}
                </SheetDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {ANALYTICS_COPY.drillRating}
                </span>
                <Select
                  value={drillRatingMin || RATING_ANY}
                  disabled={drillLoading}
                  onValueChange={(v) => {
                    const next = v === RATING_ANY ? '' : v;
                    setDrillRatingMin(next);
                    if (next && drillRatingMax && Number(next) > Number(drillRatingMax)) {
                      setDrillRatingMax(next);
                    }
                    setDrillPage(1);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-[4.5rem] px-2 text-xs shadow-none data-[size=sm]:h-7"
                  >
                    <SelectValue placeholder="最低" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RATING_ANY} className="text-xs">
                      不限
                    </SelectItem>
                    {RATING_OPTIONS.map((o) => (
                      <SelectItem key={`min-${o.value}`} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">～</span>
                <Select
                  value={drillRatingMax || RATING_ANY}
                  disabled={drillLoading}
                  onValueChange={(v) => {
                    const next = v === RATING_ANY ? '' : v;
                    setDrillRatingMax(next);
                    if (next && drillRatingMin && Number(next) < Number(drillRatingMin)) {
                      setDrillRatingMin(next);
                    }
                    setDrillPage(1);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-[4.5rem] px-2 text-xs shadow-none data-[size=sm]:h-7"
                  >
                    <SelectValue placeholder="最高" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RATING_ANY} className="text-xs">
                      不限
                    </SelectItem>
                    {RATING_OPTIONS.map((o) => (
                      <SelectItem key={`max-${o.value}`} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SheetHeader>

            <div
              className={cn(
                'relative min-h-0 flex-1',
                drillLoading ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            >
              {drillLoading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    加载中…
                  </div>
                </div>
              ) : null}

              <div className="px-5 py-1">
                {!drillLoading && drillItems.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {ANALYTICS_COPY.drillEmpty}
                  </p>
                ) : null}

                <ul className="divide-y">
                  {drillItems.map((item) => {
                    const codes = productCodesLine(item);
                    return (
                    <li key={item.reviewId} className="py-4">
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">{item.reviewDateLocal || '—'}</span>
                        <span>·</span>
                        <span>{item.rating != null ? `${item.rating} 星` : '无星级'}</span>
                        {item.countryCode ? (
                          <>
                            <span>·</span>
                            <span>{item.countryCode}</span>
                          </>
                        ) : null}
                      </div>
                      {item.reviewTitle ? (
                        <p className="mb-1 text-sm font-medium leading-snug">{item.reviewTitle}</p>
                      ) : null}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {item.reviewText?.trim() || '（无正文）'}
                      </p>
                      {codes ? (
                        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                          {codes}
                        </p>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {drillTotal > 20 ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-t px-5 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={drillPage <= 1 || drillLoading}
                  onClick={() => setDrillPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {drillPage} / {Math.max(1, Math.ceil(drillTotal / 20))}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={drillPage * 20 >= drillTotal || drillLoading}
                  onClick={() => setDrillPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
