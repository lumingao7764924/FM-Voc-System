/** Shared contracts for VOC import (schema_version v1.1). */

export const SCHEMA_VERSION = 'v1.1';
export const TEMPLATE_VERSION = 'voc_review_import_v1';
export const PARSER_VERSION = 'voc_xlsx_parser_v1';
export const IDENTITY_RULE_VERSION = 'identity_v1';
export const RATING_RULE_VERSION = 'five_star_identity_v1';

export {
  IMPORT_STATUS_LABEL,
  IMPORT_ISSUE_CODE_LABEL,
  IMPORT_BATCH_ERROR_LABEL,
  IMPORT_RESULT_STAT_LABEL,
  IMPORT_RESULT_HINT,
  IMPORT_RESULT_SECTION,
  IMPORT_PAGE_COPY,
  MAPPING_PAGE_COPY,
  REVIEW_LIST_COPY,
  ANALYTICS_COPY,
  ANALYSIS_COPY,
  ANALYSIS_HISTORY_COPY,
  ANALYSIS_REPORT_COPY,
  TAXONOMY_PAGE_COPY,
  SETTINGS_PAGE_COPY,
  PRODUCT_MAPPING_STATUS_LABEL,
  labelImportStatus,
  labelImportIssueCode,
  labelImportBatchError,
  labelImportIssueMessage,
  formatDuplicateInBatchMessage,
  labelProductMappingStatus,
} from './labels.js';
export type {
  ImportStatus,
  ImportBatchErrorCode,
  ProductMappingStatus,
} from './labels.js';
export {
  LIST_DEFAULT_PAGE,
  LIST_DEFAULT_PAGE_SIZE,
  LIST_MAX_PAGE_SIZE,
} from './list.js';
export type { ListPageQuery, PaginatedListResponse } from './list.js';
import type { PaginatedListResponse } from './list.js';
import type { ImportStatus } from './labels.js';

/** 内部 SKU 主数据模板列（与 generate-mapping-template.mjs 一致） */
export const PRODUCT_MAPPING_HEADERS = [
  'brand_key',
  'internal_spu',
  'internal_sku',
  'product_name_cn',
  'product_name_en',
  'shade_code',
  'shade_name',
  'mapping_granularity',
  'source_reference',
] as const;

export type ProductMappingHeader = (typeof PRODUCT_MAPPING_HEADERS)[number];

export const MAPPING_RULE_VERSION = 'global_sku_v1';
export const MAPPING_TEMPLATE_VERSION = 'voc_product_mapping_v1';

/** 问题分类树 Excel 列（与 parseWorkbook 一致） */
export const ISSUE_TAXONOMY_HEADERS = [
  'issue_id',
  'parent_issue_id',
  'issue_level',
  'issue_name_cn',
  'issue_name_en',
  'issue_description',
  'positive_examples',
  'negative_examples',
  'exclusion_rules',
  'issue_owner_team',
  'default_severity',
  'is_safety_related',
  'is_product_controllable',
  'is_logistics_related',
  'active_status',
] as const;

export type IssueTaxonomyHeader = (typeof ISSUE_TAXONOMY_HEADERS)[number];

export const TAXONOMY_TEMPLATE_VERSION = 'voc_issue_taxonomy_v1';
export const DEFAULT_TAXONOMY_VERSION = 'v1';

export const REVIEW_IMPORT_HEADERS = [
  'brand_key',
  'platform',
  'country_code',
  'store_id',
  'source_channel_label',
  'source_review_id',
  'review_date',
  'rating',
  'review_title',
  'review_text',
  'platform_sku',
  'platform_product_name',
  'asin',
  'platform_product_id',
  'media_urls',
  'source_updated_at',
  'helpful_vote_count',
  'seller_reply_text',
] as const;

export type ReviewImportHeader = (typeof REVIEW_IMPORT_HEADERS)[number];

