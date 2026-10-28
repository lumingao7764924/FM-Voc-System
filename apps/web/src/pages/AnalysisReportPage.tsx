import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AnalysisBrandReportSection,
  AnalysisReportResponse,
} from '@voc/shared';
import { ANALYSIS_REPORT_COPY } from '@voc/shared';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/api';
import { PageHeader, PageTitle } from '@/components/page-header';
import { ListFiltersPanel, type ListFilterField } from '@/components/list-filters';
import { TruncatedText } from '@/components/truncated-text';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { usePageRefresh } from '@/hooks/use-page-refresh';
import { cn } from '@/lib/utils';

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function Tag({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'max-w-full shrink-0 whitespace-nowrap font-normal shadow-none',
        className,
      )}
    >
      {children}
    </Badge>
  );
}

function TagRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

function PlatformKpiRow({ brand }: { brand: AnalysisBrandReportSection }) {
  const cards = [
    {
      key: 'total',
      value: String(brand.reviewCount),
      label: ANALYSIS_REPORT_COPY.kpiReviews,
    },
    ...brand.platforms.map((p) => ({
      key: p.platform,
      value: String(p.count),
      label: `${p.platform}（${pct(p.share)}）`,
    })),
  ];
  const alone = cards.length === 1;
  return (
    <div
      className={cn(
        alone
          ? 'grid grid-cols-1'
          : [
              'grid gap-3',
              'auto-cols-[minmax(9rem,90%)] grid-flow-col overflow-x-auto pb-1',
              'sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible',
              'md:grid-cols-3 xl:grid-cols-4',
            ].join(' '),
      )}
    >
      {cards.map((c) => (
        <div
          key={c.key}
          className="flex min-w-0 flex-col items-center justify-center rounded-lg border bg-card px-3 py-3 text-center"
        >
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {c.value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

export function AnalysisReportPage({
  batchId,
  isActive = true,
}: {
  batchId: string;
  isActive?: boolean;
}) {
  const [report, setReport] = useState<AnalysisReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandKey, setBrandKey] = useState<string | null>(null);
  const [majorFilter, setMajorFilter] = useState('');
  const [minorFilter, setMinorFilter] = useState('');
  const loadGenRef = useRef(0);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const res = await apiFetch<AnalysisReportResponse>(
        `/api/analysis/batches/${encodeURIComponent(batchId)}/report`,
      );
      if (gen !== loadGenRef.current) return;
      setReport(res);
      setLoading(false);
      return res;
    } catch (e) {
      if (gen !== loadGenRef.current) return null;
      setLoading(false);
      toast({
        title: ANALYSIS_REPORT_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      return null;
    }
  }, [batchId]);

  useEffect(() => {
    setLoading(true);
    setBrandKey(null);
    setMajorFilter('');
    setMinorFilter('');
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!isActive || !report) return;
    const pending =
      report.batch.status === 'queued' || report.batch.status === 'running';
    if (!pending) {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current != null) return;
    pollRef.current = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [report?.batch.status, isActive, load, report]);

  usePageRefresh(`/analytics/batches/${batchId}`, () => {
    void load();
  });

  const brands = report?.brands?.length
    ? report.brands
    : ([] as AnalysisBrandReportSection[]);

  useEffect(() => {
    if (!brands.length) return;
    if (brandKey && brands.some((b) => b.brandKey === brandKey)) return;
    setBrandKey(brands[0]!.brandKey);
  }, [brands, brandKey]);

  const brand = useMemo(
    () => brands.find((b) => b.brandKey === brandKey) ?? brands[0] ?? null,
    [brands, brandKey],
  );

  const majorOptions = useMemo(() => {
    if (!brand) return [];
    return [
      ...new Set(
        brand.productConclusions.flatMap((p) => p.majorFilterKeys).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [brand]);

  const minorOptions = useMemo(() => {
    if (!brand) return [];
    const set = new Set<string>();
    for (const p of brand.productConclusions) {
      for (const key of p.minorFilterKeys) {
        const [maj, minor] = key.split('\0');
        if (!minor) continue;
        if (!majorFilter || maj === majorFilter) set.add(minor);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [brand, majorFilter]);

  const conclusionFilterFields = useMemo<ListFilterField[]>(
    () => [
      {
        id: 'major',
        label: ANALYSIS_REPORT_COPY.filterMajor,
        type: 'select',
        options: [
          { value: '', label: ANALYSIS_REPORT_COPY.filterAll },
          ...majorOptions.map((m) => ({ value: m, label: m })),
        ],
      },
      {
        id: 'minor',
        label: ANALYSIS_REPORT_COPY.filterMinor,
        type: 'select',
        options: [
          { value: '', label: ANALYSIS_REPORT_COPY.filterAll },
          ...minorOptions.map((m) => ({ value: m, label: m })),
        ],
      },
    ],
    [majorOptions, minorOptions],
  );

  const filteredConclusions = useMemo(() => {
    if (!brand) return [];
    return brand.productConclusions.filter((p) => {
      if (majorFilter && !p.majorFilterKeys.includes(majorFilter)) return false;
      if (minorFilter) {
        if (majorFilter) {
          if (!p.minorFilterKeys.includes(`${majorFilter}\0${minorFilter}`)) return false;
        } else if (!p.minorFilterKeys.some((k) => k.endsWith(`\0${minorFilter}`))) {
          return false;
        }
      }
      return true;
    });
  }, [brand, majorFilter, minorFilter]);

  const snap = report?.batch.filterSnapshot;
  const filterBits = snap
    ? [
        snap.dateFrom && snap.dateTo ? `${snap.dateFrom}～${snap.dateTo}` : null,
        snap.brand ? `品牌 ${snap.brand}` : null,
        snap.spu ? `SPU ${snap.spu}` : null,
        snap.sku ? `SKU ${snap.sku}` : null,
        snap.country ? `国家 ${snap.country}` : null,
        snap.platform ? `平台 ${snap.platform}` : null,
      ].filter(Boolean)
    : [];

  const filterTime =
    snap?.dateFrom && snap?.dateTo ? `${snap.dateFrom}～${snap.dateTo}` : null;

  return (
    <div className="space-y-3">
      <PageHeader
        className="mb-0"
        title={<PageTitle>{ANALYSIS_REPORT_COPY.pageTitle}</PageTitle>}
      />

      {loading && !report ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : null}

      {!loading && !report ? (
        <p className="text-sm text-muted-foreground">{ANALYSIS_REPORT_COPY.notFound}</p>
      ) : null}

      {report ? (
        <>
          {report.batch.status === 'queued' || report.batch.status === 'running' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {ANALYSIS_REPORT_COPY.runningHint}
            </p>
          ) : null}

          {filterTime ? (
            <p className="text-xs text-muted-foreground">
              {ANALYSIS_REPORT_COPY.filterTitle}：
              <span className="tabular-nums">{filterTime}</span>
            </p>
          ) : filterBits.length ? (
            <p className="text-xs text-muted-foreground">
              {ANALYSIS_REPORT_COPY.filterTitle}：{filterBits.join(' · ')}
            </p>
          ) : null}

          {report.kpi.reviewCount === 0 && report.batch.total > 0 ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              {ANALYSIS_REPORT_COPY.missingDetails}
            </p>
          ) : null}

          {!brands.length ? (
            <p className="text-sm text-muted-foreground">{ANALYSIS_REPORT_COPY.emptyBrand}</p>
          ) : null}

          {brands.length > 0 ? (
            <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
              {brands.map((b) => {
                const active = (brand?.brandKey ?? brandKey) === b.brandKey;
                return (
                  <button
                    key={b.brandKey}
                    type="button"
                    onClick={() => {
                      setBrandKey(b.brandKey);
                      setMajorFilter('');
                      setMinorFilter('');
                    }}
                    className={cn(
                      'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {b.brandKey === 'skt'
                      ? 'SKT'
                      : b.brandKey === 'tp'
                        ? 'TP'
                        : b.brandLabel}
                  </button>
                );
              })}
            </div>
          ) : null}

          {brand ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {ANALYSIS_REPORT_COPY.brandCurrent}：{brand.brandLabel}｜差评{' '}
                <span className="tabular-nums font-medium text-foreground">
                  {brand.reviewCount}
                </span>{' '}
                条
              </p>

              {/* 总览：多卡平分宽度；仅一卡占满；移动端横滑；无外框 */}
              <section className="space-y-1.5">
                <h2 className="text-sm font-semibold">{ANALYSIS_REPORT_COPY.overviewTitle}</h2>
                <PlatformKpiRow brand={brand} />
              </section>

              {/* 差评归因 */}
              <section className="space-y-1.5">
                <h2 className="text-sm font-semibold">{ANALYSIS_REPORT_COPY.causeTitle}</h2>
                {brand.causeRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {ANALYSIS_REPORT_COPY.emptyCause}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.causeMajor}
                          </th>
                          <th className="px-3 py-2 font-medium tabular-nums">
                            {ANALYSIS_REPORT_COPY.causeMajorN}
                          </th>
                          <th className="px-3 py-2 font-medium tabular-nums">
                            {ANALYSIS_REPORT_COPY.causeMajorPct}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.causeMinor}
                          </th>
                          <th className="px-3 py-2 font-medium tabular-nums">
                            {ANALYSIS_REPORT_COPY.causeMinorN}
                          </th>
                          <th className="px-3 py-2 font-medium tabular-nums">
                            {ANALYSIS_REPORT_COPY.causeMinorPct}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {brand.causeRows.map((row, i) => (
                          <tr key={`${row.major}-${row.minor}-${i}`}>
                            {row.isFirstOfMajor ? (
                              <>
                                <td
                                  className="px-3 py-2 align-top font-medium"
                                  rowSpan={row.majorRowSpan}
                                >
                                  <Tag>{row.major}</Tag>
                                </td>
                                <td
                                  className="px-3 py-2 align-top tabular-nums"
                                  rowSpan={row.majorRowSpan}
                                >
                                  {row.majorCount}
                                </td>
                                <td
                                  className="px-3 py-2 align-top tabular-nums"
                                  rowSpan={row.majorRowSpan}
                                >
                                  {pct(row.majorShare)}
                                </td>
                              </>
                            ) : null}
                            <td className="px-3 py-2">
                              <Tag className="bg-muted/60">{row.minor}</Tag>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{row.minorCount}</td>
                            <td className="px-3 py-2 tabular-nums">{pct(row.minorShare)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 各平台 Top 10：多卡平分宽度；仅一卡占满；移动端横滑 */}
              <section className="space-y-1.5">
                <h2 className="text-sm font-semibold">
                  {ANALYSIS_REPORT_COPY.topProductTitle}
                </h2>
                {(brand.topProductsByPlatform ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {ANALYSIS_REPORT_COPY.emptyProduct}
                  </p>
                ) : (
                  <div
                    className={cn(
                      (brand.topProductsByPlatform ?? []).length === 1
                        ? 'grid grid-cols-1'
                        : [
                            'grid gap-3',
                            // 移动：横向滚动，每卡约 90% 宽
                            'auto-cols-[minmax(16rem,90%)] grid-flow-col overflow-x-auto pb-1',
                            // ≥640：一行最多 2；≥1280：一行最多 3，平分宽度
                            'sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible',
                            'xl:grid-cols-3',
                          ].join(' '),
                    )}
                  >
                    {(brand.topProductsByPlatform ?? []).map((block) => (
                      <div
                        key={block.platform}
                        className="flex min-w-0 flex-col rounded-xl border bg-card"
                      >
                        <div className="flex items-center justify-between border-b px-3 py-2">
                          <Tag className="bg-primary/10 text-primary">
                            {block.platform}
                          </Tag>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {block.reviewCount}
                            {ANALYSIS_REPORT_COPY.countUnit}
                          </span>
                        </div>
                        {block.products.length === 0 ? (
                          <p className="px-3 py-4 text-xs text-muted-foreground">
                            {ANALYSIS_REPORT_COPY.topPlatformEmpty}
                          </p>
                        ) : (
                          <div className="max-h-[22rem] overflow-auto">
                            <table className="w-full text-left text-sm">
                              <thead className="sticky top-0 z-10 border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                  <th className="w-10 px-3 py-2 font-medium">
                                    {ANALYSIS_REPORT_COPY.topRank}
                                  </th>
                                  <th className="px-3 py-2 font-medium">
                                    {ANALYSIS_REPORT_COPY.topProduct}
                                  </th>
                                  <th className="w-20 px-3 py-2 text-right font-medium whitespace-nowrap">
                                    {ANALYSIS_REPORT_COPY.topCount}
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {block.products.map((p) => (
                                  <tr key={`${block.platform}-${p.productKey}`}>
                                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                                      {p.rank}
                                    </td>
                                    <td className="px-3 py-2">{p.productLabel}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                      {p.reviewCount}
                                      {ANALYSIS_REPORT_COPY.countUnit}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 产品结论：标题与筛选左右平级 */}
              <section className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {ANALYSIS_REPORT_COPY.conclusionTitle}
                  </h2>
                  <ListFiltersPanel
                    filters={conclusionFilterFields}
                    values={{ major: majorFilter, minor: minorFilter }}
                    onChange={(next) => {
                      const major = next.major ?? '';
                      const minor = next.minor ?? '';
                      setMajorFilter(major);
                      setMinorFilter(major ? minor : '');
                    }}
                  />
                </div>
                {filteredConclusions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {ANALYSIS_REPORT_COPY.emptyProduct}
                  </p>
                ) : (
                  <div className="max-h-[28rem] overflow-auto rounded-md border">
                    <table className="w-full min-w-[1100px] text-left text-sm">
                      <thead className="sticky top-0 z-20 border-b bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th className="bg-muted px-3 py-2 font-medium whitespace-nowrap md:sticky md:left-0 md:z-30 md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">
                            {ANALYSIS_REPORT_COPY.colProduct}
                          </th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.colCount}
                          </th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.colTopSku}
                          </th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.colMainCause}
                          </th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.colPlatformDist}
                          </th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.colSuggestions}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredConclusions.map((p) => (
                          <tr key={p.productKey} className="bg-background">
                            <td className="bg-background px-3 py-2 align-top font-medium whitespace-nowrap md:sticky md:left-0 md:z-10 md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">
                              {p.productLabel}
                            </td>
                            <td className="px-3 py-2 align-top whitespace-nowrap">
                              <span className="tabular-nums font-medium">
                                {p.reviewCount}
                                {ANALYSIS_REPORT_COPY.countUnit}
                              </span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {pct(p.reviewShare ?? 0)}
                              </span>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <TagRow>
                                {(p.topSkus ?? []).map((s) => (
                                  <Tag key={s.sku}>
                                    {s.sku} · {s.reviewCount}
                                    {ANALYSIS_REPORT_COPY.countUnit}/{pct(s.share)}
                                  </Tag>
                                ))}
                                {!p.topSkus?.length ? <span>—</span> : null}
                              </TagRow>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <TagRow>
                                {(p.mainCauseItems ?? []).map((c) => (
                                  <Tag key={`${c.major}-${c.minor}`}>
                                    {c.major}/{c.minor} · {c.count}
                                    {ANALYSIS_REPORT_COPY.countUnit}/{pct(c.share)}
                                  </Tag>
                                ))}
                                {!p.mainCauseItems?.length ? (
                                  <span className="text-xs">{p.mainCauses || '—'}</span>
                                ) : null}
                              </TagRow>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <TagRow>
                                {(p.platforms ?? []).map((pl) => (
                                  <Tag key={pl.platform}>
                                    {pl.platform} · {pl.count}
                                    {ANALYSIS_REPORT_COPY.countUnit}/{pct(pl.share)}
                                  </Tag>
                                ))}
                                {!p.platforms?.length ? <span>—</span> : null}
                              </TagRow>
                            </td>
                            <td className="min-w-[16rem] px-3 py-2 align-top">
                              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                                {(p.suggestions ?? []).map((tip, i) => (
                                  <li key={i}>{tip}</li>
                                ))}
                                {!p.suggestions?.length ? <li>—</li> : null}
                              </ol>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 明细 */}
              <section className="space-y-1.5">
                <h2 className="text-sm font-semibold">{ANALYSIS_REPORT_COPY.detailTitle}</h2>
                {brand.details.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {ANALYSIS_REPORT_COPY.emptyDetail}
                  </p>
                ) : (
                  <div className="max-h-[28rem] overflow-auto rounded-md border">
                    <table className="w-full min-w-[1080px] text-left text-sm">
                      <thead className="sticky top-0 z-10 border-b bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.detailDate}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.detailPlatform}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.colProduct}
                          </th>
                          <th className="px-3 py-2 font-medium">SKU</th>
                          <th className="px-3 py-2 font-medium whitespace-nowrap">
                            {ANALYSIS_REPORT_COPY.detailRating}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.causeMajor}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.causeMinor}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.detailText}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {ANALYSIS_REPORT_COPY.detailEvidence}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {brand.details.map((d) => (
                          <tr key={d.reviewId}>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-xs text-muted-foreground">
                              {d.reviewDateLocal ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              {d.platform ? <Tag>{d.platform}</Tag> : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">
                              {d.productLabel}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">
                              {d.sku ?? '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                              {d.rating ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <Tag>{d.major}</Tag>
                            </td>
                            <td className="px-3 py-2">
                              <Tag className="bg-muted/60">{d.minor}</Tag>
                            </td>
                            <td className="min-w-[14rem] max-w-[20rem] px-3 py-2 text-xs text-muted-foreground">
                              <TruncatedText
                                text={d.reviewText}
                                empty="—"
                                className="text-xs text-muted-foreground"
                              />
                            </td>
                            <td className="min-w-[10rem] max-w-[16rem] px-3 py-2 text-xs text-muted-foreground">
                              <TruncatedText
                                text={d.evidenceQuote}
                                empty="—"
                                className="text-xs text-muted-foreground"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
