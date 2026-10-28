import { BigQuery } from '@google-cloud/bigquery';
import {
  ANALYTICS_COPY,
  type AnalyticsBreakdownDimension,
  type AnalyticsBreakdownResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsTrendGranularity,
  type AnalyticsTrendResponse,
} from '@voc/shared';
import { env } from '../config.js';
import { memoryListFactReviews } from '../import/store.js';
import {
  avgOrNull,
  brandScopeParams,
  BRAND_SCOPE_PARAM_TYPES,
  filterMemoryReviews,
  hasActiveFilters,
  isMappedSpu,
  normalizeReviewFilters,
  rateOrNull,
  reviewFilterWhereSql,
  toFilterParams,
  type ReviewFilterOpts,
} from '../review/filters.js';
import { mapReviewRow } from '../review/store.js';
import type { AccessPolicy } from '@voc/shared';
import { applyBrandScopeToFilterBrand } from '../access/policy.js';
import { getReviewFacets } from '../bq/facets.js';

/** 本产品分析口径：1～3 星为差评（主方案原文为 1～2 + 3 单列） */
const NEGATIVE_RATING_MAX = 3;

function resolveFilterScope(input: {
  brand?: string;
  access?: AccessPolicy;
}) {
  if (!input.access) {
    return {
      brand: (input.brand ?? '').trim(),
      allowedBrands: null as string[] | null,
      denyAll: false,
    };
  }
  return applyBrandScopeToFilterBrand(input.brand, input.access);
}

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function servingTable(): string {
  return `\`${env.gcpProjectId}.review_serving.v_review_current\``;
}

function roundRate(n: number | null): number | null {
  if (n == null) return null;
  return Math.round(n * 10000) / 10000;
}