/** Open string keys — new brands/channels do not require code changes. */
export type BrandKey = string;
export type PlatformKey = string;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AccessFlags {
  viewReviewText: boolean;
  viewMedia: boolean;
  export: boolean;
  editMapping: boolean;
  editTaxonomy: boolean;
  manageUsers: boolean;
}

/** 前端路由权限键 */
export type AppPageKey =
  | 'reviews.list'
  | 'reviews.import'
  | 'reviews.history'
  | 'products.list'
  | 'products.import'
  | 'analytics'
  | 'analytics.history'
  | 'analytics.delete'
  | 'taxonomy'
  | 'settings.accounts'
  | 'settings.permissions';

export const ALL_APP_PAGE_KEYS: AppPageKey[] = [
  'reviews.list',
  'reviews.import',
  'reviews.history',
  'products.list',
  'products.import',
  'analytics',
  'analytics.history',
  'analytics.delete',
  'taxonomy',
  'settings.accounts',
  'settings.permissions',
];

/** 与侧栏 NAV 完全一致的页面顺序（首页重定向、权限勾选共用） */
export const APP_NAV_PAGE_ORDER: { page: AppPageKey; path: string; label: string; group: string }[] = [
  { page: 'reviews.list', path: '/reviews/list', label: '评论列表', group: '评论' },
  { page: 'reviews.import', path: '/reviews/import', label: '评论导入', group: '评论' },
  { page: 'reviews.history', path: '/reviews/history', label: '导入历史', group: '评论' },
  { page: 'products.list', path: '/products/list', label: '产品列表', group: '产品' },
  { page: 'products.import', path: '/products/import', label: '产品导入', group: '产品' },
  { page: 'analytics', path: '/analytics', label: '评论分析', group: '分析' },
  { page: 'analytics.history', path: '/analytics/history', label: '差评分析历史', group: '分析' },
  { page: 'taxonomy', path: '/taxonomy', label: '问题分类树', group: '分析' },
  { page: 'settings.accounts', path: '/settings/accounts', label: '账号', group: '设置' },
  { page: 'settings.permissions', path: '/settings/permissions', label: '权限', group: '设置' },
];

/** 不进侧栏、只在权限页勾选的动作键 */
export const APP_EXTRA_PERMISSION_PAGES: {
  page: AppPageKey;
  label: string;
  group: string;
}[] = [{ page: 'analytics.delete', label: '删除 AI 分析', group: '分析' }];

/** 权限配置 UI：按导航大类分组（顺序同侧栏）+ 动作键 */
export const APP_PAGE_PERMISSION_GROUPS: {
  title: string;
  pages: { key: AppPageKey; label: string }[];
}[] = (() => {
  const map = new Map<string, { key: AppPageKey; label: string }[]>();
  for (const item of APP_NAV_PAGE_ORDER) {
    const list = map.get(item.group) ?? [];
    list.push({ key: item.page, label: item.label });
    map.set(item.group, list);
  }
  for (const item of APP_EXTRA_PERMISSION_PAGES) {
    const list = map.get(item.group) ?? [];
    list.push({ key: item.page, label: item.label });
    map.set(item.group, list);
  }
  return [...map.entries()].map(([title, pages]) => ({ title, pages }));
})();

/** brandKeys / pageKeys: '*' = 全部 */
export interface AccessPolicy {
  userId: string;
  username: string;
  displayName: string | null;
  brandKeys: string[] | '*';
  countryCodes: string[];
  /** 可访问页面；'*' = 全部页面 */
  pageKeys: AppPageKey[] | '*';
  /** 由 pageKeys 推导，兼容旧动作校验 */
  flags: AccessFlags;
  policyVersion: number;
  isBootstrapAdmin: boolean;
}

export interface LoginResponse {
  userId: string;
  username: string;
  sessionKey: string;
  access: AccessPolicy;
}

export interface AuthMeResponse {
  userId: string;
  username: string;
  access: AccessPolicy;
}

