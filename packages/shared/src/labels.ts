/**
 * 界面文案字典：code / 字段键 → 展示文案（前后端共用）。
 *
 * 约定：新增导入状态、问题码、批次错误码、结果页指标说明时，只改本文件，
 * 不要在 apps/web 或 apps/api 再散落一份中文映射。
 */

/** 导入批次状态 → 界面文案 */
export const IMPORT_STATUS_LABEL = {
  awaiting_upload: '等待上传',
  queued: '排队中',
  running: '处理中',
  completed: '全部成功',
  partial_failed: '部分成功',
  failed: '导入失败',
  cancelled: '已取消',
  deduplicated: '重复批次',
} as const;

export type ImportStatus = keyof typeof IMPORT_STATUS_LABEL;

/**
 * 行级问题码 → 说明（解析隔离 / 查重）。
 * UI 一般只展示文案，不展示裸 code。
 */
export const IMPORT_ISSUE_CODE_LABEL: Record<string, string> = {
  missing_brand: '缺少品牌 brand_key',
  missing_platform: '缺少平台 platform',
  bad_rating: '评分无效（需为 1～5）',
  bad_date: '日期无效（需 YYYY-MM-DD 等）',
  duplicate_in_batch: '与本批其他行内容重复，已跳过入库',
  duplicate_in_history: '与库中已有评论内容重复，已跳过入库',
};

/** 批次级 error_code → 默认说明（可被写入时的具体 error_message 覆盖） */
export const IMPORT_BATCH_ERROR_LABEL = {
  import_failed: '导入失败',
  job_interrupted: '导入任务已中断（服务重启或进程退出），请重新上传',
  job_interrupted_stale: '批次长时间未完成上传/处理，已标记失败，请重新上传',
} as const;

export type ImportBatchErrorCode = keyof typeof IMPORT_BATCH_ERROR_LABEL;

/** 结果页指标名 */
export const IMPORT_RESULT_STAT_LABEL = {
  totalRows: '总行数',
  newRows: '成功入库',
  quarantinedRows: '隔离异常',
  unmappedRows: '待映射',
  textMissingRows: '无正文',
  duplicateRows: '重复',
} as const;

/** 结果页指标旁说明（InfoHint） */
export const IMPORT_RESULT_HINT = {
  quarantined: '校验未通过的行不会写入 Core，请按说明修正后重新导入。',
  duplicate:
    '同一内容唯一键（source_row_hash）在本文件内或历史库中已存在时跳过入库。含：品牌/平台/SKU/日期（含源表时刻）/评分/标题/正文；无正文且无平台评论 ID/媒体时跳过查重。',
  unmapped: '商品评论尚未匹配内部 SKU；店铺评论不计入此项。',
  partial: '有成功入库，同时也有隔离异常。',
} as const;

/** 结果页区块标题 / 空态 / 明细列表头 */
export const IMPORT_RESULT_SECTION = {
  quarantineTitle: '隔离异常明细',
  quarantineEmpty: '本批没有隔离异常。',
  duplicateTitle: '重复行明细',
  duplicateEmpty: '本批没有检测到重复行。',
  pageTitle: '导入结果',
  colRow: '行号',
  colMessage: '说明',
  colMeta: '品牌 / 平台 / SKU',
  colReviewContent: '评论内容',
} as const;

/** 评论导入页文案 */
export const IMPORT_PAGE_COPY = {
  title: '评论导入',
  templateTitle: '下载导入模板',
  templateDesc: 'Excel 表头固定，勿改列名。支持多品牌 / 多平台混在同一文件。',
  templateFileName: 'voc_review_import_template.xlsx',
  templateHref: '/templates/voc_review_import_template.xlsx',
  dropIdle: '将 xlsx 拖到此处，或点击选择',
  dropActive: '松开以上传该文件',
  dropHint: '仅支持 .xlsx，单文件不超过 20MB',
  selectedPrefix: '已选择',
  clearFile: '清除',
  submit: '上传并后台导入',
  submitting: '上传中…',
  needFile: '请选择评论 xlsx 文件',
  uploadFailed: '上传失败',
  step1: '下载模板并填入评论',
  step2: '上传文件，后台自动处理',
  step3: '在历史上传查看结果',
} as const;