function roundAvg(n: number | null): number | null {
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function computeOverviewFromItems(
  filtered: ReturnType<typeof mapReviewRow>[],
  allCount: number,
  opts: ReviewFilterOpts,
  facets: { brands: string[]; countries: string[]; platforms: string[] },
): AnalyticsOverviewResponse {
  const totalReviews = filtered.length;
  let ratedCount = 0;
  let ratingSum = 0;
  let low = 0;
  let high = 0;
  let mappedSpuCount = 0;

  for (const i of filtered) {
    if (isMappedSpu(i.productMappingStatus, i.internalSpu)) mappedSpuCount += 1;
    if (i.rating == null || !Number.isFinite(i.rating)) continue;
    ratedCount += 1;
    ratingSum += i.rating;
    if (i.rating <= NEGATIVE_RATING_MAX) low += 1;
    else high += 1;
  }

  let emptyReason: AnalyticsOverviewResponse['emptyReason'] = null;
  if (totalReviews === 0) {
    emptyReason = allCount === 0 || !hasActiveFilters(opts) ? 'no_data' : 'filtered_empty';
  }

  return {
    totalReviews,
    ratedCount,
    avgRating: roundAvg(avgOrNull(ratingSum, ratedCount)),
    lowStarRate: roundRate(rateOrNull(low, ratedCount)),
    highStarRate: roundRate(rateOrNull(high, ratedCount)),
    mappedSpuCount,
    mappedSpuRate: roundRate(rateOrNull(mappedSpuCount, totalReviews)),
    emptyReason,
    sampleNote: ANALYTICS_COPY.sampleNote,
    brands: facets.brands,
    countries: facets.countries,
    platforms: facets.platforms,
  };
}

function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  // ISO week: Thursday-based
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function memoryFacets(all: ReturnType<typeof mapReviewRow>[]) {
  return {
    brands: [...new Set(all.map((i) => i.brandKey).filter(Boolean) as string[])].sort(),
    countries: [...new Set(all.map((i) => i.countryCode).filter(Boolean) as string[])].sort(),
    platforms: [...new Set(all.map((i) => i.platform).filter(Boolean) as string[])].sort(),
  };
}

export async function getAnalyticsOverview(input: {
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  spu?: string;
  sku?: string;
  country?: string;
  platform?: string;
  mapped?: string;
  ratingMin?: string;
  ratingMax?: string;
  access?: AccessPolicy;
}): Promise<AnalyticsOverviewResponse> {
  const scope = resolveFilterScope(input);
  const filters = normalizeReviewFilters({ ...input, brand: scope.brand });
  const scopeParams = brandScopeParams(scope.allowedBrands, scope.denyAll);

  const fromMemory = (): AnalyticsOverviewResponse => {
    const all = memoryListFactReviews().map(mapReviewRow);
    const filtered = filterMemoryReviews(all, filters, {
      allowedBrands: scope.allowedBrands,
      denyAll: scope.denyAll,
    });
    return computeOverviewFromItems(filtered, all.length, filters, memoryFacets(all));
  };

  if (env.importDryRun) return fromMemory();

  const params = { ...toFilterParams(filters), ...scopeParams };
  const whereSql = reviewFilterWhereSql();

  try {
    const bqClient = getBq();
    const [facets, [aggRows]] = await Promise.all([
      getReviewFacets(bqClient, env.gcpProjectId),
      bqClient.query({
        query: `
          SELECT
            COUNT(1) AS total_reviews,
            COUNTIF(rating_normalized_5 IS NOT NULL) AS rated_count,
            AVG(rating_normalized_5) AS avg_rating,
            COUNTIF(rating_normalized_5 IS NOT NULL AND rating_normalized_5 <= ${NEGATIVE_RATING_MAX}) AS low_count,
            COUNTIF(rating_normalized_5 IS NOT NULL AND rating_normalized_5 >= 4) AS high_count,
            COUNTIF(
              product_mapping_status = 'confirmed'
              AND internal_spu IS NOT NULL
              AND internal_spu != ''
            ) AS mapped_spu_count
          FROM ${servingTable()}
          ${whereSql}
        `,
        params,
        types: BRAND_SCOPE_PARAM_TYPES,
      }),
    ]);
    const { brands, countries, platforms } = facets;

    const row = (aggRows as Record<string, unknown>[])[0] ?? {};
    const totalReviews = Number(row.total_reviews ?? 0);
    const ratedCount = Number(row.rated_count ?? 0);
    const low = Number(row.low_count ?? 0);
    const high = Number(row.high_count ?? 0);
    const mappedSpuCount = Number(row.mapped_spu_count ?? 0);
    const avgRaw = row.avg_rating == null || row.avg_rating === '' ? null : Number(row.avg_rating);

    let emptyReason: AnalyticsOverviewResponse['emptyReason'] = null;
    if (totalReviews === 0) {
      if (!hasActiveFilters(filters)) {
        emptyReason = 'no_data';
      } else {
        const [anyRows] = await bqClient.query({
          query: `SELECT COUNT(1) AS total FROM ${servingTable()}`,
        });
        const anyTotal = Number((anyRows as Record<string, unknown>[])[0]?.total ?? 0);
        emptyReason = anyTotal === 0 ? 'no_data' : 'filtered_empty';
      }
    }

    return {
      totalReviews,
      ratedCount,
      avgRating: roundAvg(avgRaw),
      lowStarRate: roundRate(rateOrNull(low, ratedCount)),
      highStarRate: roundRate(rateOrNull(high, ratedCount)),
      mappedSpuCount,
      mappedSpuRate: roundRate(rateOrNull(mappedSpuCount, totalReviews)),
      emptyReason,
      sampleNote: ANALYTICS_COPY.sampleNote,
      brands,
      countries,
      platforms,
    };
  } catch (e) {
    console.warn('[analytics] overview failed, memory fallback', e instanceof Error ? e.message : e);
    return fromMemory();
  }
}

export async function getAnalyticsTrend(input: {
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  spu?: string;
  sku?: string;
  country?: string;
  platform?: string;
  mapped?: string;
  ratingMin?: string;
  ratingMax?: string;
  granularity?: string;
  access?: AccessPolicy;
}): Promise<AnalyticsTrendResponse> {
  const scope = resolveFilterScope(input);
  const filters = normalizeReviewFilters({ ...input, brand: scope.brand });
  const scopeParams = brandScopeParams(scope.allowedBrands, scope.denyAll);
  const granularity: AnalyticsTrendGranularity =
    input.granularity === 'week' ? 'week' : 'day';

  const fromMemory = (): AnalyticsTrendResponse => {
    const all = memoryListFactReviews().map(mapReviewRow);
    const filtered = filterMemoryReviews(all, filters, {
      allowedBrands: scope.allowedBrands,
      denyAll: scope.denyAll,
    });
    const buckets = new Map<
      string,
      { count: number; rated: number; sum: number; low: number }
    >();
    for (const i of filtered) {
      const date = (i.reviewDateLocal ?? '').slice(0, 10);
      if (!date) continue;
      const key = granularity === 'week' ? weekKey(date) : date;
      const cur = buckets.get(key) ?? { count: 0, rated: 0, sum: 0, low: 0 };
      cur.count += 1;
      if (i.rating != null && Number.isFinite(i.rating)) {
        cur.rated += 1;
        cur.sum += i.rating;
        if (i.rating <= NEGATIVE_RATING_MAX) cur.low += 1;
      }
      buckets.set(key, cur);
    }
    const points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        period,
        reviewCount: v.count,
        avgRating: roundAvg(avgOrNull(v.sum, v.rated)),
        lowStarRate: roundRate(rateOrNull(v.low, v.rated)),
      }));
    return { granularity, points };
  };

  if (env.importDryRun) return fromMemory();

  const params = { ...toFilterParams(filters), ...scopeParams };
  const whereSql = reviewFilterWhereSql();
  const periodExpr =
    granularity === 'week'
      ? `FORMAT_DATE('%G-W%V', review_date_local)`
      : `CAST(review_date_local AS STRING)`;

  try {
    const [rows] = await getBq().query({
      query: `
        SELECT
          ${periodExpr} AS period,
          COUNT(1) AS review_count,
          AVG(rating_normalized_5) AS avg_rating,
          SAFE_DIVIDE(
            COUNTIF(rating_normalized_5 IS NOT NULL AND rating_normalized_5 <= ${NEGATIVE_RATING_MAX}),
            COUNTIF(rating_normalized_5 IS NOT NULL)
          ) AS low_star_rate
        FROM ${servingTable()}
        ${whereSql}
          AND review_date_local IS NOT NULL
        GROUP BY period
        ORDER BY period
      `,
      params,
      types: BRAND_SCOPE_PARAM_TYPES,
    });

    return {
      granularity,
      points: (rows as Record<string, unknown>[]).map((r) => ({
        period: String(r.period ?? ''),
        reviewCount: Number(r.review_count ?? 0),
        avgRating: roundAvg(
          r.avg_rating == null || r.avg_rating === '' ? null : Number(r.avg_rating),
        ),
        lowStarRate: roundRate(
          r.low_star_rate == null || r.low_star_rate === '' ? null : Number(r.low_star_rate),
        ),
      })),
    };
  } catch (e) {
    console.warn('[analytics] trend failed, memory fallback', e instanceof Error ? e.message : e);
    return fromMemory();
  }
}