export interface AppUserListItem {
  userId: string;
  username: string;
  displayName: string | null;
  status: 'active' | 'disabled' | 'deleted';
  isBootstrapAdmin: boolean;
  brandKeys: string[] | '*';
  countryCodes: string[];
  pageKeys: AppPageKey[] | '*';
  flags: AccessFlags;
  policyVersion: number;
  updatedAt: string | null;
}

export interface AppUserUpsertInput {
  username: string;
  password?: string;
  displayName?: string | null;
  status?: 'active' | 'disabled';
  brandKeys: string[] | '*';
  countryCodes?: string[];
  pageKeys: AppPageKey[] | '*';
}

export interface AppUserAccessUpdateInput {
  brandKeys: string[] | '*';
  countryCodes?: string[];
  pageKeys: AppPageKey[] | '*';
}

export function isAppPageKey(v: string): v is AppPageKey {
  return (ALL_APP_PAGE_KEYS as string[]).includes(v);
}

export function flagsFromPageKeys(pageKeys: AppPageKey[] | '*'): AccessFlags {
  const has = (p: AppPageKey) => pageKeys === '*' || pageKeys.includes(p);
  return {
    viewReviewText:
      has('reviews.list') ||
      has('reviews.import') ||
      has('reviews.history') ||
      has('analytics') ||
      has('analytics.history'),
    viewMedia: false,
    export: false,
    editMapping: has('products.list') || has('products.import'),
    editTaxonomy: has('taxonomy'),
    manageUsers: has('settings.accounts') || has('settings.permissions'),
  };
}

/** 旧版粗粒度开关 → 页面列表（读库兼容） */
export function pageKeysFromLegacyFlags(f: AccessFlags): AppPageKey[] {
  const pages: AppPageKey[] = [];
  if (f.viewReviewText) {
    pages.push(
      'reviews.list',
      'reviews.import',
      'reviews.history',
      'analytics',
      'analytics.history',
    );
  }
  if (f.editMapping) pages.push('products.list', 'products.import');
  if (f.editTaxonomy) pages.push('taxonomy');
  if (f.manageUsers) pages.push('settings.accounts', 'settings.permissions');
  return pages;
}

export function normalizePageKeys(raw: unknown, legacyFlags?: AccessFlags): AppPageKey[] | '*' {
  if (raw === '*' || (Array.isArray(raw) && raw.length === 1 && String(raw[0]) === '*')) {
    return '*';
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const keys = [...new Set(raw.map((x) => String(x)).filter(isAppPageKey))];
    if (keys.length) return keys;
  }
  if (legacyFlags) return pageKeysFromLegacyFlags(legacyFlags);
  return [];
}

export function canAccessPage(access: AccessPolicy, page: AppPageKey): boolean {
  if (access.pageKeys === '*') return true;
  return access.pageKeys.includes(page);
}

export function canAccessAnyPage(access: AccessPolicy, pages: AppPageKey[]): boolean {
  return pages.some((p) => canAccessPage(access, p));
}

/** 删除单批 / 清空全部 AI 分析产物（bootstrap admin 或勾选「删除 AI 分析」） */
export function canDeleteAnalysis(access: AccessPolicy): boolean {
  if (access.isBootstrapAdmin) return true;
  return canAccessPage(access, 'analytics.delete');
}

/** 有权限时的首页优先级（与侧栏 NAV 顺序一致） */
export const APP_HOME_PAGE_ORDER: { page: AppPageKey; path: string }[] = APP_NAV_PAGE_ORDER.map(
  ({ page, path }) => ({ page, path }),
);