/** 产品导入（内部 SKU 主数据）页文案 */
export const MAPPING_PAGE_COPY = {
  title: '产品导入',
  subtitle: '上传公司内部 SKU 主数据；评论导入时用 platform_sku 与 internal_sku 匹配。',
  listPageTitle: '产品列表',
  listPageSubtitle: '查看当前有效的内部 SKU，以及评论侧尚未匹配的平台 SKU。',
  templateTitle: '下载对照模板',
  templateDesc: '工作表 01_内部SKU主数据；第 1 行英文列名勿改。再次上传同一 SKU 会覆盖更新。',
  templateFileName: 'voc_product_mapping_template.xlsx',
  templateHref: '/templates/voc_product_mapping_template.xlsx',
  dropIdle: '将 SKU 对照 xlsx 拖到此处，或点击选择',
  dropActive: '松开以上传该文件',
  dropHint: '仅支持 .xlsx，单文件不超过 20MB',
  selectedPrefix: '已选择',
  clearFile: '清除',
  submit: '上传并更新主数据',
  submitting: '处理中…',
  needFile: '请选择产品导入 xlsx 文件',
  uploadFailed: '上传失败',
  listTitle: '当前有效产品',
  listEmpty: '暂无产品数据，请先到「产品导入」上传对照表。',
  unmappedTitle: '待映射清单',
  unmappedEmpty: '当前没有待映射或冲突的商品 SKU。',
  unmappedHint: '来自已入库、尚未匹配内部 SKU 的商品评论；补主数据后新导入即可命中（历史回写为后续能力）。',
  colBrand: '品牌',
  colSpu: '内部 SPU',
  colSku: '内部 SKU',
  colName: '产品名',
  colNameCn: '产品名（中）',
  colNameEn: '产品名（英）',
  colGranularity: '粒度',
  colPlatformSku: '平台 SKU',
  colStatus: '状态',
  colCount: '出现次数',
  resultAdded: '新增',
  resultUpdated: '覆盖',
  resultSkipped: '跳过',
  resultDuplicate: '重复跳过',
  resultNoSku: '无SKU跳过',
  dryRunHint: '当前为干跑（IMPORT_DRY_RUN=true）：对照表与评论都只写本机内存，不上传 BigQuery。',
  dryRunResultSuffix: '（干跑，未写 BigQuery）',
  liveResultSuffix: '（已写入 BigQuery）',
  goToList: '查看产品列表',
  historyTitle: '导入历史',
} as const;

/** 评论映射状态 → 界面文案 */
export const PRODUCT_MAPPING_STATUS_LABEL = {
  confirmed: '已映射',
  pending: '未映射',
  conflict: '冲突',
  invalid: '无效',
} as const;

export type ProductMappingStatus = keyof typeof PRODUCT_MAPPING_STATUS_LABEL;

export const REVIEW_LIST_COPY = {
  pageTitle: '评论列表',
  empty: '暂无评论。请先到「评论导入」上传文件。',
  emptyFiltered: '当前筛选条件下没有评论。',
  filterButton: '筛选',
  filterTitle: '筛选条件',
  filterApply: '应用',
  filterReset: '重置',
  filterBrand: '品牌',
  filterCountry: '地区',
  filterMapped: '是否映射',
  filterMappedAll: '全部',
  filterMappedYes: '已映射',
  filterMappedNo: '未映射',
  filterRatingMin: '最低星级',
  filterRatingMax: '最高星级',
  filterQ: 'SKU / SPU / 产品名',
  filterQPlaceholder: '平台 SKU、内部 SKU/SPU、产品名',
  colDate: '日期',
  colRating: '星级',
  colBrand: '品牌',
  colCountry: '地区',
  colPlatform: '平台',
  colPlatformSku: '平台 SKU',
  colProduct: '产品',
  colMapped: '映射',
  colText: '评论',
  syncMapping: '同步映射',
  syncMappingLoading: '同步中…',
  syncResultTitle: '同步映射结果',
  syncResultSynced: '本次同步映射',
  syncResultUnmapped: '仍未映射',
  syncResultCandidates: '待处理（有 SKU）',
  syncResultMatchable: '主数据可命中',
  syncResultOk: '知道了',
  syncFailed: '同步映射失败',
} as const;

