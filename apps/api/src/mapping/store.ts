import { BigQuery } from '@google-cloud/bigquery';
import type {
  ProductMappingItem,
  ProductMappingListResponse,
  ProductMappingSpuGroup,
  UnmappedSkuListResponse,
} from '@voc/shared';
import { MAPPING_RULE_VERSION } from '@voc/shared';
import { bqTimestampString } from '../bqValue.js';
import { env } from '../config.js';

/** dry-run / 进程内当前有效映射：key = brand_key|alias_value */
const memoryMappings = new Map<string, ProductMappingItem & { row: Record<string, unknown> }>();

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function mappingKey(brandKey: string, aliasValue: string) {
  return `${brandKey.toLowerCase()}|${aliasValue}`;
}

function mapItem(r: Record<string, unknown>): ProductMappingItem {
  return {
    brandKey: String(r.brand_key ?? ''),
    internalSpu: (r.internal_spu as string) ?? null,
    internalSku: String(r.internal_sku ?? r.alias_value ?? ''),
    productNameCn: (r.product_name_cn as string) ?? null,
    productNameEn: (r.product_name_en as string) ?? null,
    shadeName: (r.shade_name as string) ?? null,
    mappingGranularity: String(r.mapping_granularity ?? 'sku'),
    mappingStatus: String(r.mapping_status ?? 'confirmed'),
    sourceReference: String(r.source_reference ?? ''),
    validFrom: bqTimestampString(r.valid_from) ?? new Date().toISOString(),
    mappingPublicationId: String(r.mapping_publication_id ?? ''),
  };
}

export function memoryHasMapping(brandKey: string, aliasValue: string): boolean {
  return memoryMappings.has(mappingKey(brandKey, aliasValue));
}

export function memoryUpsertMapping(row: Record<string, unknown>) {
  const brand = String(row.brand_key ?? '');
  const alias = String(row.alias_value ?? row.internal_sku ?? '');
  if (!brand || !alias) return;
  const item = mapItem(row);
  memoryMappings.set(mappingKey(brand, alias), { ...item, row });
}

export function memoryListMappings(): ProductMappingItem[] {
  return [...memoryMappings.values()]
    .map(({ row: _r, ...item }) => item)
    .sort((a, b) => {
      const bk = a.brandKey.localeCompare(b.brandKey);
      return bk !== 0 ? bk : a.internalSku.localeCompare(b.internalSku);
    });
}

/** 同 brand + SPU 合并；无 SPU 时每个 SKU 单独一组 */
export function groupMappingsBySpu(items: ProductMappingItem[]): ProductMappingSpuGroup[] {
  const map = new Map<string, ProductMappingItem[]>();
  for (const item of items) {
    const spu = item.internalSpu?.trim();
    const key = spu
      ? `${item.brandKey.toLowerCase()}|spu:${spu.toLowerCase()}`
      : `${item.brandKey.toLowerCase()}|sku:${item.internalSku.toLowerCase()}`;
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }

  const groups: ProductMappingSpuGroup[] = [];
  for (const skus of map.values()) {
    skus.sort((a, b) => a.internalSku.localeCompare(b.internalSku));
    const first = skus[0]!;
    const gran = [...new Set(skus.map((s) => s.mappingGranularity).filter(Boolean))];
    groups.push({
      brandKey: first.brandKey,
      internalSpu: first.internalSpu?.trim() || null,
      mappingGranularity: gran.length === 1 ? gran[0]! : gran[0] || 'sku',
      skus,
    });
  }

  groups.sort((a, b) => {
    const bk = a.brandKey.localeCompare(b.brandKey);
    if (bk !== 0) return bk;
    const sa = a.internalSpu || a.skus[0]?.internalSku || '';
    const sb = b.internalSpu || b.skus[0]?.internalSku || '';
    return sa.localeCompare(sb);
  });
  return groups;
}