/** 各大类入口重定向候选（按展示顺序） */
export const APP_GROUP_HOME = {
  reviews: APP_NAV_PAGE_ORDER.filter((i) => i.group === '评论').map(({ page, path }) => ({
    page,
    path,
  })),
  products: APP_NAV_PAGE_ORDER.filter((i) => i.group === '产品').map(({ page, path }) => ({
    page,
    path,
  })),
  analytics: APP_NAV_PAGE_ORDER.filter((i) => i.group === '分析').map(({ page, path }) => ({
    page,
    path,
  })),
  settings: APP_NAV_PAGE_ORDER.filter((i) => i.group === '设置').map(({ page, path }) => ({
    page,
    path,
  })),
} as const;

export type AppGroupKey = keyof typeof APP_GROUP_HOME;

export function firstAllowedPath(access: AccessPolicy): string {
  for (const item of APP_HOME_PAGE_ORDER) {
    if (canAccessPage(access, item.page)) return item.path;
  }
  return '/settings/accounts';
}

export function firstAllowedInGroup(access: AccessPolicy, group: AppGroupKey): string | null {
  for (const item of APP_GROUP_HOME[group]) {
    if (canAccessPage(access, item.page)) return item.path;
  }
  return null;
}

export function pathToPageKey(pathname: string): AppPageKey | null {
  if (
    pathname === '/reviews/list' ||
    pathname === '/reviews' ||
    pathname === '/'
  ) {
    return 'reviews.list';
  }
  if (
    pathname === '/reviews/import' ||
    pathname === '/imports' ||
    pathname.startsWith('/reviews/batches/') ||
    pathname.startsWith('/imports/')
  ) {
    return 'reviews.import';
  }
  if (pathname === '/reviews/history' || pathname.startsWith('/history')) {
    return 'reviews.history';
  }
  if (pathname === '/products/list' || pathname === '/products') {
    return 'products.list';
  }
  if (pathname === '/products/import' || pathname === '/mapping') {
    return 'products.import';
  }
  if (pathname.startsWith('/analytics/batches/')) {
    return 'analytics.history';
  }
  if (pathname === '/analytics/history' || pathname.startsWith('/analytics/history')) {
    return 'analytics.history';
  }
  if (pathname === '/analytics' || pathname.startsWith('/analytics/')) {
    return 'analytics';
  }
  if (pathname === '/taxonomy' || pathname.startsWith('/taxonomy/')) {
    return 'taxonomy';
  }
  if (pathname === '/settings/accounts' || pathname.startsWith('/settings/accounts')) {
    return 'settings.accounts';
  }
  if (
    pathname === '/settings/permissions' ||
    pathname.startsWith('/settings/permissions')
  ) {
    return 'settings.permissions';
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return 'settings.accounts';
  }
  return null;
}

export interface CreateImportRequest {
  /** Optional; brand/platform/country come from each Excel row (mixed upload OK). */
  requestIdempotencyKey: string;
  sourceFileName: string;
}

export interface CreateImportResponse {
  importBatchId: string;
  importStatus: ImportStatus;
}

export interface ImportBatchSummary {
  importBatchId: string;
  importStatus: ImportStatus;
  platform: string;
  countryCode: string;
  declaredBrandKey: string | null;
  sourceFileName: string;
  uploadedAt: string;
  completedAt: string | null;
  totalRows: number | null;
  newRows: number | null;
  updatedRows: number | null;
  duplicateRows: number | null;
  quarantinedRows: number | null;
  unmappedRows: number | null;
  textMissingRows: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** 隔离异常行明细（结果页表格） */
  quarantineItems?: ImportIssueItem[];
  /** 本批内重复行明细 */
  duplicateItems?: ImportIssueItem[];
}

