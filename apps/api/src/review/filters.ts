/** 评论列表 / 分析看板共用筛选解析与 SQL 条件 */

export type ReviewFilterOpts = {
  dateFrom: string;
  dateTo: string;
  brand: string;
  spu: string;
  sku: string;
  country: string;
  platform: string;
  mapped: string;
  q: string;
  ratingMin: number | null;
  ratingMax: number | null;
};

export type ReviewFilterParams = {
  dateFrom: string;
  dateTo: string;
  brand: string;
  spu: string;
  sku: string;
  country: string;
  platform: string;
  mapped: string;
  q: string;
  ratingMin: number;
  ratingMax: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRatingBound(raw: string | undefined, fallback: null): number | null {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function parseDateBound(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  return DATE_RE.test(s) ? s : '';
}

export function normalizeReviewFilters(input: {
  dateFrom?: string;
  dateTo?: string;
  brand?: string;
  spu?: string;
  sku?: string;
  country?: string;
  platform?: string;
  mapped?: string;
  q?: string;
  ratingMin?: string;
  ratingMax?: string;
}): ReviewFilterOpts {
  return {
    dateFrom: parseDateBound(input.dateFrom),
    dateTo: parseDateBound(input.dateTo),
    brand: (input.brand ?? '').trim().toLowerCase(),
    spu: (input.spu ?? '').trim().toLowerCase(),
    sku: (input.sku ?? '').trim().toLowerCase(),
    country: (input.country ?? '').trim().toLowerCase(),
    platform: (input.platform ?? '').trim().toLowerCase(),
    mapped: (input.mapped ?? '').trim().toLowerCase(),
    q: (input.q ?? '').trim().toLowerCase(),
    ratingMin: parseRatingBound(input.ratingMin, null),
    ratingMax: parseRatingBound(input.ratingMax, null),
  };
}

export function toFilterParams(opts: ReviewFilterOpts): ReviewFilterParams {
  return {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    brand: opts.brand,
    spu: opts.spu,
    sku: opts.sku,
    country: opts.country,
    platform: opts.platform,
    mapped: opts.mapped,
    q: opts.q,
    ratingMin: opts.ratingMin ?? 0,
    ratingMax: opts.ratingMax ?? 0,
  };
}

export function hasActiveFilters(opts: ReviewFilterOpts): boolean {
  return Boolean(
    opts.dateFrom ||
      opts.dateTo ||
      opts.brand ||
      opts.spu ||
      opts.sku ||
      opts.country ||
      opts.platform ||
      opts.mapped ||
      opts.q ||
      opts.ratingMin != null ||
      opts.ratingMax != null,
  );
}

/** BigQuery WHERE 片段（参数名与 toFilterParams 对齐；含可选品牌范围） */
export function reviewFilterWhereSql(): string {
  return `
        WHERE (@dateFrom = '' OR review_date_local >= @dateFrom)
          AND (@dateTo = '' OR review_date_local <= @dateTo)
          AND (@denyAll = FALSE)
          AND (
            @allowedBrandMode = 'all'
            OR (
              @allowedBrandMode = 'list'
              AND LOWER(IFNULL(brand_key, '')) IN UNNEST(@allowedBrands)
            )
          )
          AND (@brand = '' OR LOWER(IFNULL(brand_key, '')) = @brand)
          AND (@spu = '' OR LOWER(IFNULL(internal_spu, '')) = @spu)
          AND (@sku = '' OR LOWER(IFNULL(internal_sku, '')) = @sku)
          AND (@country = '' OR LOWER(IFNULL(country_code, '')) = @country)
          AND (@platform = '' OR LOWER(IFNULL(platform, '')) = @platform)
          AND (
            @mapped = ''
            OR (@mapped = 'yes' AND product_mapping_status = 'confirmed')
            OR (@mapped = 'no' AND IFNULL(product_mapping_status, '') != 'confirmed')
          )
          AND (@ratingMin = 0 OR rating_normalized_5 >= @ratingMin)
          AND (@ratingMax = 0 OR rating_normalized_5 <= @ratingMax)
          AND (
            @q = ''
            OR STRPOS(LOWER(IFNULL(platform_sku, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(internal_spu, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(internal_sku, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(product_name_cn, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(product_name_en, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(platform_product_name, '')), @q) > 0
          )
  `;
}

export type BrandScopeParams = {
  denyAll: boolean;
  allowedBrandMode: 'all' | 'list' | 'none';
  allowedBrands: string[];
};

/** BigQuery 空数组必须声明类型，否则报 Parameter types must be provided for empty arrays */
export const BRAND_SCOPE_PARAM_TYPES: { allowedBrands: string[] } = {
  allowedBrands: ['STRING'],
};

export function brandScopeParams(
  allowedBrands: string[] | null,
  denyAll: boolean,
): BrandScopeParams {
  if (denyAll || (allowedBrands && allowedBrands.length === 0)) {
    return { denyAll: true, allowedBrandMode: 'none', allowedBrands: [] };
  }
  if (allowedBrands == null) {
    return { denyAll: false, allowedBrandMode: 'all', allowedBrands: [] };
  }
  return {
    denyAll: false,
    allowedBrandMode: 'list',
    allowedBrands: allowedBrands.map((b) => b.toLowerCase()),
  };
}

export type MemoryReviewLike = {
  reviewDateLocal: string | null;
  rating: number | null;
  brandKey: string | null;
  countryCode: string | null;
  platform: string | null;
  platformSku: string | null;
  platformProductName: string | null;
  internalSpu: string | null;
  internalSku: string | null;
  productNameCn: string | null;
  productNameEn: string | null;
  productMappingStatus: string;
};

export function filterMemoryReviews<T extends MemoryReviewLike>(
  items: T[],
  opts: ReviewFilterOpts,
  scope?: { allowedBrands: string[] | null; denyAll: boolean },
): T[] {
  if (scope?.denyAll) return [];
  let next = items;
  if (scope?.allowedBrands) {
    const set = new Set(scope.allowedBrands.map((b) => b.toLowerCase()));
    next = next.filter((i) => set.has((i.brandKey ?? '').toLowerCase()));
  }
  if (opts.dateFrom) {
    next = next.filter((i) => (i.reviewDateLocal ?? '').slice(0, 10) >= opts.dateFrom);
  }
  if (opts.dateTo) {
    next = next.filter((i) => (i.reviewDateLocal ?? '').slice(0, 10) <= opts.dateTo);
  }
  if (opts.brand) {
    next = next.filter((i) => (i.brandKey ?? '').toLowerCase() === opts.brand);
  }
  if (opts.spu) {
    next = next.filter((i) => (i.internalSpu ?? '').toLowerCase() === opts.spu);
  }
  if (opts.sku) {
    next = next.filter((i) => (i.internalSku ?? '').toLowerCase() === opts.sku);
  }
  if (opts.country) {
    next = next.filter((i) => (i.countryCode ?? '').toLowerCase() === opts.country);
  }
  if (opts.platform) {
    next = next.filter((i) => (i.platform ?? '').toLowerCase() === opts.platform);
  }
  if (opts.mapped === 'yes') {
    next = next.filter((i) => i.productMappingStatus === 'confirmed');
  } else if (opts.mapped === 'no') {
    next = next.filter((i) => i.productMappingStatus !== 'confirmed');
  }
  if (opts.ratingMin != null) {
    next = next.filter((i) => i.rating != null && i.rating >= opts.ratingMin!);
  }
  if (opts.ratingMax != null) {
    next = next.filter((i) => i.rating != null && i.rating <= opts.ratingMax!);
  }
  if (opts.q) {
    next = next.filter((i) => {
      const hay = [
        i.platformSku,
        i.internalSpu,
        i.internalSku,
        i.productNameCn,
        i.productNameEn,
        i.platformProductName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(opts.q);
    });
  }
  return next;
}

export function rateOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function avgOrNull(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return sum / count;
}

export function isMappedSpu(status: string, internalSpu: string | null | undefined): boolean {
  return status === 'confirmed' && Boolean((internalSpu ?? '').trim());
}