/** 评论分析看板（轨道 A，无 AI） */
export const ANALYTICS_COPY = {
  pageTitle: '评论分析',
  sampleNote: '以下为已导入样本口径；差评为 1～3 星，不代表平台全量差评率。',
  empty: '暂无评论数据。请先到「评论导入」上传文件。',
  emptyFiltered: '当前筛选过严，没有匹配的评论。请放宽条件后再试。',
  filterButton: '筛选',
  filterTitle: '筛选条件',
  filterApply: '应用',
  filterReset: '重置',
  filterDateFrom: '开始日期',
  filterDateTo: '结束日期',
  filterBrand: '品牌',
  filterSpu: '内部 SPU',
  filterSku: '内部 SKU',
  filterCountry: '国家',
  filterPlatform: '平台',
  filterRatingMin: '最低星级',
  filterRatingMax: '最高星级',
  metricTotal: '评论数',
  metricAvgRating: '均星',
  metricLowStarRate: '1～3 星率',
  metricHighStarRate: '4～5 星率',
  metricMappedRate: 'SPU 映射覆盖率',
  trendTitle: '趋势',
  trendCount: '评论量',
  trendAvg: '均星',
  trendLowRate: '差评率',
  trendDay: '按日',
  trendWeek: '按周',
  breakdownTitle: '分布',
  dimBrand: '品牌',
  dimSpu: 'SPU',
  dimSku: 'SKU',
  dimCountry: '国家',
  dimPlatform: '平台',
  colKey: '维度',
  colCount: '评论数',
  colAvg: '均星',
  colLowRate: '差评率',
  drillTitle: '评论原声',
  drillRating: '星级',
  drillRatingAll: '全部星级',
  drillEmpty: '没有可展示的原声。',
  drillClose: '关闭',
  loadFailed: '加载失败',
  analyzeButton: '差评分析',
  analyzeRunning: '分析中…',
  analyzeConfirm:
    '将按当前筛选，对范围内最多 {max} 条有正文的 1～3 星差评跑语义分析（可减少无效 token）。确定开始？',
  analyzeStarted: '已开始差评分析',
  analyzeDone: '差评分析完成',
  analyzeFailed: '差评分析失败',
  analyzeEmpty: '当前筛选下没有可分析的差评（需有正文且 1～3 星）。',
  analyzePanelTitle: '本批差评问题',
  analyzeCoverage: '已分析',
  analyzeTopIssues: 'Top 问题',
  analyzeNoIssues:
    '本批已跑完，但没有「正式问题」入库：当前是规则 stub，关键词未命中分类树，或不达标进了复核。不等于「没有差评」。',
  analyzeStatusQueued: '排队中',
  analyzeStatusRunning: '分析中',
  analyzeStatusSucceeded: '已完成',
  analyzeStatusFailed: '失败',
  analyzeStatusPartial: '部分完成',
  analyzeDryRunHint: '当前为干跑：结果只写内存，不写 BigQuery。',
  analyzeLiveHint: '当前为写真库：结果会写入 BigQuery。',
  clearAnalysisButton: '清空 AI 分析',
  clearAnalysisConfirm:
    '将清空全部 AI 分析产物（analysis_run / 片段 / 正式问题）。评论、分类树与账号不受影响。此操作不可恢复，确定？',
  clearAnalysisOk: '已清空 AI 分析数据',
  clearAnalysisFailed: '清空失败',
  clearAnalysisBusy: '清空中…',
} as const;

/** 差评语义分析（Step 5） */
export const ANALYSIS_COPY = {
  modelStub: 'stub-v1',
  promptStub: 'stub-split-v1',
  /** LLM 提示词版本（与 apps/api llmClassify 保持一致） */
  promptLlm: 'llm-voc-classify-v1',
} as const;

/** 差评分析历史页 */
export const ANALYSIS_HISTORY_COPY = {
  pageTitle: '差评分析历史',
  pageHint: '按筛选触发的差评分析批次。可查看状态与正式问题数；有删除权限时可删单批或清空全部。',
  empty: '还没有差评分析批次。请到「评论分析」点「差评分析」。',
  colTime: '时间',
  colStatus: '状态',
  colTotal: '条数',
  colIssues: '正式问题',
  colModel: '模型',
  colActions: '操作',
  deleteOne: '删除',
  deleteOneConfirm: '删除该批次及其 run / 片段 / 问题结果？不可恢复。',
  deleteOneOk: '已删除该批次',
  deleteOneFailed: '删除失败',
  clearAll: '清空全部 AI 分析',
  loadFailed: '加载失败',
  statusQueued: '排队中',
  statusRunning: '分析中',
  statusSucceeded: '已完成',
  statusFailed: '失败',
  statusPartial: '部分完成',
  needDeletePermission: '需要「删除 AI 分析」权限',
  viewReport: '查看报告',
  openReport: '打开报告',
} as const;

