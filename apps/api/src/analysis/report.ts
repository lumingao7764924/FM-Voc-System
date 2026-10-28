import { BigQuery } from '@google-cloud/bigquery';
import type {
  AnalysisBrandReportSection,
  AnalysisCauseItem,
  AnalysisCauseRow,
  AnalysisPlatformStat,
  AnalysisProductConclusionRow,
  AnalysisReportDetailRow,
  AnalysisReportResponse,
  AnalysisPlatformTopProducts,
  AnalysisTopProductRow,
  IssueTaxonomyItem,
} from '@voc/shared';
import { env } from '../config.js';
import { formatReviewDisplayTime } from '../bqValue.js';
import { memoryListFactReviews } from '../import/store.js';
import { listTaxonomy } from '../taxonomy/store.js';
import {
  collectMemoryIssuesForBatch,
  loadBatchDetail,
  memoryListRunsByBatch,
  type MemIssue,
} from './store.js';

type ReviewMeta = {
  reviewId: string;
  reviewDateLocal: string | null;
  brandKey: string | null;
  platform: string | null;
  platformSku: string | null;
  platformProductName: string | null;
  internalSpu: string | null;
  internalSku: string | null;
  productNameCn: string | null;
  productNameEn: string | null;
  rating: number | null;
  reviewText: string | null;
};

type Enriched = ReviewMeta & {
  noTarget: boolean;
  productKey: string;
  productLabel: string;
  sku: string | null;
  major: string;
  minor: string;
  evidenceQuote: string | null;
};

const OTHER_MAJOR = '其他问题';
const OTHER_MINOR = '无理由';
const UNATTR_MAJOR = '无法归因';
const UNATTR_MINOR = '无产品无SKU';
const PREFERRED_PLATFORMS = ['Amazon', 'Shopify', 'TikTok'];
const BRAND_ORDER = ['skt', 'tp'];

const BRAND_LABELS: Record<string, string> = {
  skt: 'Skintific（SKT）',
  tp: 'TimePhoria（TP）',
  skintific: 'Skintific（SKT）',
  timephoria: 'TimePhoria（TP）',
};

function getBq(): BigQuery {
  return new BigQuery({ projectId: env.gcpProjectId });
}

function isBlankText(text: string | null): boolean {
  return !text || text.trim().length < 2;
}

function normalizeBrandKey(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '__unknown__';
  const lower = s.toLowerCase();
  if (lower === 'skt' || lower.includes('skintific')) return 'skt';
  if (lower === 'tp' || lower.includes('timephoria') || lower.includes('time phoria')) {
    return 'tp';
  }
  return lower;
}

function brandLabel(brandKey: string): string {
  if (brandKey === '__unknown__') return '未标注品牌';
  return BRAND_LABELS[brandKey] ?? brandKey.toUpperCase();
}