/** 导入结果页中「隔离 / 重复」明细行 */
export interface ImportIssueItem {
  sourceRowNumber: number;
  code: string;
  message: string;
  brandKey?: string;
  platform?: string;
  platformSku?: string;
  preview?: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

/** Envelope used when application-layer payload encryption is enabled. */
export interface EncryptedEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

/** 批次列表接口响应（不含大明细，减小体积） */
export interface ImportBatchListResponse extends PaginatedListResponse<ImportBatchSummary> {}

/** 当前有效的一条内部 SKU 映射（列表展示） */
export interface ProductMappingItem {
  brandKey: string;
  internalSpu: string | null;
  internalSku: string;
  productNameCn: string | null;
  productNameEn: string | null;
  shadeName: string | null;
  mappingGranularity: string;
  mappingStatus: string;
  sourceReference: string;
  validFrom: string;
  mappingPublicationId: string;
}

/** 产品列表按 SPU 合并后的一行（同 brand+SPU 下多个 SKU） */
export interface ProductMappingSpuGroup {
  brandKey: string;
  internalSpu: string | null;
  mappingGranularity: string;
  skus: ProductMappingItem[];
}

export interface ProductMappingListResponse extends PaginatedListResponse<ProductMappingSpuGroup> {
  /** 可选品牌（不受本次 q 筛选影响，便于下拉） */
  brands: string[];
}

/** 上传对照表结果 */
export interface ProductMappingUploadResult {
  mappingPublicationId: string;
  added: number;
  updated: number;
  /** 兼容旧字段：重复跳过 + 无 SKU 跳过之和 */
  skipped: number;
  /** 同文件重复 SKU 被覆盖掉的行数（保留最底下一行） */
  duplicateSkipped: number;
  /** 无 internal_sku（含 `/`）被过滤的行数 */
  noSkuSkipped: number;
  totalRows: number;
  /** 与评论导入相同：true 时只写进程内存，不写 BigQuery */
  dryRun: boolean;
  message?: string;
}

/** 待映射 / 冲突的平台 SKU 聚合 */
export interface UnmappedSkuItem {
  brandKey: string;
  platformSku: string;
  status: 'pending' | 'conflict';
  reviewCount: number;
}

export interface UnmappedSkuListResponse extends PaginatedListResponse<UnmappedSkuItem> {}

/** 评论列表一行 */
export interface ReviewListItem {
  reviewId: string;
  /** 展示用：统一 YYYY-MM-DD HH:mm:ss（无源时刻时补 00:00:00） */
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
  reviewScope: string | null;
  reviewTitle: string | null;
  reviewText: string | null;
}

export interface ReviewListResponse extends PaginatedListResponse<ReviewListItem> {
  brands: string[];
  countries: string[];
  platforms?: string[];
}

/** 评论分析统一筛选（与列表对齐） */
export interface AnalyticsFilterQuery {
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
}

export type AnalyticsEmptyReason = 'no_data' | 'filtered_empty' | null;

export interface AnalyticsOverviewResponse {
  totalReviews: number;
  ratedCount: number;
  avgRating: number | null;
  /** 差评率：1～3 星 / 有效星级评论（本产品口径；主方案原文为 1～2） */
  lowStarRate: number | null;
  /** 好评率：4～5 星 / 有效星级评论 */
  highStarRate: number | null;
  mappedSpuCount: number;
  mappedSpuRate: number | null;
  emptyReason: AnalyticsEmptyReason;
  sampleNote: string;
  brands: string[];
  countries: string[];
  platforms: string[];
}

export type AnalyticsTrendGranularity = 'day' | 'week';
export type AnalyticsTrendMetric = 'count' | 'avg' | 'lowRate';

export interface AnalyticsTrendPoint {
  period: string;
  reviewCount: number;
  avgRating: number | null;
  lowStarRate: number | null;
}

export interface AnalyticsTrendResponse {
  granularity: AnalyticsTrendGranularity;
  points: AnalyticsTrendPoint[];
}

export type AnalyticsBreakdownDimension =
  | 'brand'
  | 'spu'
  | 'sku'
  | 'country'
  | 'platform';

export interface AnalyticsBreakdownItem {
  key: string;
  reviewCount: number;
  avgRating: number | null;
  lowStarRate: number | null;
}

export interface AnalyticsBreakdownResponse {
  dimension: AnalyticsBreakdownDimension;
  items: AnalyticsBreakdownItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 同步映射：把有 platform_sku 且未 confirmed 的历史评论按主数据回写 */
export interface SyncMappingResult {
  /** 同步前：有平台 SKU 且未映射的评论数 */
  candidates: number;
  /** 主数据里已有对应 brand+SKU、本可同步的评论数 */
  matchable: number;
  /** 本次成功写成已映射的评论数 */
  synced: number;
  /** 同步后仍未映射（有 SKU）的评论数 */
  stillUnmapped: number;
  dryRun: boolean;
  message?: string;
}

/** 问题分类树一行（当前有效版本） */
export interface IssueTaxonomyItem {
  issueId: string;
  taxonomyVersion: string;
  parentIssueId: string | null;
  issueLevel: number;
  issueNameCn: string;
  issueNameEn: string | null;
  issueDescription: string | null;
  positiveExamples: string[];
  negativeExamples: string[];
  exclusionRules: string[];
  issueOwnerTeam: string | null;
  defaultSeverity: number | null;
  isSafetyRelated: boolean;
  isProductControllable: boolean;
  isLogisticsRelated: boolean;
  activeStatus: string;
  validFrom: string;
  sourceReference: string | null;
}

export interface IssueTaxonomyListResponse {
  taxonomyVersion: string;
  versions: string[];
  items: IssueTaxonomyItem[];
  total: number;
}

export interface IssueTaxonomyUpsertInput {
  issueId?: string;
  taxonomyVersion?: string;
  parentIssueId?: string | null;
  issueLevel: number;
  issueNameCn: string;
  issueNameEn?: string | null;
  issueDescription?: string | null;
  positiveExamples?: string[];
  negativeExamples?: string[];
  exclusionRules?: string[];
  issueOwnerTeam?: string | null;
  defaultSeverity?: number | null;
  isSafetyRelated?: boolean;
  isProductControllable?: boolean;
  isLogisticsRelated?: boolean;
  activeStatus?: string;
}

export interface IssueTaxonomyUploadResult {
  taxonomyVersion: string;
  added: number;
  updated: number;
  totalRows: number;
  dryRun: boolean;
  message: string;
}

export interface IssueTaxonomyVersionResult {
  taxonomyVersion: string;
  versions: string[];
  dryRun: boolean;
  message: string;
}

/** 差评语义分析批次状态 */
export type AnalysisBatchStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'partial';

export type AnalysisRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'pending_review';

/** 创建分析批次：沿用评论分析筛选；默认只跑筛选内 1～3 星且有正文 */
export interface AnalysisBatchCreateInput {
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
  /** 本批上限；服务端再夹到 ANALYSIS_MAX_REVIEWS */
  maxReviews?: number;
}

export interface AnalysisBatchSummary {
  batchId: string;
  status: AnalysisBatchStatus;
  total: number;
  succeeded: number;
  failed: number;
  pendingReview: number;
  formalIssueCount: number;
  modelVersion: string;
  promptVersion: string;
  taxonomyVersion: string;
  dryRun: boolean;
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  /** 创建时筛选快照（便于 UI 展示） */
  filterSnapshot: AnalysisBatchCreateInput;
  /** 本批评论 ID（报告重建用；随批次落库） */
  reviewIds?: string[];
}

export interface AnalysisIssueTopItem {
  issueId: string;
  issueNameCn: string;
  issueLevel: number;
  reviewCount: number;
  sampleEvidence: string | null;
}

export interface AnalysisBatchDetail extends AnalysisBatchSummary {
  topIssues: AnalysisIssueTopItem[];
}

/** 清空 AI 分析产物（仅 bootstrap admin） */
export interface AnalysisClearResult {
  dryRun: boolean;
  memory: {
    batchCount: number;
    runCount: number;
    segmentCount: number;
    issueCount: number;
  };
  bigQuery: {
    analysisRun: number;
    segment: number;
    issue: number;
    batch: number;
  } | null;
  message: string;
}

export interface AnalysisBatchListResponse extends PaginatedListResponse<AnalysisBatchSummary> {}

export interface AnalysisBatchDeleteResult {
  batchId: string;
  dryRun: boolean;
  deletedRuns: number;
  deletedSegments: number;
  deletedIssues: number;
  message: string;
}

/** 差评分析报告（对齐 VOC skill 总览结构；无销量占比） */
export interface AnalysisReportKpi {
  reviewCount: number;
  formalIssueReviewCount: number;
  pendingReviewCount: number;
  unattributableCount: number;
  productAttributedCount: number;
  brandCount: number;
  productCount: number;
}

export interface AnalysisPlatformStat {
  platform: string;
  count: number;
  /** 占该品牌（或本批）差评条数 */
  share: number;
}

export interface AnalysisCauseRow {
  major: string;
  majorCount: number;
  /** 占本品牌差评条数（非销量） */
  majorShare: number;
  minor: string;
  minorCount: number;
  minorShare: number;
  isFirstOfMajor: boolean;
  majorRowSpan: number;
}

export interface AnalysisTopProductRow {
  rank: number;
  productKey: string;
  productLabel: string;
  brandKey: string | null;
  reviewCount: number;
}

export interface AnalysisProductSkuStat {
  sku: string;
  reviewCount: number;
  /** 占该产品本批差评条数 */
  share: number;
}

export interface AnalysisCauseItem {
  major: string;
  minor: string;
  count: number;
  share: number;
}

export interface AnalysisProductConclusionRow {
  productKey: string;
  productLabel: string;
  brandKey: string | null;
  reviewCount: number;
  /** 占本品牌差评条数（非销量） */
  reviewShare: number;
  topSkus: AnalysisProductSkuStat[];
  /** 结构化主因（UI 用 tag） */
  mainCauseItems: AnalysisCauseItem[];
  /** 兼容旧字段 */
  mainCauses: string;
  platforms: AnalysisPlatformStat[];
  suggestions: string[];
  majorFilterKeys: string[];
  minorFilterKeys: string[];
}

export interface AnalysisReportDetailRow {
  reviewId: string;
  reviewDateLocal: string | null;
  brandKey: string | null;
  platform: string | null;
  productLabel: string;
  sku: string | null;
  rating: number | null;
  major: string;
  minor: string;
  reviewText: string | null;
  evidenceQuote: string | null;
}

/** 某平台下的 Top 产品榜 */
export interface AnalysisPlatformTopProducts {
  platform: string;
  reviewCount: number;
  products: AnalysisTopProductRow[];
}

/** 单一品牌报告块（SKT / TP 等分开展示，不混排） */
export interface AnalysisBrandReportSection {
  brandKey: string;
  brandLabel: string;
  reviewCount: number;
  platforms: AnalysisPlatformStat[];
  causeRows: AnalysisCauseRow[];
  /** 品牌合计 Top 10（兼容） */
  topProducts: AnalysisTopProductRow[];
  /** 各平台各自 Top 10 */
  topProductsByPlatform: AnalysisPlatformTopProducts[];
  productConclusions: AnalysisProductConclusionRow[];
  details: AnalysisReportDetailRow[];
}

export interface AnalysisReportResponse {
  batch: AnalysisBatchSummary;
  /** 整批汇总 KPI */
  kpi: AnalysisReportKpi;
  /** 按品牌分区；有几个品牌就几段 */
  brands: AnalysisBrandReportSection[];
  /** @deprecated 兼容：等于各品牌合并视图，前端请用 brands */
  causeRows: AnalysisCauseRow[];
  topProducts: AnalysisTopProductRow[];
  productConclusions: AnalysisProductConclusionRow[];
  details: AnalysisReportDetailRow[];
  /** 口径说明 */
  notes: string[];
}