/** 差评分析报告（单批；对齐 VOC skill 总览，无销量） */
export const ANALYSIS_REPORT_COPY = {
  pageTitle: '差评分析报告',
  backHistory: '返回历史',
  loadFailed: '加载报告失败',
  notFound: '找不到该分析批次',
  brandCurrent: '当前品牌',
  overviewTitle: '总览',
  kpiReviews: '差评总数',
  kpiFormal: '已打标',
  kpiPending: '待复核',
  kpiUnattr: '无法归因',
  kpiProducts: '涉及产品',
  kpiBrands: '品牌数',
  causeTitle: '差评归因',
  causeMajor: '归因大类',
  causeMajorN: '大类条数',
  causeMajorPct: '大类占比',
  causeMinor: '二级归因',
  causeMinorN: '二级条数',
  causeMinorPct: '二级占比',
  topProductTitle: '各平台差评 Top 10 产品',
  topPlatformEmpty: '该平台暂无可归因产品。',
  topRank: '#',
  topProduct: '产品',
  topCount: '差评条数',
  countUnit: '条',
  conclusionTitle: '产品结论',
  conclusionHint:
    '仅过滤下方产品列表；空白评论=「其他问题/无理由」；无产品且无 SKU=「无法归因」（产品结论不含）。占比=占本品牌本批差评条数。',
  filterMajor: '归因大类',
  filterMinor: '二级归因',
  filterAll: '全部',
  sortByCount: '差评数 ↓',
  colIndex: '#',
  colProduct: '产品',
  colBrand: '品牌',
  colCount: '差评数/占比',
  colTopSku: 'Top3 差评 SKU',
  colMainCause: '主要归因',
  colPlatformDist: '各平台差评分布',
  colSuggestions: '产品建议',
  detailTitle: '差评明细',
  detailDate: '时间',
  detailPlatform: '平台',
  detailRating: '星级',
  detailText: '原文',
  detailEvidence: '依据',
  emptyCause: '本品牌暂无归因数据。',
  emptyProduct: '本品牌无可归因产品。',
  emptyDetail: '本品牌没有明细。',
  emptyBrand: '本批没有可展示的品牌数据。',
  filterTitle: '本次筛选',
  runningHint: '分析仍在进行，完成后本页会自动刷新。',
  noteSample:
    '按品牌分区展示；差评=本批 1～3 星样本；平台占比=占该品牌本批差评。',
  missingDetails:
    '本批汇总有条数，但明细未找到（常见原因：当时未建 analysis_run 表，或 API 重启后旧批未持久化评论列表）。请确认已执行 sql/ddl/008_analysis_run.sql 后，在「评论分析」重新跑一次差评分析。接 AI 后归因会更准，但明细本身不依赖 AI。',
} as const;