function normalizePlatform(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Other';
  const lower = s.toLowerCase().replace(/\s+/g, '');
  if (lower.includes('amazon') || lower === 'amz') return 'Amazon';
  if (lower.includes('shopify') || lower === 'shop') return 'Shopify';
  if (lower.includes('tiktok') || lower === 'tt' || lower === 'tts') return 'TikTok';
  if (lower.includes('shopee')) return 'Shopee';
  if (lower.includes('lazada')) return 'Lazada';
  // Title-case first letter
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sortPlatforms(plats: string[]): string[] {
  const uniq = [...new Set(plats)];
  const head = PREFERRED_PLATFORMS.filter((p) => uniq.includes(p));
  const tail = uniq
    .filter((p) => !PREFERRED_PLATFORMS.includes(p))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return [...head, ...tail];
}

function sortBrandKeys(keys: string[]): string[] {
  const set = new Set(keys);
  const head = BRAND_ORDER.filter((k) => set.has(k));
  const tail = [...set]
    .filter((k) => !BRAND_ORDER.includes(k))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return [...head, ...tail];
}

function resolveProduct(r: ReviewMeta): {
  noTarget: boolean;
  productKey: string;
  productLabel: string;
  sku: string | null;
} {
  const sku = (r.internalSku || r.platformSku || '').trim() || null;
  const name = (
    r.productNameCn ||
    r.platformProductName ||
    r.productNameEn ||
    r.internalSpu ||
    ''
  ).trim();
  const noTarget = !name && !sku;
  if (noTarget) {
    return {
      noTarget: true,
      productKey: '__unattributable__',
      productLabel: UNATTR_MAJOR,
      sku: null,
    };
  }
  const productKey = (r.internalSpu || name || sku || r.reviewId).trim();
  const productLabel = name || sku || productKey;
  return { noTarget: false, productKey, productLabel, sku };
}

function taxonomyName(
  id: string | null | undefined,
  byId: Map<string, IssueTaxonomyItem>,
): string | null {
  if (!id) return null;
  return byId.get(id)?.issueNameCn ?? id;
}

function primaryCause(
  issues: MemIssue[],
  byId: Map<string, IssueTaxonomyItem>,
  noTarget: boolean,
  blankText: boolean,
): { major: string; minor: string; evidenceQuote: string | null } {
  if (noTarget) return { major: UNATTR_MAJOR, minor: UNATTR_MINOR, evidenceQuote: null };
  if (!issues.length) {
    return {
      major: OTHER_MAJOR,
      minor: blankText ? OTHER_MINOR : '未命中分类',
      evidenceQuote: null,
    };
  }
  const first = issues[0]!;
  const l2 = taxonomyName(first.issue_l2_id, byId);
  const l1 = taxonomyName(first.issue_l1_id, byId) || OTHER_MAJOR;
  return {
    major: l1,
    minor: l2 || OTHER_MINOR,
    evidenceQuote: first.evidence_quote_original
      ? String(first.evidence_quote_original)
      : null,
  };
}

function makeSuggestions(causeItems: AnalysisCauseItem[]): string[] {
  const minors = causeItems
    .slice(0, 5)
    .map((c) => c.minor)
    .join(' ');
  const tips: string[] = [];
  if (/功能组件失效/.test(minors)) {
    tips.push('疑似旋钮/泵头等功能件异常，建议品控复核并排查批次');
  }
  if (/安全性|过敏/.test(minors)) {
    tips.push('存在刺激/爆痘反馈，建议详情页补充敏感肌局部测敏提示');
  }
  if (/功效|妆效落差|与宣传不符/.test(minors)) {
    tips.push('宣传/短视频预期偏高，建议收敛功效话术并补充真实效果边界');
  }
  if (/认知|预期落差/.test(minors)) {
    tips.push('加强色号试色、对比图与选色指引，降低色差预期落差');
  }
  if (/错漏发|交付异常/.test(minors)) {
    tips.push('排查仓配错漏发/未收到，缩短售后响应');
  }
  if (/感官|肤感/.test(minors)) {
    tips.push('针对厚重/卡粉/干燥等肤感反馈，优化卖点描述与适用肤质说明');
  }
  if (/物理破损|密封缺陷/.test(minors)) {
    tips.push('加强包材防护与运输填充，降低到货破损');
  }
  if (!tips.length) {
    tips.push('持续跟踪差评归因变化，对高差评 SKU 优先复盘详情页与投放素材');
  }
  return tips.slice(0, 4);
}

async function loadReviewMetas(reviewIds: string[]): Promise<Map<string, ReviewMeta>> {
  const out = new Map<string, ReviewMeta>();
  if (!reviewIds.length) return out;

  if (env.importDryRun) {
    for (const r of memoryListFactReviews()) {
      const id = String(r.review_id ?? '');
      if (!reviewIds.includes(id)) continue;
      const ratingRaw = r.rating_normalized_5 ?? r.rating_numeric;
      out.set(id, {
        reviewId: id,
        reviewDateLocal: formatReviewDisplayTime({
          dateLocal: r.review_date_local,
          createdAtLocal: r.review_created_at_local,
        }),
        brandKey: r.brand_key != null ? String(r.brand_key) : null,
        platform: r.platform != null ? String(r.platform) : null,
        platformSku: r.platform_sku != null ? String(r.platform_sku) : null,
        platformProductName:
          r.platform_product_name != null ? String(r.platform_product_name) : null,
        internalSpu: r.internal_spu != null ? String(r.internal_spu) : null,
        internalSku: r.internal_sku != null ? String(r.internal_sku) : null,
        productNameCn: r.product_name_cn != null ? String(r.product_name_cn) : null,
        productNameEn: r.product_name_en != null ? String(r.product_name_en) : null,
        rating: ratingRaw == null || ratingRaw === '' ? null : Number(ratingRaw),
        reviewText: r.review_text_original != null ? String(r.review_text_original) : null,
      });
    }
    return out;
  }

  const [rows] = await getBq().query({
    query: `
      SELECT
        review_id,
        review_date_local,
        review_created_at_local,
        brand_key,
        platform,
        platform_sku,
        platform_product_name,
        internal_spu,
        internal_sku,
        product_name_cn,
        product_name_en,
        rating_normalized_5,
        rating_numeric,
        review_text_original
      FROM \`${env.gcpProjectId}.review_serving.v_review_current\`
      WHERE review_id IN UNNEST(@ids)
    `,
    params: { ids: reviewIds },
    types: { ids: ['STRING'] },
  });
  for (const r of rows as Record<string, unknown>[]) {
    const id = String(r.review_id ?? '');
    const ratingRaw = r.rating_normalized_5 ?? r.rating_numeric;
    out.set(id, {
      reviewId: id,
      reviewDateLocal: formatReviewDisplayTime({
        dateLocal: r.review_date_local,
        createdAtLocal: r.review_created_at_local,
      }),
      brandKey: r.brand_key != null ? String(r.brand_key) : null,
      platform: r.platform != null ? String(r.platform) : null,
      platformSku: r.platform_sku != null ? String(r.platform_sku) : null,
      platformProductName:
        r.platform_product_name != null ? String(r.platform_product_name) : null,
      internalSpu: r.internal_spu != null ? String(r.internal_spu) : null,
      internalSku: r.internal_sku != null ? String(r.internal_sku) : null,
      productNameCn: r.product_name_cn != null ? String(r.product_name_cn) : null,
      productNameEn: r.product_name_en != null ? String(r.product_name_en) : null,
      rating: ratingRaw == null || ratingRaw === '' ? null : Number(ratingRaw),
      reviewText: r.review_text_original != null ? String(r.review_text_original) : null,
    });
  }
  return out;
}

async function loadIssuesByReview(batchId: string): Promise<Map<string, MemIssue[]>> {
  const map = new Map<string, MemIssue[]>();
  for (const issue of collectMemoryIssuesForBatch(batchId)) {
    const rid = String(issue.review_id ?? '');
    if (!rid) continue;
    const list = map.get(rid) ?? [];
    list.push(issue);
    map.set(rid, list);
  }

  if (env.importDryRun) return map;

  try {
    const [rows] = await getBq().query({
      query: `
        SELECT i.*
        FROM \`${env.gcpProjectId}.review_semantic.fact_review_issue\` i
        INNER JOIN \`${env.gcpProjectId}.review_semantic.analysis_run\` r
          ON r.analysis_run_id = i.analysis_run_id
        WHERE r.batch_id = @batchId
      `,
      params: { batchId },
    });
    for (const r of rows as Record<string, unknown>[]) {
      const rid = String(r.review_id ?? '');
      if (!rid) continue;
      const issue: MemIssue = {
        review_issue_id: String(r.review_issue_id ?? ''),
        review_id: rid,
        analysis_run_id: String(r.analysis_run_id ?? ''),
        issue_l1_id: String(r.issue_l1_id ?? ''),
        issue_l2_id: r.issue_l2_id != null ? String(r.issue_l2_id) : null,
        issue_l3_id: r.issue_l3_id != null ? String(r.issue_l3_id) : null,
        evidence_quote_original: String(r.evidence_quote_original ?? ''),
      };
      const list = map.get(rid) ?? [];
      if (!list.some((x) => x.review_issue_id === issue.review_issue_id)) {
        list.push(issue);
        map.set(rid, list);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/Not found: Table|not found/i.test(msg)) throw e;
  }
  return map;
}

function buildPlatformStats(rows: Enriched[]): AnalysisPlatformStat[] {
  const total = rows.length || 1;
  const byPlat = new Map<string, number>();
  for (const r of rows) {
    const p = normalizePlatform(r.platform);
    byPlat.set(p, (byPlat.get(p) ?? 0) + 1);
  }
  return sortPlatforms([...byPlat.keys()]).map((platform) => {
    const count = byPlat.get(platform) ?? 0;
    return { platform, count, share: count / total };
  });
}

function buildCauseRows(rows: Enriched[]): AnalysisCauseRow[] {
  const total = rows.length || 1;
  const byMaj = new Map<string, number>();
  const byPair = new Map<string, { major: string; minor: string; n: number }>();
  for (const r of rows) {
    byMaj.set(r.major, (byMaj.get(r.major) ?? 0) + 1);
    const pk = `${r.major}\0${r.minor}`;
    const cur = byPair.get(pk) ?? { major: r.major, minor: r.minor, n: 0 };
    cur.n += 1;
    byPair.set(pk, cur);
  }
  const majors = [...byMaj.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([m]) => m)
    .filter((m) => m !== UNATTR_MAJOR);
  if (byMaj.has(UNATTR_MAJOR)) majors.push(UNATTR_MAJOR);

  const out: AnalysisCauseRow[] = [];
  for (const major of majors) {
    const majorCount = byMaj.get(major) ?? 0;
    const minors = [...byPair.values()]
      .filter((p) => p.major === major)
      .sort((a, b) => b.n - a.n || a.minor.localeCompare(b.minor, 'zh'));
    minors.forEach((m, idx) => {
      out.push({
        major,
        majorCount,
        majorShare: majorCount / total,
        minor: m.minor,
        minorCount: m.n,
        minorShare: m.n / total,
        isFirstOfMajor: idx === 0,
        majorRowSpan: minors.length,
      });
    });
  }
  return out;
}

function buildTopProducts(rows: Enriched[], limit = 10): AnalysisTopProductRow[] {
  const attributed = rows.filter((r) => !r.noTarget);
  const map = new Map<string, { productLabel: string; brandKey: string | null; n: number }>();
  for (const r of attributed) {
    const cur = map.get(r.productKey) ?? {
      productLabel: r.productLabel,
      brandKey: r.brandKey,
      n: 0,
    };
    cur.n += 1;
    map.set(r.productKey, cur);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].productLabel.localeCompare(b[1].productLabel, 'zh'))
    .slice(0, limit)
    .map(([productKey, v], i) => ({
      rank: i + 1,
      productKey,
      productLabel: v.productLabel,
      brandKey: v.brandKey,
      reviewCount: v.n,
    }));
}

function buildTopProductsByPlatform(
  rows: Enriched[],
  limit = 10,
): AnalysisPlatformTopProducts[] {
  const byPlat = new Map<string, Enriched[]>();
  for (const r of rows) {
    const p = normalizePlatform(r.platform);
    const list = byPlat.get(p) ?? [];
    list.push(r);
    byPlat.set(p, list);
  }
  return sortPlatforms([...byPlat.keys()]).map((platform) => {
    const list = byPlat.get(platform) ?? [];
    return {
      platform,
      reviewCount: list.length,
      products: buildTopProducts(list, limit),
    };
  });
}

function buildConclusions(
  rows: Enriched[],
  brandTotal: number,
): AnalysisProductConclusionRow[] {
  const attributed = rows.filter((r) => !r.noTarget);
  const byProduct = new Map<string, Enriched[]>();
  for (const r of attributed) {
    const list = byProduct.get(r.productKey) ?? [];
    list.push(r);
    byProduct.set(r.productKey, list);
  }
  const denom = brandTotal || 1;
  const out: AnalysisProductConclusionRow[] = [];
  for (const [productKey, list] of byProduct) {
    const skuMap = new Map<string, number>();
    const causeMap = new Map<string, { major: string; minor: string; n: number }>();
    const platMap = new Map<string, number>();
    for (const r of list) {
      const sku = r.sku || '—';
      skuMap.set(sku, (skuMap.get(sku) ?? 0) + 1);
      const ck = `${r.major}\0${r.minor}`;
      const cur = causeMap.get(ck) ?? { major: r.major, minor: r.minor, n: 0 };
      cur.n += 1;
      causeMap.set(ck, cur);
      const p = normalizePlatform(r.platform);
      platMap.set(p, (platMap.get(p) ?? 0) + 1);
    }
    const total = list.length || 1;
    const topSkus = [...skuMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([sku, reviewCount]) => ({
        sku,
        reviewCount,
        share: reviewCount / total,
      }));
    const causes = [...causeMap.values()].sort((a, b) => b.n - a.n);
    const mainCauseItems: AnalysisCauseItem[] = causes.slice(0, 3).map((c) => ({
      major: c.major,
      minor: c.minor,
      count: c.n,
      share: c.n / total,
    }));
    const platforms: AnalysisPlatformStat[] = sortPlatforms([...platMap.keys()]).map(
      (platform) => {
        const count = platMap.get(platform) ?? 0;
        return { platform, count, share: count / total };
      },
    );
    const suggestions = makeSuggestions(mainCauseItems);
    out.push({
      productKey,
      productLabel: list[0]!.productLabel,
      brandKey: list[0]!.brandKey,
      reviewCount: list.length,
      reviewShare: list.length / denom,
      topSkus,
      mainCauseItems,
      mainCauses: mainCauseItems
        .map((c) => `${c.major}·${c.minor} (${c.count})`)
        .join('；'),
      platforms,
      suggestions,
      majorFilterKeys: [...new Set(causes.map((c) => c.major))],
      minorFilterKeys: [...new Set(causes.map((c) => `${c.major}\0${c.minor}`))],
    });
  }
  return out.sort(
    (a, b) => b.reviewCount - a.reviewCount || a.productLabel.localeCompare(b.productLabel, 'zh'),
  );
}

function buildBrandSection(
  brandKey: string,
  rows: Enriched[],
): AnalysisBrandReportSection {
  const platforms = buildPlatformStats(rows);
  const details: AnalysisReportDetailRow[] = rows.map((r) => ({
    reviewId: r.reviewId,
    reviewDateLocal: r.reviewDateLocal,
    brandKey: r.brandKey,
    platform: normalizePlatform(r.platform),
    productLabel: r.productLabel,
    sku: r.sku,
    rating: r.rating,
    major: r.major,
    minor: r.minor,
    reviewText: r.reviewText,
    evidenceQuote: r.evidenceQuote,
  }));
  return {
    brandKey,
    brandLabel: brandLabel(brandKey),
    reviewCount: rows.length,
    platforms,
    causeRows: buildCauseRows(rows),
    topProducts: buildTopProducts(rows, 10),
    topProductsByPlatform: buildTopProductsByPlatform(rows, 10),
    productConclusions: buildConclusions(rows, rows.length),
    details,
  };
}

export async function buildAnalysisReport(
  batchId: string,
): Promise<AnalysisReportResponse | null> {
  const tax = await listTaxonomy({});
  const byId = new Map(tax.items.map((t) => [t.issueId, t]));
  const batch = await loadBatchDetail(batchId, tax.items);
  if (!batch) return null;

  const runs = memoryListRunsByBatch(batchId);
  let reviewIds = [...new Set(runs.map((r) => r.review_id).filter(Boolean))];

  if (!reviewIds.length && batch.reviewIds?.length) {
    reviewIds = [...batch.reviewIds];
  }

  if (!reviewIds.length && !env.importDryRun) {
    const collected = new Set<string>();
    const project = env.gcpProjectId;
    const tryQuery = async (sql: string) => {
      try {
        const [rows] = await getBq().query({ query: sql, params: { batchId } });
        for (const r of rows as Record<string, unknown>[]) {
          const id = String(r.review_id ?? '').trim();
          if (id) collected.add(id);
        }
      } catch (e) {
        console.warn(
          '[analysis] report review_id query skipped',
          e instanceof Error ? e.message : e,
        );
      }
    };
    await tryQuery(`
      SELECT DISTINCT review_id
      FROM \`${project}.review_semantic.analysis_run\`
      WHERE batch_id = @batchId
        AND review_id IS NOT NULL AND TRIM(review_id) != ''
    `);
    await tryQuery(`
      SELECT DISTINCT s.review_id AS review_id
      FROM \`${project}.review_semantic.fact_review_segment\` s
      INNER JOIN \`${project}.review_semantic.analysis_run\` r
        ON r.analysis_run_id = s.analysis_run_id
      WHERE r.batch_id = @batchId
    `);
    await tryQuery(`
      SELECT DISTINCT i.review_id AS review_id
      FROM \`${project}.review_semantic.fact_review_issue\` i
      INNER JOIN \`${project}.review_semantic.analysis_run\` r
        ON r.analysis_run_id = i.analysis_run_id
      WHERE r.batch_id = @batchId
    `);
    reviewIds = [...collected];
  }

  const [metas, issuesByReview] = await Promise.all([
    loadReviewMetas(reviewIds),
    loadIssuesByReview(batchId),
  ]);

  const enriched: Enriched[] = reviewIds.map((id) => {
    const meta = metas.get(id) ?? {
      reviewId: id,
      reviewDateLocal: null,
      brandKey: null,
      platform: null,
      platformSku: null,
      platformProductName: null,
      internalSpu: null,
      internalSku: null,
      productNameCn: null,
      productNameEn: null,
      rating: null,
      reviewText: null,
    };
    const prod = resolveProduct(meta);
    const issues = issuesByReview.get(id) ?? [];
    const blank = isBlankText(meta.reviewText);
    const cause = primaryCause(issues, byId, prod.noTarget, blank);
    return {
      ...meta,
      ...prod,
      major: cause.major,
      minor: cause.minor,
      evidenceQuote: cause.evidenceQuote,
    };
  });

  const byBrand = new Map<string, Enriched[]>();
  for (const row of enriched) {
    const key = normalizeBrandKey(row.brandKey);
    const list = byBrand.get(key) ?? [];
    list.push(row);
    byBrand.set(key, list);
  }

  const brands: AnalysisBrandReportSection[] = sortBrandKeys([...byBrand.keys()]).map(
    (key) => buildBrandSection(key, byBrand.get(key)!),
  );

  const unattributableCount = enriched.filter((r) => r.noTarget).length;
  const formalIssueReviewCount = enriched.filter(
    (r) => (issuesByReview.get(r.reviewId) ?? []).length > 0,
  ).length;
  const products = new Set(enriched.filter((r) => !r.noTarget).map((r) => r.productKey));

  // 兼容旧字段：扁平合并（前端主用 brands）
  const causeRows = brands.flatMap((b) => b.causeRows);
  const topProducts = brands.flatMap((b) =>
    b.topProducts.map((p) => ({ ...p, brandKey: b.brandKey })),
  );
  const productConclusions = brands.flatMap((b) => b.productConclusions);
  const details = brands.flatMap((b) => b.details);

  return {
    batch,
    kpi: {
      reviewCount: enriched.length,
      formalIssueReviewCount,
      pendingReviewCount: batch.pendingReview,
      unattributableCount,
      productAttributedCount: enriched.length - unattributableCount,
      brandCount: brands.filter((b) => b.brandKey !== '__unknown__').length || brands.length,
      productCount: products.size,
    },
    brands,
    causeRows,
    topProducts,
    productConclusions,
    details,
    notes: [
      '按品牌分区；差评=本批分析的 1～3 星样本；占比=占该品牌本批差评条数，非平台全量。',
      '空白/未打标 →「其他问题」；无产品且无 SKU →「无法归因」（产品结论排除）。',
      ...(enriched.length === 0 && batch.total > 0
        ? [
            '本批汇总有条数，但明细未找到。请确认已执行 008_analysis_run.sql 后重新跑差评分析；接 AI 能提升归因质量，但明细本身不依赖 AI。',
          ]
        : []),
    ],
  };
}