function paginateSpuGroups(
  items: ProductMappingItem[],
  opts: { offset: number; limit: number; page: number; pageSize: number; brands: string[] },
): ProductMappingListResponse {
  const groups = groupMappingsBySpu(items);
  return {
    items: groups.slice(opts.offset, opts.offset + opts.limit),
    total: groups.length,
    page: opts.page,
    pageSize: opts.pageSize,
    brands: opts.brands,
  };
}

/** 评论匹配：按 brand_key + platform_sku(=alias_value) 查当前有效 confirmed */
export interface MappingLookupHit {
  brandKey: string;
  internalSpu: string | null;
  internalSku: string | null;
  productNameCn: string | null;
  productNameEn: string | null;
  shadeName: string | null;
  mappingGranularity: string;
  mappingVersionId: string;
  mappingPublicationId: string;
  mappingRuleVersion: string;
  productMappingStatus: 'confirmed' | 'conflict' | 'pending';
}

export async function lookupMappings(
  pairs: Array<{ brandKey: string; platformSku: string }>,
): Promise<Map<string, MappingLookupHit>> {
  const result = new Map<string, MappingLookupHit>();
  const unique = new Map<string, { brandKey: string; platformSku: string }>();
  for (const p of pairs) {
    const bk = (p.brandKey || '').toLowerCase();
    const sku = (p.platformSku || '').trim();
    if (!bk || !sku) continue;
    unique.set(mappingKey(bk, sku), { brandKey: bk, platformSku: sku });
  }
  if (unique.size === 0) return result;

  // 先填内存（dry-run 或本进程刚写入）
  for (const [key, p] of unique) {
    const mem = memoryMappings.get(key);
    if (mem) {
      result.set(key, {
        brandKey: mem.brandKey,
        internalSpu: mem.internalSpu,
        internalSku: mem.internalSku,
        productNameCn: mem.productNameCn,
        productNameEn: mem.productNameEn,
        shadeName: mem.shadeName,
        mappingGranularity: mem.mappingGranularity,
        mappingVersionId: String(mem.row.mapping_version_id ?? ''),
        mappingPublicationId: mem.mappingPublicationId,
        mappingRuleVersion: MAPPING_RULE_VERSION,
        productMappingStatus: 'confirmed',
      });
    }
  }

  if (env.importDryRun) return result;

  const missing = [...unique.values()].filter(
    (p) => !result.has(mappingKey(p.brandKey, p.platformSku)),
  );
  if (missing.length === 0) return result;

  const project = env.gcpProjectId;
  const brands = [...new Set(missing.map((m) => m.brandKey))];
  const skus = [...new Set(missing.map((m) => m.platformSku))];

  try {
    const [rows] = await getBq().query({
      query: `
        WITH ranked AS (
          SELECT
            brand_key,
            alias_value,
            internal_spu,
            internal_sku,
            product_name_cn,
            product_name_en,
            shade_name,
            mapping_granularity,
            mapping_version_id,
            mapping_publication_id,
            mapping_rule_version,
            mapping_status,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(brand_key), alias_value
              ORDER BY valid_from DESC
            ) AS rn
          FROM \`${project}.review_core.dim_product_mapping\`
          WHERE mapping_rule_version = @ruleVersion
            AND mapping_status = 'confirmed'
            AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
            AND LOWER(brand_key) IN UNNEST(@brands)
            AND alias_value IN UNNEST(@skus)
            AND platform = '*'
            AND alias_type = 'seller_sku'
        )
        SELECT * FROM ranked WHERE rn = 1
      `,
      params: {
        ruleVersion: MAPPING_RULE_VERSION,
        brands,
        skus,
      },
    });

    for (const r of rows as Record<string, unknown>[]) {
      const brandKey = String(r.brand_key ?? '').toLowerCase();
      const aliasValue = String(r.alias_value ?? '');
      const key = mappingKey(brandKey, aliasValue);
      // 仅接受请求里出现的 pair
      if (!unique.has(key)) continue;
      result.set(key, {
        brandKey,
        internalSpu: (r.internal_spu as string) ?? null,
        internalSku: (r.internal_sku as string) ?? aliasValue,
        productNameCn: (r.product_name_cn as string) ?? null,
        productNameEn: (r.product_name_en as string) ?? null,
        shadeName: (r.shade_name as string) ?? null,
        mappingGranularity: String(r.mapping_granularity ?? 'sku'),
        mappingVersionId: String(r.mapping_version_id ?? ''),
        mappingPublicationId: String(r.mapping_publication_id ?? ''),
        mappingRuleVersion: String(r.mapping_rule_version ?? MAPPING_RULE_VERSION),
        productMappingStatus: 'confirmed',
      });
      memoryUpsertMapping(r);
    }
  } catch (e) {
    console.warn(
      '[mapping] lookup failed',
      e instanceof Error ? e.message : e,
    );
  }

  return result;
}