/** 问题分类树管理（轨道 B / Step 4，无 AI） */
export const TAXONOMY_PAGE_COPY = {
  pageTitle: '问题分类树',
  pageHint:
    '为后续 AI/规则分类准备固定问题树。可导入 Excel、单条新建/编辑；安全类请勾选「安全相关」属性。',
  empty: '当前版本还没有分类。请下载分类表后导入，或单条新建。',
  versionLabel: '版本',
  createVersion: '新建版本',
  deleteVersion: '删除版本',
  deleteVersionConfirm: '将删除当前版本及其全部分类，不可恢复。确定？',
  cannotDeleteLastVersion: '至少保留一个版本',
  versionCreated: '已新建版本',
  versionDeleted: '已删除版本',
  colId: 'ID',
  colLevel: '层级',
  colName: '名称',
  colParent: '父级',
  colSafety: '安全',
  colOwner: '责任域',
  colStatus: '状态',
  colActions: '操作',
  fieldFlags: '属性标记',
  flagSafety: '安全相关',
  flagProduct: '产品可控',
  flagLogistics: '物流相关',
  flagNone: '无',
  ownerPlaceholder: '选择或输入责任域',
  ownerProduct: 'product · 产品',
  ownerLogistics: 'logistics · 物流',
  ownerCs: 'cs · 客服',
  ownerOps: 'ops · 运营',
  create: '新建分类',
  edit: '编辑',
  import: '导入 Excel',
  templateTitle: '下载分类表',
  templateDesc: '美妆护肤差评分类（与差评说明对齐）。第 1 行英文列名勿改；同 issue_id 再导入会覆盖更新。',
  templateFileName: 'voc_issue_taxonomy_beauty_skincare_v1.xlsx',
  save: '保存',
  cancel: '取消',
  uploadOk: '导入完成',
  uploadFailed: '导入失败',
  saveFailed: '保存失败',
  needFile: '请选择 .xlsx 文件',
  safetyYes: '安全',
  active: '启用',
  inactive: '停用',
} as const;

/** 设置：账号 / 权限 */
export const SETTINGS_PAGE_COPY = {
  navGroup: '设置',
  accountsTitle: '账号',
  permissionsTitle: '权限',
  accountsHint: '管理系统内部登录账号：新建、启停、删除。',
  permissionsHint: '为账号配置可看品牌与可进入的页面（按导航大类勾选）。',
  colUsername: '用户名',
  colDisplayName: '显示名',
  colStatus: '状态',
  colBrands: '品牌范围',
  colActions: '操作',
  createUser: '新建账号',
  editUser: '编辑',
  deleteUser: '删除',
  confirmDeleteUser: '确定删除该账号？删除后无法登录。',
  resetPassword: '重置密码',
  save: '保存',
  cancel: '取消',
  active: '启用',
  disabled: '停用',
  deleted: '已删除',
  brandsAll: '全部品牌',
  brandsNone: '无',
  flagViewReviews: '评论/分析',
  flagEditMapping: '产品映射',
  flagEditTaxonomy: '问题分类树',
  flagManageUsers: '账号与权限',
  pagesLabel: '页面权限',
  pagesAll: '全部页面',
  pagesHint: '按导航勾选可进入的页面；大类仅作分组。',
  noAccess: '当前账号没有可访问的页面，请联系管理员。',
  forbidden: '没有权限访问该页面',
  loadFailed: '加载失败',
  saveFailed: '保存失败',
  deleteFailed: '删除失败',
  passwordRequired: '请填写密码',
  bootstrapLocked: '超级管理员不可编辑',
  bootstrapNoPermissionEdit: '超级管理员权限不可修改',
  cannotDeleteSelf: '不能删除当前登录账号',
} as const;

export function labelProductMappingStatus(status: string): string {
  return (
    PRODUCT_MAPPING_STATUS_LABEL[status as ProductMappingStatus] ?? status
  );
}

export function labelImportStatus(status: ImportStatus | string): string {
  return IMPORT_STATUS_LABEL[status as ImportStatus] ?? status;
}

export function labelImportIssueCode(code: string): string {
  return IMPORT_ISSUE_CODE_LABEL[code] ?? code;
}

export function labelImportBatchError(
  code: string,
  fallbackMessage?: string | null,
): string {
  if (fallbackMessage?.trim()) return fallbackMessage.trim();
  return (
    IMPORT_BATCH_ERROR_LABEL[code as ImportBatchErrorCode] ?? code
  );
}

/**
 * 将问题说明规范化：裸 code / 逗号分隔 code 列表 → 可读文案；已是完整句子则原样返回。
 */
export function labelImportIssueMessage(code: string, message?: string | null): string {
  const trimmed = (message ?? '').trim();
  if (!trimmed || trimmed === code) {
    return labelImportIssueCode(code);
  }
  if (/^[a-z_]+(?:,[a-z_]+)*$/i.test(trimmed)) {
    return trimmed
      .split(',')
      .map((c) => labelImportIssueCode(c))
      .join('；');
  }
  return trimmed;
}

/** 本批内重复：带对照行号的说明 */
export function formatDuplicateInBatchMessage(firstDupRow: number): string {
  return `与本批第 ${firstDupRow} 行内容重复（同一 source_row_hash），已跳过入库`;
}
