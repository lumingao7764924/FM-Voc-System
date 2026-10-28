import type { BigQuery } from '@google-cloud/bigquery';

export type ReviewFacets = {
  brands: string[];
  countries: string[];
  platforms: string[];
};

type FacetCacheEntry = { at: number; value: ReviewFacets };

const FACET_TTL_MS = 5 * 60_000;

const g = globalThis as typeof globalThis & {
  __vocFacetCache?: Map<string, FacetCacheEntry>;
  __vocFacetInflight?: Map<string, Promise<ReviewFacets>>;
};

function cacheMap() {
  if (!g.__vocFacetCache) g.__vocFacetCache = new Map();
  return g.__vocFacetCache;
}

function inflightMap() {
  if (!g.__vocFacetInflight) g.__vocFacetInflight = new Map();
  return g.__vocFacetInflight;
}

/** 筛选项全局 DISTINCT；评论列表与分析 overview 共用，避免重复 3 次 BQ */
export async function getReviewFacets(
  bq: BigQuery,
  projectId: string,
): Promise<ReviewFacets> {
  const key = `facets:${projectId}`;
  const cache = cacheMap();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FACET_TTL_MS) {
    return hit.value;
  }

  const inflight = inflightMap();
  const pending = inflight.get(key);
  if (pending) return pending;

  const load = (async (): Promise<ReviewFacets> => {
    const table = `\`${projectId}.review_serving.v_review_current\``;
    const [[brandRows], [countryRows], [platformRows]] = await Promise.all([
      bq.query({
        query: `
          SELECT DISTINCT brand_key AS v
          FROM ${table}
          WHERE brand_key IS NOT NULL AND brand_key != ''
          ORDER BY v
        `,
      }),
      bq.query({
        query: `
          SELECT DISTINCT country_code AS v
          FROM ${table}
          WHERE country_code IS NOT NULL AND country_code != ''
          ORDER BY v
        `,
      }),
      bq.query({
        query: `
          SELECT DISTINCT platform AS v
          FROM ${table}
          WHERE platform IS NOT NULL AND platform != ''
          ORDER BY v
        `,
      }),
    ]);
    const value: ReviewFacets = {
      brands: (brandRows as Record<string, unknown>[])
        .map((r) => String(r.v ?? ''))
        .filter(Boolean),
      countries: (countryRows as Record<string, unknown>[])
        .map((r) => String(r.v ?? ''))
        .filter(Boolean),
      platforms: (platformRows as Record<string, unknown>[])
        .map((r) => String(r.v ?? ''))
        .filter(Boolean),
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  })();

  inflight.set(key, load);
  try {
    return await load;
  } finally {
    inflight.delete(key);
  }
}

export function invalidateReviewFacetsCache(projectId?: string) {
  const cache = cacheMap();
  if (projectId) {
    cache.delete(`facets:${projectId}`);
    return;
  }
  cache.clear();
}