export function lookupKey(brandKey: string, platformSku: string) {
  return mappingKey(brandKey, platformSku);
}

/** 关闭旧有效行的 valid_to，再插入新行 */
export async function invalidateAndInsertMappings(
  keys: Array<{ brandKey: string; internalSku: string }>,
  newRows: Record<string, unknown>[],
  validToIso: string,
): Promise<void> {
  for (const row of newRows) {
    memoryUpsertMapping(row);
  }

  if (env.importDryRun) return;

  const project = env.gcpProjectId;
  const bqClient = getBq();

  if (keys.length > 0) {
    try {
      const pairKeys = keys.map((k) => mappingKey(k.brandKey, k.internalSku));
      await bqClient.query({
        query: `
          UPDATE \`${project}.review_core.dim_product_mapping\`
          SET valid_to = TIMESTAMP(@validTo)
          WHERE mapping_rule_version = @ruleVersion
            AND mapping_status = 'confirmed'
            AND valid_to IS NULL
            AND platform = '*'
            AND alias_type = 'seller_sku'
            AND CONCAT(LOWER(brand_key), '|', alias_value) IN UNNEST(@pairKeys)
        `,
        params: {
          validTo: validToIso,
          ruleVersion: MAPPING_RULE_VERSION,
          pairKeys,
        },
      });
    } catch (e) {
      console.warn(
        '[mapping] invalidate old rows skipped (streaming buffer or DML)',
        e instanceof Error ? e.message : e,
      );
    }
  }

  const chunk = 200;
  for (let i = 0; i < newRows.length; i += chunk) {
    try {
      await bqClient
        .dataset('review_core')
        .table('dim_product_mapping')
        .insert(newRows.slice(i, i + chunk), { ignoreUnknownValues: true });
    } catch (e) {
      const anyErr = e as {
        message?: string;
        errors?: Array<{ errors?: Array<{ message?: string; reason?: string }> }>;
      };
      const sample = anyErr.errors?.[0]?.errors?.[0];
      const detail = sample
        ? `${sample.reason || 'error'}: ${sample.message || ''}`
        : anyErr.message || String(e);
      throw Object.assign(new Error(`BigQuery insert dim_product_mapping failed — ${detail}`), {
        cause: e,
      });
    }
  }
}

