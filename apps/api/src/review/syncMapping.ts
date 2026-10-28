import type { SyncMappingResult } from '@voc/shared';
import { MAPPING_RULE_VERSION } from '@voc/shared';
import { env } from '../config.js';
import {
  memoryListFactReviews,
  memoryPatchFactReview,
} from '../import/store.js';
import { lookupKey, lookupMappings } from '../mapping/store.js';
import { BigQuery } from '@google-cloud/bigquery';

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function isUnmappedCandidate(row: Record<string, unknown>): boolean {
  const sku = String(row.platform_sku ?? '').trim();
  if (!sku) return false;
  const status = String(row.product_mapping_status ?? 'pending');
  return status !== 'confirmed';
}

async function syncMemory(): Promise<SyncMappingResult> {
  const all = memoryListFactReviews();
  const candidatesRows = all.filter(isUnmappedCandidate);
  const pairs = candidatesRows
    .map((r) => ({
      brandKey: String(r.brand_key ?? ''),
      platformSku: String(r.platform_sku ?? '').trim(),
    }))
    .filter((p) => p.brandKey && p.platformSku);

  const hits = await lookupMappings(pairs);
  let matchable = 0;
  let synced = 0;
  const now = new Date().toISOString();

  for (const row of candidatesRows) {
    const brandKey = String(row.brand_key ?? '');
    const platformSku = String(row.platform_sku ?? '').trim();
    const hit = hits.get(lookupKey(brandKey, platformSku));
    if (!hit || hit.productMappingStatus !== 'confirmed') continue;
    matchable += 1;
    const reviewId = String(row.review_id ?? '');
    if (!reviewId) continue;
    const granularity =
      hit.mappingGranularity === 'spu'
        ? 'spu'
        : hit.mappingGranularity === 'sku'
          ? 'sku'
          : 'variant';
    memoryPatchFactReview(reviewId, {
      product_mapping_status: 'confirmed',
      brand_key: hit.brandKey,
      internal_spu: hit.internalSpu,
      internal_sku: hit.internalSku,
      product_name_cn: hit.productNameCn,
      product_name_en: hit.productNameEn,
      mapping_version_id: hit.mappingVersionId || null,
      mapping_publication_id: hit.mappingPublicationId || null,
      mapping_rule_version: hit.mappingRuleVersion || null,
      mapping_updated_at: now,
      product_granularity: granularity,
    });
    synced += 1;
  }

  const stillUnmapped = memoryListFactReviews().filter(isUnmappedCandidate).length;
  return {
    candidates: candidatesRows.length,
    matchable,
    synced,
    stillUnmapped,
    dryRun: true,
  };
}

/**
 * 将有 platform_sku 且未 confirmed 的评论，按当前有效主数据回写映射投影。
 * 匹配键与导入一致：brand_key + platform_sku = 主数据 brand_key + alias_value(internal_sku)。
 */
export async function syncPendingReviewMappings(): Promise<SyncMappingResult> {
  if (env.importDryRun) return syncMemory();

  const project = env.gcpProjectId;
  const mapCte = `
    SELECT * EXCEPT(rn)
    FROM (
      SELECT
        LOWER(brand_key) AS brand_key_norm,
        brand_key,
        alias_value,
        internal_spu,
        internal_sku,
        product_name_cn,
        product_name_en,
        mapping_granularity,
        mapping_version_id,
        mapping_publication_id,
        mapping_rule_version,
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
    WHERE rn = 1
  `;

  try {
    const [beforeRows] = await getBq().query({
      query: `
        WITH map AS (${mapCte}),
        pending AS (
          SELECT
            review_id,
            LOWER(IFNULL(brand_key, '')) AS brand_key_norm,
            platform_sku
          FROM \`${project}.review_core.fact_review\`
          WHERE platform_sku IS NOT NULL
            AND platform_sku != ''
            AND IFNULL(product_mapping_status, 'pending') != 'confirmed'
        )
        SELECT
          (SELECT COUNT(1) FROM pending) AS candidates,
          (
            SELECT COUNT(1)
            FROM pending p
            INNER JOIN map m
              ON p.brand_key_norm = m.brand_key_norm
             AND p.platform_sku = m.alias_value
          ) AS matchable
      `,
      params: { ruleVersion: MAPPING_RULE_VERSION },
    });
    const before = (beforeRows as Record<string, unknown>[])[0] ?? {};
    const candidates = Number(before.candidates ?? 0);
    const matchable = Number(before.matchable ?? 0);

    const [job] = await getBq().createQueryJob({
      query: `
        UPDATE \`${project}.review_core.fact_review\` AS T
        SET
          product_mapping_status = 'confirmed',
          brand_key = S.brand_key,
          internal_spu = S.internal_spu,
          internal_sku = S.internal_sku,
          product_name_cn = S.product_name_cn,
          product_name_en = S.product_name_en,
          mapping_version_id = S.mapping_version_id,
          mapping_publication_id = S.mapping_publication_id,
          mapping_rule_version = S.mapping_rule_version,
          mapping_updated_at = CURRENT_TIMESTAMP(),
          product_granularity = CASE
            WHEN S.mapping_granularity = 'spu' THEN 'spu'
            WHEN S.mapping_granularity = 'sku' THEN 'sku'
            ELSE 'variant'
          END
        FROM (${mapCte}) AS S
        WHERE LOWER(IFNULL(T.brand_key, '')) = S.brand_key_norm
          AND T.platform_sku = S.alias_value
          AND T.platform_sku IS NOT NULL
          AND T.platform_sku != ''
          AND IFNULL(T.product_mapping_status, 'pending') != 'confirmed'
      `,
      params: { ruleVersion: MAPPING_RULE_VERSION },
    });
    // 必须等 DML 完成，否则 numDmlAffectedRows 常为 0
    await job.getQueryResults();
    const [jobMeta] = await job.getMetadata();
    let synced = Number(
      jobMeta?.statistics?.query?.numDmlAffectedRows ??
        jobMeta?.statistics?.numDmlAffectedRows ??
        0,
    );

    await syncMemory();

    const [afterRows] = await getBq().query({
      query: `
        SELECT COUNT(1) AS total
        FROM \`${project}.review_core.fact_review\`
        WHERE platform_sku IS NOT NULL
          AND platform_sku != ''
          AND IFNULL(product_mapping_status, 'pending') != 'confirmed'
      `,
    });
    const stillUnmapped = Number((afterRows as Record<string, unknown>[])[0]?.total ?? 0);
    if (!Number.isFinite(synced) || synced < 0) synced = 0;
    // 若驱动未返回 DML 行数，用前后差兜底
    if (synced === 0 && matchable > 0 && stillUnmapped < candidates) {
      synced = candidates - stillUnmapped;
    }

    return {
      candidates,
      matchable,
      synced,
      stillUnmapped,
      dryRun: false,
    };
  } catch (e) {
    console.warn(
      '[review] sync mapping BQ failed, falling back to memory',
      e instanceof Error ? e.message : e,
    );
    const mem = await syncMemory();
    return {
      ...mem,
      dryRun: env.importDryRun,
    };
  }
}
