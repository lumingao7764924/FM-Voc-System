import { BigQuery } from '@google-cloud/bigquery';
import type { ReviewListItem, ReviewListResponse } from '@voc/shared';
import { env } from '../config.js';
import { formatReviewDisplayTime } from '../bqValue.js';
import { memoryListFactReviews } from '../import/store.js';
import {
  brandScopeParams,
  BRAND_SCOPE_PARAM_TYPES,
  filterMemoryReviews,
  normalizeReviewFilters,
  reviewFilterWhereSql,
  toFilterParams,
} from './filters.js';
import type { AccessPolicy } from '@voc/shared';
import { applyBrandScopeToFilterBrand } from '../access/policy.js';
import { getReviewFacets } from '../bq/facets.js';

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

export function mapReviewRow(r: Record<string, unknown>): ReviewListItem {
  const ratingRaw = r.rating_normalized_5 ?? r.rating_numeric;
  return {
    reviewId: String(r.review_id ?? ''),
    reviewDateLocal: formatReviewDisplayTime({
      dateLocal: r.review_date_local,
      createdAtLocal: r.review_created_at_local,
    }),
    rating: ratingRaw == null || ratingRaw === '' ? null : Number(ratingRaw),
    brandKey: r.brand_key != null ? String(r.brand_key) : null,
    countryCode: r.country_code != null ? String(r.country_code) : null,
    platform: r.platform != null ? String(r.platform) : null,
    platformSku: r.platform_sku != null ? String(r.platform_sku) : null,
    platformProductName:
      r.platform_product_name != null ? String(r.platform_product_name) : null,
    internalSpu: r.internal_spu != null ? String(r.internal_spu) : null,
    internalSku: r.internal_sku != null ? String(r.internal_sku) : null,
    productNameCn: r.product_name_cn != null ? String(r.product_name_cn) : null,
    productNameEn: r.product_name_en != null ? String(r.product_name_en) : null,
    productMappingStatus: String(r.product_mapping_status ?? 'pending'),
    reviewScope: r.review_scope != null ? String(r.review_scope) : null,
    reviewTitle: r.review_title_original != null ? String(r.review_title_original) : null,
    reviewText: r.review_text_original != null ? String(r.review_text_original) : null,
  };
}

function facetFromItems(items: ReviewListItem[]) {
  const brands = [...new Set(items.map((i) => i.brandKey).filter(Boolean) as string[])].sort();
  const countries = [
    ...new Set(items.map((i) => i.countryCode).filter(Boolean) as string[]),
  ].sort();
  const platforms = [
    ...new Set(items.map((i) => i.platform).filter(Boolean) as string[]),
  ].sort();
  return { brands, countries, platforms };
}

export async function listReviews(opts: {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  spu?: string;
  sku?: string;
  country?: string;
  platform?: string;
  /** yes=已映射 confirmed；no=未映射（非 confirmed） */
  mapped?: string;
  q?: string;
  ratingMin?: string;
  ratingMax?: string;
  access?: AccessPolicy;
} = {}): Promise<ReviewListResponse> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? opts.pageSize ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);
  const page = opts.page ?? Math.floor(offset / limit) + 1;
  const pageSize = opts.pageSize ?? limit;
  const scope = opts.access
    ? applyBrandScopeToFilterBrand(opts.brand, opts.access)
    : { brand: (opts.brand ?? '').trim(), allowedBrands: null as string[] | null, denyAll: false };
  const filters = normalizeReviewFilters({ ...opts, brand: scope.brand });
  const scopeParams = brandScopeParams(scope.allowedBrands, scope.denyAll);

  const fromMemory = (): ReviewListResponse => {
    const all = memoryListFactReviews().map(mapReviewRow);
    const facets = facetFromItems(all);
    const filtered = filterMemoryReviews(all, filters, {
      allowedBrands: scope.allowedBrands,
      denyAll: scope.denyAll,
    });
    filtered.sort((a, b) =>
      String(b.reviewDateLocal ?? '').localeCompare(String(a.reviewDateLocal ?? '')),
    );
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      page,
      pageSize,
      ...facets,
    };
  };

  if (env.importDryRun) return fromMemory();

  const project = env.gcpProjectId;
  const filterParams = { ...toFilterParams(filters), ...scopeParams };
  const whereSql = reviewFilterWhereSql();

  try {
    const bqClient = getBq();
    const [{ brands, countries, platforms }, [countRows], [rows]] = await Promise.all([
      getReviewFacets(bqClient, project),
      bqClient.query({
        query: `
          SELECT COUNT(1) AS total
          FROM \`${project}.review_serving.v_review_current\`
          ${whereSql}
        `,
        params: filterParams,
        types: BRAND_SCOPE_PARAM_TYPES,
      }),
      bqClient.query({
        query: `
          SELECT
            review_id,
            review_date_local,
            review_created_at_local,
            rating_normalized_5,
            brand_key,
            country_code,
            platform,
            platform_sku,
            platform_product_name,
            internal_spu,
            internal_sku,
            product_name_cn,
            product_name_en,
            product_mapping_status,
            review_scope,
            review_title_original,
            review_text_original
          FROM \`${project}.review_serving.v_review_current\`
          ${whereSql}
          ORDER BY review_date_local DESC, review_created_at_local DESC, review_id
          LIMIT @limit OFFSET @offset
        `,
        params: { ...filterParams, limit, offset },
        types: BRAND_SCOPE_PARAM_TYPES,
      }),
    ]);
    const total = Number((countRows as Record<string, unknown>[])[0]?.total ?? 0);

    return {
      items: (rows as Record<string, unknown>[]).map(mapReviewRow),
      total,
      page,
      pageSize,
      brands,
      countries,
      platforms,
    };
  } catch (e) {
    console.warn('[review] list failed, falling back to memory', e instanceof Error ? e.message : e);
    return fromMemory();
  }
}