const DIM_COLUMNS: Record<AnalyticsBreakdownDimension, string> = {
  brand: 'brand_key',
  spu: 'internal_spu',
  sku: 'internal_sku',
  country: 'country_code',
  platform: 'platform',
};

function dimKeyFromItem(
  item: ReturnType<typeof mapReviewRow>,
  dimension: AnalyticsBreakdownDimension,
): string {
  switch (dimension) {
    case 'brand':
      return (item.brandKey ?? '').trim();
    case 'spu':
      return (item.internalSpu ?? '').trim();
    case 'sku':
      return (item.internalSku ?? '').trim();
    case 'country':
      return (item.countryCode ?? '').trim();
    case 'platform':
      return (item.platform ?? '').trim();
  }
}

export async function getAnalyticsBreakdown(input: {
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  spu?: string;
  sku?: string;
  country?: string;
  platform?: string;
  mapped?: string;
  ratingMin?: string;
  ratingMax?: string;
  dimension?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  offset?: number;
  access?: AccessPolicy;
}): Promise<AnalyticsBreakdownResponse> {
  const scope = resolveFilterScope(input);
  const filters = normalizeReviewFilters({ ...input, brand: scope.brand });
  const scopeParams = brandScopeParams(scope.allowedBrands, scope.denyAll);
  const dimension: AnalyticsBreakdownDimension =
    input.dimension === 'brand' ||
    input.dimension === 'sku' ||
    input.dimension === 'country' ||
    input.dimension === 'platform' ||
    input.dimension === 'spu'
      ? input.dimension
      : 'spu';
  const pageSize = Math.min(
    100,
    Math.max(1, input.pageSize ?? input.limit ?? 10),
  );
  const page = Math.max(1, input.page ?? 1);
  const offset =
    input.offset != null && Number.isFinite(input.offset)
      ? Math.max(0, Number(input.offset))
      : (page - 1) * pageSize;

  const fromMemory = (): AnalyticsBreakdownResponse => {
    const all = memoryListFactReviews().map(mapReviewRow);
    const filtered = filterMemoryReviews(all, filters, {
      allowedBrands: scope.allowedBrands,
      denyAll: scope.denyAll,
    });
    const buckets = new Map<
      string,
      { count: number; rated: number; sum: number; low: number }
    >();
    for (const i of filtered) {
      const key = dimKeyFromItem(i, dimension);
      if (!key) continue;
      const cur = buckets.get(key) ?? { count: 0, rated: 0, sum: 0, low: 0 };
      cur.count += 1;
      if (i.rating != null && Number.isFinite(i.rating)) {
        cur.rated += 1;
        cur.sum += i.rating;
        if (i.rating <= NEGATIVE_RATING_MAX) cur.low += 1;
      }
      buckets.set(key, cur);
    }
    const sorted = [...buckets.entries()]
      .map(([key, v]) => ({
        key,
        reviewCount: v.count,
        avgRating: roundAvg(avgOrNull(v.sum, v.rated)),
        lowStarRate: roundRate(rateOrNull(v.low, v.rated)),
      }))
      .sort((a, b) => b.reviewCount - a.reviewCount || a.key.localeCompare(b.key));
    return {
      dimension,
      items: sorted.slice(offset, offset + pageSize),
      total: sorted.length,
      page,
      pageSize,
    };
  };

  if (env.importDryRun) return fromMemory();

  const col = DIM_COLUMNS[dimension];
  const params = { ...toFilterParams(filters), ...scopeParams };
  const whereSql = reviewFilterWhereSql();

  try {
    const bqClient = getBq();
    const [[countRows], [rows]] = await Promise.all([
      bqClient.query({
        query: `
          SELECT COUNT(1) AS total
          FROM (
            SELECT ${col} AS dim_key
            FROM ${servingTable()}
            ${whereSql}
              AND ${col} IS NOT NULL
              AND CAST(${col} AS STRING) != ''
            GROUP BY dim_key
          )
        `,
        params,
        types: BRAND_SCOPE_PARAM_TYPES,
      }),
      bqClient.query({
        query: `
          SELECT
            ${col} AS dim_key,
            COUNT(1) AS review_count,
            AVG(rating_normalized_5) AS avg_rating,
            SAFE_DIVIDE(
              COUNTIF(rating_normalized_5 IS NOT NULL AND rating_normalized_5 <= ${NEGATIVE_RATING_MAX}),
              COUNTIF(rating_normalized_5 IS NOT NULL)
            ) AS low_star_rate
          FROM ${servingTable()}
          ${whereSql}
            AND ${col} IS NOT NULL
            AND CAST(${col} AS STRING) != ''
          GROUP BY dim_key
          ORDER BY review_count DESC, dim_key
          LIMIT @limit OFFSET @offset
        `,
        params: { ...params, limit: pageSize, offset },
        types: BRAND_SCOPE_PARAM_TYPES,
      }),
    ]);
    const total = Number((countRows as Record<string, unknown>[])[0]?.total ?? 0);

    return {
      dimension,
      items: (rows as Record<string, unknown>[]).map((r) => ({
        key: String(r.dim_key ?? ''),
        reviewCount: Number(r.review_count ?? 0),
        avgRating: roundAvg(
          r.avg_rating == null || r.avg_rating === '' ? null : Number(r.avg_rating),
        ),
        lowStarRate: roundRate(
          r.low_star_rate == null || r.low_star_rate === '' ? null : Number(r.low_star_rate),
        ),
      })),
      total,
      page,
      pageSize,
    };
  } catch (e) {
    console.warn(
      '[analytics] breakdown failed, memory fallback',
      e instanceof Error ? e.message : e,
    );
    return fromMemory();
  }
}