export async function listCurrentMappings(opts: {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  brand?: string;
  q?: string;
} = {}): Promise<ProductMappingListResponse> {
  const limit = Math.min(2000, Math.max(1, opts.limit ?? opts.pageSize ?? 500));
  const offset = Math.max(0, opts.offset ?? 0);
  const page = opts.page ?? Math.floor(offset / limit) + 1;
  const pageSize = opts.pageSize ?? limit;
  const brand = (opts.brand ?? '').trim().toLowerCase();
  const q = (opts.q ?? '').trim().toLowerCase();

  const filterMem = (items: ProductMappingItem[]) => {
    let next = items;
    if (brand) next = next.filter((i) => i.brandKey.toLowerCase() === brand);
    if (q) {
      next = next.filter((i) => {
        const hay = [i.internalSpu, i.internalSku, i.productNameCn, i.productNameEn]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return next;
  };

  if (env.importDryRun) {
    const all = memoryListMappings();
    const brands = [...new Set(all.map((i) => i.brandKey).filter(Boolean))].sort();
    return paginateSpuGroups(filterMem(all), { offset, limit, page, pageSize, brands });
  }

  const project = env.gcpProjectId;
  try {
    const [brandRows] = await getBq().query({
      query: `
        SELECT DISTINCT brand_key
        FROM \`${project}.review_core.dim_product_mapping\`
        WHERE mapping_rule_version = @ruleVersion
          AND mapping_status = 'confirmed'
          AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
          AND platform = '*'
          AND alias_type = 'seller_sku'
          AND brand_key IS NOT NULL
          AND brand_key != ''
        ORDER BY brand_key
      `,
      params: { ruleVersion: MAPPING_RULE_VERSION },
    });
    const brands = (brandRows as Record<string, unknown>[])
      .map((r) => String(r.brand_key ?? ''))
      .filter(Boolean);

    // 先取全部命中 SKU，再按 SPU 合并后分页（主数据量级通常 < 数千）
    const [rows] = await getBq().query({
      query: `
        WITH ranked AS (
          SELECT
            brand_key,
            internal_spu,
            internal_sku,
            product_name_cn,
            product_name_en,
            shade_name,
            mapping_granularity,
            mapping_status,
            source_reference,
            valid_from,
            mapping_publication_id,
            alias_value,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(brand_key), alias_value
              ORDER BY valid_from DESC
            ) AS rn
          FROM \`${project}.review_core.dim_product_mapping\`
          WHERE mapping_rule_version = @ruleVersion
            AND mapping_status = 'confirmed'
            AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
            AND platform = '*'
            AND alias_type = 'seller_sku'
        )
        SELECT * EXCEPT(rn)
        FROM ranked
        WHERE rn = 1
          AND (@brand = '' OR LOWER(brand_key) = @brand)
          AND (
            @q = ''
            OR STRPOS(LOWER(IFNULL(internal_spu, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(internal_sku, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(alias_value, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(product_name_cn, '')), @q) > 0
            OR STRPOS(LOWER(IFNULL(product_name_en, '')), @q) > 0
          )
        ORDER BY brand_key, internal_sku
        LIMIT 5000
      `,
      params: { ruleVersion: MAPPING_RULE_VERSION, brand, q },
    });

    const byKey = new Map(
      (rows as Record<string, unknown>[]).map((r) => {
        const item = mapItem(r);
        return [mappingKey(item.brandKey, item.internalSku), item] as const;
      }),
    );
    for (const mem of filterMem(memoryListMappings())) {
      byKey.set(mappingKey(mem.brandKey, mem.internalSku), mem);
    }

    return paginateSpuGroups([...byKey.values()], { offset, limit, page, pageSize, brands });
  } catch (e) {
    console.warn('[mapping] list failed, falling back to memory', e instanceof Error ? e.message : e);
    const all = memoryListMappings();
    const brands = [...new Set(all.map((i) => i.brandKey).filter(Boolean))].sort();
    return paginateSpuGroups(filterMem(all), { offset, limit, page, pageSize, brands });
  }
}

export async function listUnmappedSkus(opts: {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  brand?: string;
  q?: string;
  status?: string;
} = {}): Promise<UnmappedSkuListResponse> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? opts.pageSize ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);
  const page = opts.page ?? Math.floor(offset / limit) + 1;
  const pageSize = opts.pageSize ?? limit;
  const brand = (opts.brand ?? '').trim().toLowerCase();
  const q = (opts.q ?? '').trim().toLowerCase();
  const status = (opts.status ?? '').trim().toLowerCase();

  if (env.importDryRun) {
    // dry-run 无历史 fact；返回空（评论导入结果页仍有批次级 unmapped 计数）
    return { items: [], total: 0, page, pageSize };
  }

  const project = env.gcpProjectId;
  try {
    const [countRows] = await getBq().query({
      query: `
        WITH agg AS (
          SELECT
            LOWER(IFNULL(brand_key, '')) AS brand_key,
            platform_sku,
            CASE
              WHEN COUNTIF(product_mapping_status = 'conflict') > 0 THEN 'conflict'
              ELSE 'pending'
            END AS status,
            COUNT(1) AS review_count
          FROM \`${project}.review_core.fact_review\`
          WHERE review_scope = 'product'
            AND platform_sku IS NOT NULL
            AND platform_sku != ''
            AND product_mapping_status IN ('pending', 'conflict')
          GROUP BY 1, 2
        )
        SELECT COUNT(1) AS total
        FROM agg
        WHERE (@brand = '' OR brand_key = @brand)
          AND (@q = '' OR STRPOS(LOWER(platform_sku), @q) > 0)
          AND (@status = '' OR status = @status)
      `,
      params: { brand, q, status },
    });
    const total = Number((countRows as Record<string, unknown>[])[0]?.total ?? 0);

    const [rows] = await getBq().query({
      query: `
        WITH agg AS (
          SELECT
            LOWER(IFNULL(brand_key, '')) AS brand_key,
            platform_sku,
            CASE
              WHEN COUNTIF(product_mapping_status = 'conflict') > 0 THEN 'conflict'
              ELSE 'pending'
            END AS status,
            COUNT(1) AS review_count
          FROM \`${project}.review_core.fact_review\`
          WHERE review_scope = 'product'
            AND platform_sku IS NOT NULL
            AND platform_sku != ''
            AND product_mapping_status IN ('pending', 'conflict')
          GROUP BY 1, 2
        )
        SELECT *
        FROM agg
        WHERE (@brand = '' OR brand_key = @brand)
          AND (@q = '' OR STRPOS(LOWER(platform_sku), @q) > 0)
          AND (@status = '' OR status = @status)
        ORDER BY review_count DESC, brand_key, platform_sku
        LIMIT @limit OFFSET @offset
      `,
      params: { brand, q, status, limit, offset },
    });
    const items = (rows as Record<string, unknown>[]).map((r) => ({
      brandKey: String(r.brand_key ?? ''),
      platformSku: String(r.platform_sku ?? ''),
      status: (r.status === 'conflict' ? 'conflict' : 'pending') as 'pending' | 'conflict',
      reviewCount: Number(r.review_count ?? 0),
    }));
    return { items, total, page, pageSize };
  } catch (e) {
    console.warn('[mapping] unmapped list failed', e instanceof Error ? e.message : e);
    return { items: [], total: 0, page, pageSize };
  }
}

/** 判断哪些 keys 在当前有效集中已存在（用于新增/覆盖计数） */
export async function findExistingMappingKeys(
  keys: Array<{ brandKey: string; internalSku: string }>,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const k of keys) {
    if (memoryHasMapping(k.brandKey, k.internalSku)) {
      found.add(mappingKey(k.brandKey, k.internalSku));
    }
  }
  if (env.importDryRun) return found;

  const missing = keys.filter((k) => !found.has(mappingKey(k.brandKey, k.internalSku)));
  if (missing.length === 0) return found;

  const project = env.gcpProjectId;
  const brands = [...new Set(missing.map((m) => m.brandKey.toLowerCase()))];
  const skus = [...new Set(missing.map((m) => m.internalSku))];
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT DISTINCT LOWER(brand_key) AS brand_key, alias_value
        FROM \`${project}.review_core.dim_product_mapping\`
        WHERE mapping_rule_version = @ruleVersion
          AND mapping_status = 'confirmed'
          AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
          AND platform = '*'
          AND alias_type = 'seller_sku'
          AND LOWER(brand_key) IN UNNEST(@brands)
          AND alias_value IN UNNEST(@skus)
      `,
      params: { ruleVersion: MAPPING_RULE_VERSION, brands, skus },
    });
    for (const r of rows as Record<string, unknown>[]) {
      found.add(mappingKey(String(r.brand_key), String(r.alias_value)));
    }
  } catch (e) {
    console.warn('[mapping] findExisting failed', e instanceof Error ? e.message : e);
  }
  return found;
}
