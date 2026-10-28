-- VOC BigQuery DDL（含字段 description）
-- 依据：统一评论字段字典 / 方案；含阶段一底座 + 分类树 + 内部账号权限
-- 项目：feimei-product-voc
-- 用法：在 BigQuery 控制台选项目 feimei-product-voc 后整份运行。
-- 注意：CREATE TABLE IF NOT EXISTS 不会给「已存在的表」补 description。
-- 增量单文件（已有环境可只跑）：006_dim_issue_taxonomy.sql、007_app_user_access.sql

-- ---------------------------------------------------------------------------
-- review_control.review_import_batch
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.review_import_batch` (
  import_batch_id STRING NOT NULL OPTIONS(description = '系统 UUID；一次逻辑导入的稳定 ID'),
  request_idempotency_key STRING NOT NULL OPTIONS(description = '上传请求 UUID，与登录主体绑定；文件上传前即可用于网络重试'),
  idempotency_key STRING OPTIONS(description = '上传完成后由文件 Hash+来源上下文+模板/解析器版本+操作模式生成的 SHA256'),
  duplicate_of_batch_id STRING OPTIONS(description = '相同文件键时指向唯一实际处理批次'),
  replay_of_batch_id STRING OPTIONS(description = '显式重解析来源批次；普通重试不新增批次'),
  platform STRING NOT NULL OPTIONS(description = '标准平台键：amazon/tiktokshop/mercadolibre/noon/shopify/other；混导可为 other'),
  source_system STRING NOT NULL OPTIONS(description = '原生评论系统命名空间，不能只写导出工具名'),
  source_provider STRING NOT NULL OPTIONS(description = '实际导出工具/来源名称，与 source_system 分开'),
  country_code STRING NOT NULL OPTIONS(description = '平台市场国家 ISO 代码；混市场可用 XX'),
  marketplace_id STRING OPTIONS(description = '平台原生 Marketplace/Site ID'),
  store_id STRING OPTIONS(description = '店铺作用域；公开目录评论允许 NULL'),
  authorization_key STRING OPTIONS(description = '既有集成授权键，仅来源血缘，不是凭证'),
  source_scope_id STRING NOT NULL OPTIONS(description = '版本化来源配置 ID'),
  declared_brand_key STRING OPTIONS(description = '上传上下文品牌提示；不能覆盖产品映射品牌；混品牌可空'),
  source_file_name STRING NOT NULL OPTIONS(description = '展示用原文件名，不直接作为 GCS 对象名'),
  source_file_uri STRING NOT NULL OPTIONS(description = '源文件 GCS 路径 gs://.../imports/{batch}/source.ext'),
  source_file_generation STRING OPTIONS(description = '上传完成后锁定的 GCS 对象版本 generation'),
  file_hash STRING OPTIONS(description = '上传完成后的文件字节 SHA256'),
  file_size_bytes INT64 OPTIONS(description = '上传完成后的实测文件大小（字节）'),
  source_exported_at TIMESTAMP OPTIONS(description = '源文件实际导出时间；不是 uploaded_at'),
  source_snapshot_at TIMESTAMP OPTIONS(description = '来源快照/截至时间，有证据才填'),
  coverage_start_date DATE OPTIONS(description = '文件声明覆盖的评论起始日（闭区间）'),
  coverage_end_date DATE OPTIONS(description = '文件声明覆盖的评论结束日（闭区间）'),
  coverage_mode STRING NOT NULL OPTIONS(description = 'full_snapshot/incremental/filtered_sample/unknown'),
  source_filters JSON OPTIONS(description = '星级/产品/日期等源侧筛选；NULL 表示未知'),
  coverage_verified BOOL NOT NULL OPTIONS(description = '默认 false；有可核对证据才 true'),
  template_version STRING NOT NULL OPTIONS(description = '导入模板版本'),
  parser_version STRING NOT NULL OPTIONS(description = '解析器版本'),
  schema_version STRING NOT NULL OPTIONS(description = '字段字典 schema 版本，如 v1.1'),
  uploaded_by STRING NOT NULL OPTIONS(description = '验证后的登录主体 ID'),
  uploaded_at TIMESTAMP NOT NULL OPTIONS(description = '上传/创建批次的系统时间'),
  processing_started_at TIMESTAMP OPTIONS(description = '处理开始时间'),
  completed_at TIMESTAMP OPTIONS(description = '处理完成时间'),
  import_status STRING NOT NULL OPTIONS(description = 'awaiting_upload/queued/running/completed/partial_failed/failed/cancelled/deduplicated'),
  media_status STRING NOT NULL OPTIONS(description = 'not_started/pending/running/completed/partial_failed/unsupported'),
  total_rows INT64 OPTIONS(description = '解析后非空数据行数（不含表头/全空行）'),
  new_rows INT64 OPTIONS(description = '本批新增进入 Core 的源行数'),
  updated_rows INT64 OPTIONS(description = '本批更新类源行数'),
  duplicate_rows INT64 OPTIONS(description = '本批判定为重复的源行数'),
  quarantined_rows INT64 OPTIONS(description = '本批隔离异常源行数'),
  success_rows INT64 OPTIONS(description = 'new_rows + updated_rows；展示用派生值'),
  logical_review_count INT64 OPTIONS(description = '本批已确认观察关联的 DISTINCT review_id 数'),
  error_rows INT64 OPTIONS(description = '等同 quarantined_rows；不是所有警告数'),
  unmapped_rows INT64 OPTIONS(description = '商品映射仍 pending 的质量计数（与去向重叠，勿再相加）'),
  mapping_conflict_rows INT64 OPTIONS(description = '映射冲突行数'),
  text_missing_rows INT64 OPTIONS(description = '无正文/无标题的行数'),
  media_count INT64 OPTIONS(description = '批次媒体引用总数'),
  media_success_count INT64 OPTIONS(description = '媒体归档成功数'),
  media_failed_count INT64 OPTIONS(description = '媒体归档失败数'),
  bq_job_ids ARRAY<STRING> OPTIONS(description = '可重试任务的确定性 BQ Job ID 集合'),
  publication_id STRING OPTIONS(description = '本批成功发布清单 ID'),
  error_code STRING OPTIONS(description = '批次级脱敏错误码'),
  error_message STRING OPTIONS(description = '批次级错误摘要，不写 Token/签名 URL')
)
PARTITION BY DATE(uploaded_at)
OPTIONS (description = '一次逻辑导入及其最新批次汇总（BQ 投影；即时状态在控制库）');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.review_import_error` (
  error_id STRING NOT NULL OPTIONS(description = '异常记录 ID'),
  import_batch_id STRING NOT NULL OPTIONS(description = '所属导入批次'),
  raw_id STRING OPTIONS(description = '关联 Raw 行；批次级错误可空'),
  stage STRING NOT NULL OPTIONS(description = '出错阶段，如 parse/identity/mapping/media'),
  error_code STRING NOT NULL OPTIONS(description = '机器可读错误码，如 bad_date/missing_brand'),
  severity STRING NOT NULL OPTIONS(description = 'error 或 warning'),
  safe_message STRING NOT NULL OPTIONS(description = '可展示的脱敏说明'),
  retryable BOOL NOT NULL OPTIONS(description = '是否可重试'),
  created_at TIMESTAMP NOT NULL OPTIONS(description = '异常创建时间'),
  resolved_at TIMESTAMP OPTIONS(description = '异常解决时间'),
  resolution_event_id STRING OPTIONS(description = '解决事件 ID')
)
PARTITION BY DATE(created_at)
OPTIONS (description = '导入行级/批次异常');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.import_publication_gate` (
  pipeline_id STRING NOT NULL OPTIONS(description = '流水线 ID；首期固定 voc'),
  fencing_token INT64 NOT NULL OPTIONS(description = '发布租约 fencing token'),
  commit_sequence INT64 NOT NULL OPTIONS(description = '提交序号，单调递增'),
  last_publication_id STRING OPTIONS(description = '最近一次成功 publication_id'),
  updated_at TIMESTAMP NOT NULL OPTIONS(description = '门闩最近更新时间')
)
OPTIONS (description = '发布流水线 fencing token；首期 pipeline_id=voc');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.import_publication` (
  publication_id STRING NOT NULL OPTIONS(description = '发布清单 ID'),
  import_batch_id STRING NOT NULL OPTIONS(description = '对应导入批次'),
  fencing_token INT64 NOT NULL OPTIONS(description = '提交时的 fencing token'),
  commit_sequence INT64 NOT NULL OPTIONS(description = '提交序号'),
  bq_job_id STRING NOT NULL OPTIONS(description = '发布所用 BQ Job ID'),
  schema_version STRING NOT NULL OPTIONS(description = '发布时 schema 版本'),
  published_at TIMESTAMP NOT NULL OPTIONS(description = '发布时间')
)
OPTIONS (description = '一次成功提交的内容发布清单');

MERGE `feimei-product-voc.review_control.import_publication_gate` T
USING (SELECT 'voc' AS pipeline_id) S
ON T.pipeline_id = S.pipeline_id
WHEN NOT MATCHED THEN
  INSERT (pipeline_id, fencing_token, commit_sequence, last_publication_id, updated_at)
  VALUES ('voc', 0, 0, NULL, CURRENT_TIMESTAMP());

-- ---------------------------------------------------------------------------
-- review_control.app_user / app_user_access（内部账号与权限；与 007_app_user_access.sql 同步）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.app_user` (
  user_id STRING NOT NULL OPTIONS(description = '稳定内部用户 ID，如 usr_admin'),
  username STRING NOT NULL OPTIONS(description = '登录名，全局唯一（小写建议）'),
  display_name STRING OPTIONS(description = '展示名'),
  password_hash STRING NOT NULL OPTIONS(description = '密码哈希（bcrypt/argon2），禁止明文'),
  status STRING NOT NULL OPTIONS(description = 'active / disabled'),
  is_bootstrap_admin BOOL NOT NULL OPTIONS(description = '是否可进「账号与权限」管理；种子管理员为 true'),
  created_at TIMESTAMP NOT NULL OPTIONS(description = '创建时间'),
  updated_at TIMESTAMP NOT NULL OPTIONS(description = '最近更新时间'),
  created_by STRING OPTIONS(description = '创建人 user_id 或 system'),
  updated_by STRING OPTIONS(description = '最近更新人 user_id 或 system'),
  notes STRING OPTIONS(description = '备注')
)
OPTIONS(description = 'VOC 工作台内部登录账号；一人一行');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.app_user_access` (
  access_id STRING NOT NULL OPTIONS(description = '权限行 ID，如 acc_usr_admin_v1'),
  user_id STRING NOT NULL OPTIONS(description = '关联 app_user.user_id'),
  brand_keys ARRAY<STRING> OPTIONS(description = '允许的 brand_key；[]=无数据；["*"]=全部品牌'),
  country_codes ARRAY<STRING> OPTIONS(description = '允许的国家；[]=不限制国家'),
  can_view_review_text BOOL NOT NULL OPTIONS(description = '是否可看评论原声'),
  can_view_media BOOL NOT NULL OPTIONS(description = '是否可看媒体（占位，无流水线时可 false）'),
  can_export BOOL NOT NULL OPTIONS(description = '是否可导出（功能未做可 false）'),
  can_edit_mapping BOOL NOT NULL OPTIONS(description = '是否可维护产品映射'),
  can_edit_taxonomy BOOL NOT NULL OPTIONS(description = '是否可维护问题分类树'),
  can_manage_users BOOL NOT NULL OPTIONS(description = '是否可管理账号与权限'),
  page_keys ARRAY<STRING> OPTIONS(description = '可访问页面键；["*"]=全部；空则回退到上方粗粒度开关'),
  policy_version INT64 NOT NULL OPTIONS(description = '策略版本号，变更时 +1，用于会话失效'),
  valid_from TIMESTAMP NOT NULL OPTIONS(description = '本行生效时间（含）'),
  valid_to TIMESTAMP OPTIONS(description = '失效时间（不含）；NULL=当前有效'),
  updated_at TIMESTAMP NOT NULL OPTIONS(description = '最近更新时间'),
  updated_by STRING OPTIONS(description = '最近更新人')
)
OPTIONS(description = '内部用户数据范围与动作开关；查询时取 valid_to IS NULL 的当前行');

-- ---------------------------------------------------------------------------
-- review_raw.raw_review_source
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_raw.raw_review_source` (
  raw_id STRING NOT NULL OPTIONS(description = 'SHA256(batch, sheet, row_number)；源行主键'),
  import_batch_id STRING NOT NULL OPTIONS(description = '所属导入批次'),
  source_sheet STRING NOT NULL OPTIONS(description = 'Sheet 原名称；CSV 固定 __csv__'),
  source_row_number INT64 NOT NULL OPTIONS(description = '原文件从 1 开始的物理行号'),
  platform STRING NOT NULL OPTIONS(description = '该行标准平台键'),
  country_code STRING NOT NULL OPTIONS(description = '该行市场国家代码'),
  source_scope_id STRING NOT NULL OPTIONS(description = '该行来源作用域'),
  raw_payload JSON NOT NULL OPTIONS(description = '标准化前的逐列原值'),
  raw_text STRING OPTIONS(description = '若能识别则保留原始正文'),
  source_row_hash STRING NOT NULL OPTIONS(description = '源单元格序列 Hash，排除系统字段'),
  parser_version STRING NOT NULL OPTIONS(description = '本次解析器版本'),
  schema_version STRING NOT NULL OPTIONS(description = '本次 schema 版本'),
  parse_status STRING NOT NULL OPTIONS(description = 'parsed 或 quarantined'),
  parse_error_codes ARRAY<STRING> OPTIONS(description = '解析错误码列表；无错误为空数组'),
  ingested_at TIMESTAMP NOT NULL OPTIONS(description = '本行入库时间')
)
PARTITION BY DATE(ingested_at)
CLUSTER BY import_batch_id, platform, source_scope_id
OPTIONS (description = '批次内每个源数据行（保留原始列值）');

-- ---------------------------------------------------------------------------
-- review_core.fact_review
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_core.fact_review` (
  review_id STRING NOT NULL OPTIONS(description = '稳定逻辑评论 ID'),
  review_version_id STRING NOT NULL OPTIONS(description = '内容版本 ID：SHA256(review_id, version, content_hash)'),
  review_version INT64 NOT NULL OPTIONS(description = '内容版本号，从 1 递增'),
  source_review_id STRING OPTIONS(description = '平台原生评论 ID；可空则走降级指纹'),
  source_review_url STRING OPTIONS(description = '来源页面 URL；仅授权原声可见'),
  identity_namespace STRING NOT NULL OPTIONS(description = '评论身份作用域描述'),
  identity_method STRING NOT NULL OPTIONS(description = 'native_id / fingerprint_v1 / unresolved_observation'),
  identity_rule_version STRING NOT NULL OPTIONS(description = '身份规则版本，如 identity_v1'),
  identity_confidence STRING NOT NULL OPTIONS(description = 'verified / fallback / ambiguous'),
  content_hash STRING NOT NULL OPTIONS(description = '标题/正文/评分/稳定媒体键的内容 Hash'),
  import_batch_id STRING NOT NULL OPTIONS(description = '首次建立该版本的批次'),
  raw_id STRING NOT NULL OPTIONS(description = '首次建立该版本的 Raw 行'),
  source_sheet STRING NOT NULL OPTIONS(description = '源 Sheet 名'),
  source_row_number INT64 NOT NULL OPTIONS(description = '源物理行号'),
  source_row_hash STRING NOT NULL OPTIONS(description = '源行 Hash；不充当 review_id'),
  first_seen_at TIMESTAMP NOT NULL OPTIONS(description = '该版本首次观察时间'),
  source_updated_at TIMESTAMP OPTIONS(description = '源明确提供的更新时间'),
  observed_at TIMESTAMP NOT NULL OPTIONS(description = '该内容观察时间'),
  observation_time_basis STRING NOT NULL OPTIONS(description = 'source_updated/source_snapshot/source_exported/ingested'),
  ingested_at TIMESTAMP NOT NULL OPTIONS(description = '入库时间'),
  schema_version STRING NOT NULL OPTIONS(description = '字段字典版本'),
  platform STRING NOT NULL OPTIONS(description = '标准平台键'),
  source_system STRING NOT NULL OPTIONS(description = '原生评论系统命名空间'),
  country_code STRING NOT NULL OPTIONS(description = '市场国家 ISO 代码'),
  marketplace_id STRING OPTIONS(description = '平台 Marketplace/Site ID'),
  store_id STRING OPTIONS(description = '店铺 ID'),
  seller_id STRING OPTIONS(description = '卖家 ID'),
  authorization_key STRING OPTIONS(description = '授权键血缘，非凭证'),
  source_scope_id STRING NOT NULL OPTIONS(description = '创建本版本的来源作用域'),
  source_timezone STRING OPTIONS(description = 'IANA 时区；仅日期时可空'),
  date_precision STRING NOT NULL OPTIONS(description = 'date / datetime / instant'),
  review_created_at_local DATETIME OPTIONS(description = '无时区本地时间；仅日期时为 NULL'),
  review_created_at_utc TIMESTAMP OPTIONS(description = '可无歧义换算的 UTC 时间'),
  review_date_local DATE NOT NULL OPTIONS(description = '来源市场本地评论日'),
  rating_raw STRING NOT NULL OPTIONS(description = '不修改的源评分字符串'),
  rating_numeric FLOAT64 NOT NULL OPTIONS(description = '解析后的源评分数值'),
  rating_scale_min FLOAT64 NOT NULL OPTIONS(description = '量表下限'),
  rating_scale_max FLOAT64 NOT NULL OPTIONS(description = '量表上限'),
  rating_rule_version STRING NOT NULL OPTIONS(description = '评分转换规则版本'),
  rating_normalized_5 FLOAT64 NOT NULL OPTIONS(description = '归一化到 1～5 星'),
  review_title_original STRING OPTIONS(description = '原始标题；可空'),
  review_text_original STRING OPTIONS(description = '原始正文；可空'),
  review_text_cleaned STRING OPTIONS(description = '清洗派生文本；不覆盖原文'),
  language_code STRING OPTIONS(description = '语言代码；未知不猜'),
  verified_purchase BOOL OPTIONS(description = '是否验证购买；未知为 NULL'),
  helpful_vote_count INT64 OPTIONS(description = '有用票数'),
  review_program STRING OPTIONS(description = 'Vine/激励等项目标记'),
  reviewer_alias_masked STRING OPTIONS(description = '脱敏昵称'),
  reviewer_key_hmac STRING OPTIONS(description = '限定命名空间的用户 HMAC'),
  reviewer_country STRING OPTIONS(description = '买家国家（源明确提供时）'),
  seller_reply_text STRING OPTIONS(description = '商家回复快照'),
  seller_reply_at TIMESTAMP OPTIONS(description = '商家回复时间'),
  order_id STRING OPTIONS(description = '订单号；敏感受限'),
  order_sku STRING OPTIONS(description = '订单 SKU；敏感受限'),
  order_date DATE OPTIONS(description = '下单当地日期'),
  order_created_at_utc TIMESTAMP OPTIONS(description = '下单 UTC 时间'),
  purchase_quantity INT64 OPTIONS(description = '购买件数'),
  currency_code STRING OPTIONS(description = '币种'),
  review_status STRING NOT NULL OPTIONS(description = 'active/hidden/deleted/unknown'),
  status_evidence_type STRING OPTIONS(description = '状态证据类型'),
  status_evidence_ref STRING OPTIONS(description = '状态证据引用'),
  text_available BOOL NOT NULL OPTIONS(description = '标题或正文是否有可分析非空文本'),
  data_quality_status STRING NOT NULL OPTIONS(description = 'valid 或 warning'),
  platform_product_id STRING OPTIONS(description = '平台商品 ID'),
  platform_parent_id STRING OPTIONS(description = '平台父商品 ID'),
  platform_variant_id STRING OPTIONS(description = '平台变体 ID'),
  asin STRING OPTIONS(description = 'Amazon ASIN'),
  parent_asin STRING OPTIONS(description = 'Amazon 父 ASIN'),
  platform_sku STRING OPTIONS(description = '平台/卖家 SKU；空表示店铺评论'),
  platform_product_name STRING OPTIONS(description = '平台商品名（辅助）'),
  platform_variant_name STRING OPTIONS(description = '平台变体名（辅助）'),
  review_scope STRING NOT NULL OPTIONS(description = 'product=商品评论；store=店铺评论（platform_sku 为空时写入）'),
  product_granularity STRING NOT NULL OPTIONS(description = 'parent/product/variant/store/unknown'),
  product_mapping_status STRING NOT NULL OPTIONS(description = 'confirmed/pending/conflict/invalid'),
  mapping_version_id STRING OPTIONS(description = '映射版本 ID'),
  mapping_rule_version STRING OPTIONS(description = '映射规则版本'),
  mapping_publication_id STRING OPTIONS(description = '映射发布批次 ID'),
  mapping_updated_at TIMESTAMP OPTIONS(description = '最近重新映射时间'),
  brand_key STRING OPTIONS(description = '内部品牌键，如 skt/tp'),
  brand_name STRING OPTIONS(description = '品牌显示名'),
  internal_spu STRING OPTIONS(description = '内部 SPU'),
  internal_sku STRING OPTIONS(description = '内部 SKU'),
  product_name_cn STRING OPTIONS(description = '产品中文名'),
  product_name_en STRING OPTIONS(description = '产品英文名'),
  category_l1 STRING OPTIONS(description = '类目一级'),
  category_l2 STRING OPTIONS(description = '类目二级'),
  category_l3 STRING OPTIONS(description = '类目三级'),
  product_family STRING OPTIONS(description = '产品系列'),
  product_type STRING OPTIONS(description = '产品类型'),
  product_status STRING OPTIONS(description = '产品状态'),
  variant_name STRING OPTIONS(description = '变体名称'),
  shade_name STRING OPTIONS(description = '色号名'),
  size_or_volume STRING OPTIONS(description = '规格/容量')
)
PARTITION BY review_date_local
CLUSTER BY brand_key, internal_spu, platform, review_id
OPTIONS (description = '评论内容版本事实表');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_core.review_source_observation` (
  observation_id STRING NOT NULL OPTIONS(description = '观察记录 ID'),
  raw_id STRING NOT NULL OPTIONS(description = '对应 Raw 行；唯一'),
  import_batch_id STRING NOT NULL OPTIONS(description = '观察所属批次'),
  review_id STRING NOT NULL OPTIONS(description = '逻辑评论 ID'),
  review_version_id STRING OPTIONS(description = '绑定的内容版本；未确认可空'),
  source_scope_id STRING NOT NULL OPTIONS(description = '观察来源作用域'),
  source_snapshot_at TIMESTAMP OPTIONS(description = '源快照时间'),
  observed_at TIMESTAMP NOT NULL OPTIONS(description = '观察时间'),
  ingested_at TIMESTAMP NOT NULL OPTIONS(description = '入库时间'),
  observation_time_basis STRING NOT NULL OPTIONS(description = '观察时间依据'),
  observed_content_hash STRING NOT NULL OPTIONS(description = '此次观察到的内容 Hash'),
  version_order_status STRING NOT NULL OPTIONS(description = 'confirmed/historical/pending_review'),
  source_review_status STRING OPTIONS(description = '源侧评论状态'),
  helpful_vote_count INT64 OPTIONS(description = '此次观察的有用票数'),
  seller_reply_text STRING OPTIONS(description = '此次观察的商家回复'),
  seller_reply_at TIMESTAMP OPTIONS(description = '商家回复时间'),
  status_evidence_ref STRING OPTIONS(description = '状态证据引用')
)
PARTITION BY DATE(observed_at)
CLUSTER BY review_id, import_batch_id, source_scope_id
OPTIONS (description = '源行观察到的评论版本血缘');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_core.dim_product_mapping` (
  mapping_version_id STRING NOT NULL OPTIONS(description = '不可变映射版本 ID'),
  mapping_publication_id STRING NOT NULL OPTIONS(description = '映射发布批次 ID'),
  platform STRING NOT NULL OPTIONS(description = '平台'),
  country_code STRING NOT NULL OPTIONS(description = '市场'),
  marketplace_id STRING OPTIONS(description = 'Marketplace ID'),
  store_id STRING OPTIONS(description = '店铺 ID'),
  authorization_key STRING OPTIONS(description = '授权键血缘'),
  product_scope_id STRING NOT NULL OPTIONS(description = '按平台规则生成的产品作用域'),
  alias_type STRING NOT NULL OPTIONS(description = 'variant_id/seller_sku/asin/product_id'),
  alias_value STRING NOT NULL OPTIONS(description = '平台侧别名键值'),
  parent_product_id STRING OPTIONS(description = '父商品上下文；部分平台必填'),
  platform_product_id STRING OPTIONS(description = '平台商品 ID'),
  platform_parent_id STRING OPTIONS(description = '平台父 ID'),
  platform_variant_id STRING OPTIONS(description = '平台变体 ID'),
  asin STRING OPTIONS(description = 'ASIN'),
  platform_sku STRING OPTIONS(description = '平台 SKU'),
  brand_key STRING OPTIONS(description = '内部品牌键；confirmed 时必填'),
  internal_spu STRING OPTIONS(description = '内部 SPU'),
  internal_sku STRING OPTIONS(description = '内部 SKU；可只到 SPU'),
  mapping_granularity STRING NOT NULL OPTIONS(description = 'spu/sku/brand_only'),
  product_name_cn STRING OPTIONS(description = '批准的中文名'),
  product_name_en STRING OPTIONS(description = '批准的英文名'),
  brand_name STRING OPTIONS(description = '品牌显示名'),
  category_l1 STRING OPTIONS(description = '类目一级'),
  category_l2 STRING OPTIONS(description = '类目二级'),
  category_l3 STRING OPTIONS(description = '类目三级'),
  product_family STRING OPTIONS(description = '产品系列'),
  product_type STRING OPTIONS(description = '产品类型'),
  product_status STRING OPTIONS(description = '产品状态'),
  variant_name STRING OPTIONS(description = '变体名'),
  shade_name STRING OPTIONS(description = '色号名'),
  size_or_volume STRING OPTIONS(description = '规格/容量'),
  valid_from TIMESTAMP NOT NULL OPTIONS(description = '有效期起点（含）'),
  valid_to TIMESTAMP OPTIONS(description = '有效期终点（不含）；NULL=仍有效'),
  mapping_status STRING NOT NULL OPTIONS(description = 'confirmed/pending/conflict/invalid'),
  mapping_method STRING NOT NULL OPTIONS(description = 'master_data/manual/rule/ai_suggestion'),
  mapping_confidence FLOAT64 OPTIONS(description = '建议评分，不代替审批'),
  mapping_rule_version STRING NOT NULL OPTIONS(description = '映射规则版本'),
  approved_by STRING OPTIONS(description = '确认人'),
  approved_at TIMESTAMP OPTIONS(description = '确认时间'),
  source_reference STRING NOT NULL OPTIONS(description = '主数据/人工表/审核事件来源')
)
CLUSTER BY product_scope_id, alias_type, alias_value, brand_key
OPTIONS (description = '平台别名到内部产品映射（有版本与有效期）');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_core.fact_review_media` (
  media_id STRING NOT NULL OPTIONS(description = '媒体 ID'),
  review_id STRING NOT NULL OPTIONS(description = '逻辑评论 ID'),
  review_version_id STRING NOT NULL OPTIONS(description = '内容版本 ID'),
  import_batch_id STRING NOT NULL OPTIONS(description = '首次发现批次'),
  media_index INT64 NOT NULL OPTIONS(description = '来源顺序，从 1 起'),
  media_type STRING NOT NULL OPTIONS(description = 'image/video/unknown'),
  source_media_key STRING NOT NULL OPTIONS(description = '平台稳定媒体键或 URL 身份'),
  source_media_url STRING NOT NULL OPTIONS(description = '完整源 URL（受限保存）'),
  source_first_seen_at TIMESTAMP NOT NULL OPTIONS(description = '首次看到该媒体引用的时间'),
  review_date_local DATE NOT NULL OPTIONS(description = '继承评论日期，用于分区'),
  gcs_uri STRING OPTIONS(description = '归档 originals 路径；success 时必填'),
  gcs_generation STRING OPTIONS(description = 'GCS 对象 generation'),
  safe_display_gcs_uri STRING OPTIONS(description = '安全展示副本路径'),
  safe_display_generation STRING OPTIONS(description = '展示副本 generation'),
  sha256_hash STRING OPTIONS(description = '原文件字节 Hash'),
  mime_type STRING OPTIONS(description = '检测确认的 MIME'),
  file_extension STRING OPTIONS(description = '扩展名'),
  file_size_bytes INT64 OPTIONS(description = '实测字节数'),
  width INT64 OPTIONS(description = '图片宽'),
  height INT64 OPTIONS(description = '图片高'),
  duration_seconds FLOAT64 OPTIONS(description = '视频时长；阶段一默认不转码'),
  download_status STRING NOT NULL OPTIONS(description = 'pending/downloading/success/failed/expired/unsupported'),
  download_error_code STRING OPTIONS(description = '下载错误码'),
  download_error STRING OPTIONS(description = '下载错误脱敏说明'),
  download_attempts INT64 NOT NULL OPTIONS(description = '累计尝试次数，最多 3'),
  next_retry_at TIMESTAMP OPTIONS(description = '下次重试时间'),
  lease_expires_at TIMESTAMP OPTIONS(description = '下载租约过期时间'),
  downloaded_at TIMESTAMP OPTIONS(description = '下载成功时间'),
  created_at TIMESTAMP NOT NULL OPTIONS(description = '记录创建时间'),
  updated_at TIMESTAMP NOT NULL OPTIONS(description = '记录更新时间'),
  security_scan_status STRING NOT NULL OPTIONS(description = 'pending/passed/rejected/unsupported'),
  privacy_review_status STRING NOT NULL OPTIONS(description = 'pending/cleared/redacted/restricted'),
  is_duplicate_media BOOL NOT NULL OPTIONS(description = '是否复用已有相同字节媒体'),
  duplicate_media_id STRING OPTIONS(description = '指向原媒体 media_id')
)
PARTITION BY review_date_local
CLUSTER BY review_id, review_version_id, download_status
OPTIONS (description = '评论媒体引用与归档状态');

-- ---------------------------------------------------------------------------
-- review_serving views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW `feimei-product-voc.review_serving.v_review_current`
(
  review_id OPTIONS(description = '稳定逻辑评论 ID'),
  review_version_id OPTIONS(description = '内容版本 ID：SHA256(review_id, version, content_hash)'),
  review_version OPTIONS(description = '内容版本号，从 1 递增'),
  source_review_id OPTIONS(description = '平台原生评论 ID；可空则走降级指纹'),
  source_review_url OPTIONS(description = '来源页面 URL；仅授权原声可见'),
  identity_namespace OPTIONS(description = '评论身份作用域描述'),
  identity_method OPTIONS(description = 'native_id / fingerprint_v1 / unresolved_observation'),
  identity_rule_version OPTIONS(description = '身份规则版本，如 identity_v1'),
  identity_confidence OPTIONS(description = 'verified / fallback / ambiguous'),
  content_hash OPTIONS(description = '标题/正文/评分/稳定媒体键的内容 Hash'),
  import_batch_id OPTIONS(description = '首次建立该版本的批次'),
  raw_id OPTIONS(description = '首次建立该版本的 Raw 行'),
  source_sheet OPTIONS(description = '源 Sheet 名'),
  source_row_number OPTIONS(description = '源物理行号'),
  source_row_hash OPTIONS(description = '源行 Hash；不充当 review_id'),
  first_seen_at OPTIONS(description = '该版本首次观察时间'),
  source_updated_at OPTIONS(description = '源明确提供的更新时间'),
  observed_at OPTIONS(description = '该内容观察时间'),
  observation_time_basis OPTIONS(description = 'source_updated/source_snapshot/source_exported/ingested'),
  ingested_at OPTIONS(description = '入库时间'),
  schema_version OPTIONS(description = '字段字典版本'),
  platform OPTIONS(description = '标准平台键'),
  source_system OPTIONS(description = '原生评论系统命名空间'),
  country_code OPTIONS(description = '市场国家 ISO 代码'),
  marketplace_id OPTIONS(description = '平台 Marketplace/Site ID'),
  store_id OPTIONS(description = '店铺 ID'),
  seller_id OPTIONS(description = '卖家 ID'),
  authorization_key OPTIONS(description = '授权键血缘，非凭证'),
  source_scope_id OPTIONS(description = '创建本版本的来源作用域'),
  source_timezone OPTIONS(description = 'IANA 时区；仅日期时可空'),
  date_precision OPTIONS(description = 'date / datetime / instant'),
  review_created_at_local OPTIONS(description = '无时区本地时间；仅日期时为 NULL'),
  review_created_at_utc OPTIONS(description = '可无歧义换算的 UTC 时间'),
  review_date_local OPTIONS(description = '来源市场本地评论日'),
  rating_raw OPTIONS(description = '不修改的源评分字符串'),
  rating_numeric OPTIONS(description = '解析后的源评分数值'),
  rating_scale_min OPTIONS(description = '量表下限'),
  rating_scale_max OPTIONS(description = '量表上限'),
  rating_rule_version OPTIONS(description = '评分转换规则版本'),
  rating_normalized_5 OPTIONS(description = '归一化到 1～5 星'),
  review_title_original OPTIONS(description = '原始标题；可空'),
  review_text_original OPTIONS(description = '原始正文；可空'),
  review_text_cleaned OPTIONS(description = '清洗派生文本；不覆盖原文'),
  language_code OPTIONS(description = '语言代码；未知不猜'),
  verified_purchase OPTIONS(description = '是否验证购买；未知为 NULL'),
  helpful_vote_count OPTIONS(description = '有用票数'),
  review_program OPTIONS(description = 'Vine/激励等项目标记'),
  reviewer_alias_masked OPTIONS(description = '脱敏昵称'),
  reviewer_key_hmac OPTIONS(description = '限定命名空间的用户 HMAC'),
  reviewer_country OPTIONS(description = '买家国家（源明确提供时）'),
  seller_reply_text OPTIONS(description = '商家回复快照'),
  seller_reply_at OPTIONS(description = '商家回复时间'),
  order_id OPTIONS(description = '订单号；敏感受限'),
  order_sku OPTIONS(description = '订单 SKU；敏感受限'),
  order_date OPTIONS(description = '下单当地日期'),
  order_created_at_utc OPTIONS(description = '下单 UTC 时间'),
  purchase_quantity OPTIONS(description = '购买件数'),
  currency_code OPTIONS(description = '币种'),
  review_status OPTIONS(description = 'active/hidden/deleted/unknown'),
  status_evidence_type OPTIONS(description = '状态证据类型'),
  status_evidence_ref OPTIONS(description = '状态证据引用'),
  text_available OPTIONS(description = '标题或正文是否有可分析非空文本'),
  data_quality_status OPTIONS(description = 'valid 或 warning'),
  platform_product_id OPTIONS(description = '平台商品 ID'),
  platform_parent_id OPTIONS(description = '平台父商品 ID'),
  platform_variant_id OPTIONS(description = '平台变体 ID'),
  asin OPTIONS(description = 'Amazon ASIN'),
  parent_asin OPTIONS(description = 'Amazon 父 ASIN'),
  platform_sku OPTIONS(description = '平台/卖家 SKU；空表示店铺评论'),
  platform_product_name OPTIONS(description = '平台商品名（辅助）'),
  platform_variant_name OPTIONS(description = '平台变体名（辅助）'),
  review_scope OPTIONS(description = 'product=商品评论；store=店铺评论（platform_sku 为空时写入）'),
  product_granularity OPTIONS(description = 'parent/product/variant/store/unknown'),
  product_mapping_status OPTIONS(description = 'confirmed/pending/conflict/invalid'),
  mapping_version_id OPTIONS(description = '映射版本 ID'),
  mapping_rule_version OPTIONS(description = '映射规则版本'),
  mapping_publication_id OPTIONS(description = '映射发布批次 ID'),
  mapping_updated_at OPTIONS(description = '最近重新映射时间'),
  brand_key OPTIONS(description = '内部品牌键，如 skt/tp'),
  brand_name OPTIONS(description = '品牌显示名'),
  internal_spu OPTIONS(description = '内部 SPU'),
  internal_sku OPTIONS(description = '内部 SKU'),
  product_name_cn OPTIONS(description = '产品中文名'),
  product_name_en OPTIONS(description = '产品英文名'),
  category_l1 OPTIONS(description = '类目一级'),
  category_l2 OPTIONS(description = '类目二级'),
  category_l3 OPTIONS(description = '类目三级'),
  product_family OPTIONS(description = '产品系列'),
  product_type OPTIONS(description = '产品类型'),
  product_status OPTIONS(description = '产品状态'),
  variant_name OPTIONS(description = '变体名称'),
  shade_name OPTIONS(description = '色号名'),
  size_or_volume OPTIONS(description = '规格/容量'),
  is_current_version OPTIONS(description = '是否为当前有效内容版本；本视图恒为 TRUE')
)
OPTIONS (
  description = '服务层：每个 review_id 只保留当前有效内容版本（取最大 review_version，排除 deleted）。看板/API 读评论用此视图；数据来自 fact_review，导入后即可查到，无需单独同步。'
)
AS
SELECT
  fr.review_id,
  fr.review_version_id,
  fr.review_version,
  fr.source_review_id,
  fr.source_review_url,
  fr.identity_namespace,
  fr.identity_method,
  fr.identity_rule_version,
  fr.identity_confidence,
  fr.content_hash,
  fr.import_batch_id,
  fr.raw_id,
  fr.source_sheet,
  fr.source_row_number,
  fr.source_row_hash,
  fr.first_seen_at,
  fr.source_updated_at,
  fr.observed_at,
  fr.observation_time_basis,
  fr.ingested_at,
  fr.schema_version,
  fr.platform,
  fr.source_system,
  fr.country_code,
  fr.marketplace_id,
  fr.store_id,
  fr.seller_id,
  fr.authorization_key,
  fr.source_scope_id,
  fr.source_timezone,
  fr.date_precision,
  fr.review_created_at_local,
  fr.review_created_at_utc,
  fr.review_date_local,
  fr.rating_raw,
  fr.rating_numeric,
  fr.rating_scale_min,
  fr.rating_scale_max,
  fr.rating_rule_version,
  fr.rating_normalized_5,
  fr.review_title_original,
  fr.review_text_original,
  fr.review_text_cleaned,
  fr.language_code,
  fr.verified_purchase,
  fr.helpful_vote_count,
  fr.review_program,
  fr.reviewer_alias_masked,
  fr.reviewer_key_hmac,
  fr.reviewer_country,
  fr.seller_reply_text,
  fr.seller_reply_at,
  fr.order_id,
  fr.order_sku,
  fr.order_date,
  fr.order_created_at_utc,
  fr.purchase_quantity,
  fr.currency_code,
  fr.review_status,
  fr.status_evidence_type,
  fr.status_evidence_ref,
  fr.text_available,
  fr.data_quality_status,
  fr.platform_product_id,
  fr.platform_parent_id,
  fr.platform_variant_id,
  fr.asin,
  fr.parent_asin,
  fr.platform_sku,
  fr.platform_product_name,
  fr.platform_variant_name,
  fr.review_scope,
  fr.product_granularity,
  fr.product_mapping_status,
  fr.mapping_version_id,
  fr.mapping_rule_version,
  fr.mapping_publication_id,
  fr.mapping_updated_at,
  fr.brand_key,
  fr.brand_name,
  fr.internal_spu,
  fr.internal_sku,
  fr.product_name_cn,
  fr.product_name_en,
  fr.category_l1,
  fr.category_l2,
  fr.category_l3,
  fr.product_family,
  fr.product_type,
  fr.product_status,
  fr.variant_name,
  fr.shade_name,
  fr.size_or_volume,
  TRUE AS is_current_version
FROM `feimei-product-voc.review_core.fact_review` fr
INNER JOIN (
  SELECT review_id, MAX(review_version) AS max_version
  FROM `feimei-product-voc.review_core.fact_review`
  WHERE review_status != 'deleted'
  GROUP BY review_id
) cur
ON fr.review_id = cur.review_id
AND fr.review_version = cur.max_version
WHERE fr.review_status != 'deleted';

CREATE OR REPLACE VIEW `feimei-product-voc.review_serving.v_review_media`
(
  media_id OPTIONS(description = '媒体 ID'),
  review_id OPTIONS(description = '逻辑评论 ID'),
  review_version_id OPTIONS(description = '内容版本 ID'),
  import_batch_id OPTIONS(description = '首次发现批次'),
  media_index OPTIONS(description = '来源顺序，从 1 起'),
  media_type OPTIONS(description = 'image/video/unknown'),
  source_media_key OPTIONS(description = '平台稳定媒体键或 URL 身份'),
  source_media_url OPTIONS(description = '完整源 URL（受限保存）'),
  source_first_seen_at OPTIONS(description = '首次看到该媒体引用的时间'),
  review_date_local OPTIONS(description = '继承评论日期，用于分区'),
  gcs_uri OPTIONS(description = '归档 originals 路径；success 时必填'),
  gcs_generation OPTIONS(description = 'GCS 对象 generation'),
  safe_display_gcs_uri OPTIONS(description = '安全展示副本路径'),
  safe_display_generation OPTIONS(description = '展示副本 generation'),
  sha256_hash OPTIONS(description = '原文件字节 Hash'),
  mime_type OPTIONS(description = '检测确认的 MIME'),
  file_extension OPTIONS(description = '扩展名'),
  file_size_bytes OPTIONS(description = '实测字节数'),
  width OPTIONS(description = '图片宽'),
  height OPTIONS(description = '图片高'),
  duration_seconds OPTIONS(description = '视频时长；阶段一默认不转码'),
  download_status OPTIONS(description = 'pending/downloading/success/failed/expired/unsupported'),
  download_error_code OPTIONS(description = '下载错误码'),
  download_error OPTIONS(description = '下载错误脱敏说明'),
  download_attempts OPTIONS(description = '累计尝试次数，最多 3'),
  next_retry_at OPTIONS(description = '下次重试时间'),
  lease_expires_at OPTIONS(description = '下载租约过期时间'),
  downloaded_at OPTIONS(description = '下载成功时间'),
  created_at OPTIONS(description = '记录创建时间'),
  updated_at OPTIONS(description = '记录更新时间'),
  security_scan_status OPTIONS(description = 'pending/passed/rejected/unsupported'),
  privacy_review_status OPTIONS(description = 'pending/cleared/redacted/restricted'),
  is_duplicate_media OPTIONS(description = '是否复用已有相同字节媒体'),
  duplicate_media_id OPTIONS(description = '指向原媒体 media_id')
)
OPTIONS (
  description = '服务层：可展示媒体投影（下载成功且安全/隐私通过）。数据来自 fact_review_media。'
)
AS
SELECT
  m.media_id,
  m.review_id,
  m.review_version_id,
  m.import_batch_id,
  m.media_index,
  m.media_type,
  m.source_media_key,
  m.source_media_url,
  m.source_first_seen_at,
  m.review_date_local,
  m.gcs_uri,
  m.gcs_generation,
  m.safe_display_gcs_uri,
  m.safe_display_generation,
  m.sha256_hash,
  m.mime_type,
  m.file_extension,
  m.file_size_bytes,
  m.width,
  m.height,
  m.duration_seconds,
  m.download_status,
  m.download_error_code,
  m.download_error,
  m.download_attempts,
  m.next_retry_at,
  m.lease_expires_at,
  m.downloaded_at,
  m.created_at,
  m.updated_at,
  m.security_scan_status,
  m.privacy_review_status,
  m.is_duplicate_media,
  m.duplicate_media_id
FROM `feimei-product-voc.review_core.fact_review_media` m
WHERE m.download_status = 'success'
  AND m.security_scan_status = 'passed'
  AND m.privacy_review_status IN ('cleared', 'redacted');

-- ---------------------------------------------------------------------------
-- review_semantic.dim_issue_taxonomy（问题分类树；与 006_dim_issue_taxonomy.sql 同步）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_semantic.dim_issue_taxonomy` (
  issue_id STRING NOT NULL OPTIONS(description = '问题分类稳定 ID，如 l1_safety / l2_allergy'),
  taxonomy_version STRING NOT NULL OPTIONS(description = '分类树版本号，如 v1'),
  parent_issue_id STRING OPTIONS(description = '父级 issue_id；L1 为空'),
  issue_level INT64 NOT NULL OPTIONS(description = '1=L1 / 2=L2 / 3=L3'),
  issue_name_cn STRING NOT NULL OPTIONS(description = '中文名称'),
  issue_name_en STRING OPTIONS(description = '英文名称'),
  issue_description STRING OPTIONS(description = '定义说明'),
  positive_examples ARRAY<STRING> OPTIONS(description = '包含样例'),
  negative_examples ARRAY<STRING> OPTIONS(description = '排除样例'),
  exclusion_rules ARRAY<STRING> OPTIONS(description = '排除规则说明'),
  issue_owner_team STRING OPTIONS(description = '责任域/团队'),
  default_severity INT64 OPTIONS(description = '默认严重度 1～5'),
  is_safety_related BOOL OPTIONS(description = '是否安全/刺激相关'),
  is_product_controllable BOOL OPTIONS(description = '是否产品可控'),
  is_logistics_related BOOL OPTIONS(description = '是否物流履约相关'),
  active_status STRING NOT NULL OPTIONS(description = 'active / inactive'),
  valid_from TIMESTAMP NOT NULL OPTIONS(description = '本版本行生效时间（含）'),
  valid_to TIMESTAMP OPTIONS(description = '失效时间（不含）；NULL=仍有效'),
  updated_by STRING OPTIONS(description = '最近写入操作者'),
  source_reference STRING OPTIONS(description = '来源说明，如 schema_8_3 / excel')
)
OPTIONS(description = '固定问题分类树；按 issue_id + taxonomy_version 版本化，valid_to 做覆盖');

-- ---------------------------------------------------------------------------
-- review_semantic.analysis_run / fact_review_segment / fact_review_issue（与 008_analysis_run.sql 同步）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_semantic.analysis_run` (
  analysis_run_id STRING NOT NULL OPTIONS(description = '一次分析任务 ID'),
  review_id STRING OPTIONS(description = '评论逻辑 ID；报告按批次汇总用'),
  review_version_id STRING NOT NULL OPTIONS(description = '绑定评论版本；勿只靠 review_id'),
  batch_id STRING OPTIONS(description = '同一次「差评分析」按钮触发的批次 ID（工程扩展）'),
  input_hash STRING NOT NULL OPTIONS(description = '原文+taxonomy+prompt/model 版本哈希'),
  model_version STRING NOT NULL OPTIONS(description = '模型版本，如 stub-v1 / gpt-…'),
  prompt_version STRING NOT NULL OPTIONS(description = 'Prompt 版本'),
  taxonomy_version STRING NOT NULL OPTIONS(description = '分类树版本'),
  analysis_status STRING NOT NULL OPTIONS(description = 'queued/running/succeeded/failed/pending_review'),
  started_at TIMESTAMP OPTIONS(description = '开始时间'),
  finished_at TIMESTAMP OPTIONS(description = '结束时间'),
  error_code STRING OPTIONS(description = '失败或复核原因码')
)
OPTIONS(description = '评论文本分析 run；按 analysis_run_id 版本化，可重跑');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_semantic.fact_review_segment` (
  segment_id STRING NOT NULL OPTIONS(description = '片段 ID'),
  review_id STRING NOT NULL,
  review_version_id STRING NOT NULL,
  analysis_run_id STRING NOT NULL,
  segment_index INT64 NOT NULL OPTIONS(description = '片段序号，从 0'),
  segment_text_original STRING NOT NULL,
  segment_text_translated_cn STRING,
  segment_text_translated_en STRING,
  aspect_term STRING,
  opinion_term STRING,
  sentiment STRING NOT NULL OPTIONS(description = 'positive/neutral/negative'),
  sentiment_score FLOAT64,
  evidence_start INT64 NOT NULL OPTIONS(description = '原文 Unicode code point 起点（含）'),
  evidence_end INT64 NOT NULL OPTIONS(description = '原文 Unicode code point 终点（不含）'),
  segment_confidence FLOAT64,
  model_version STRING NOT NULL,
  prompt_version STRING NOT NULL
)
OPTIONS(description = '评论拆句/观点片段；正式统计不直接用片段，需挂 issue');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_semantic.fact_review_issue` (
  review_issue_id STRING NOT NULL OPTIONS(description = '正式问题明细 ID'),
  review_id STRING NOT NULL,
  review_version_id STRING NOT NULL,
  segment_id STRING NOT NULL,
  analysis_run_id STRING NOT NULL,
  issue_l1_id STRING NOT NULL,
  issue_l2_id STRING,
  issue_l3_id STRING,
  issue_polarity STRING NOT NULL OPTIONS(description = 'negative/positive/neutral'),
  severity_level INT64,
  responsible_domain STRING,
  evidence_quote_original STRING NOT NULL OPTIONS(description = '证据原文；无证据不上正式表'),
  evidence_quote_translated STRING,
  classification_confidence FLOAT64,
  cluster_id STRING,
  is_new_issue_candidate BOOL,
  is_safety_related BOOL,
  is_product_controllable BOOL,
  model_version STRING NOT NULL,
  prompt_version STRING NOT NULL,
  taxonomy_version STRING NOT NULL
)
OPTIONS(description = '正式问题明细；仅通过门槛的结果进看板 Top 统计');

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_semantic.analysis_batch` (
  batch_id STRING NOT NULL OPTIONS(description = '一次「差评分析」按钮触发的批次 ID'),
  analysis_status STRING NOT NULL OPTIONS(description = 'queued/running/succeeded/failed/partial'),
  total_count INT64 NOT NULL,
  succeeded_count INT64 NOT NULL,
  failed_count INT64 NOT NULL,
  pending_review_count INT64 NOT NULL,
  formal_issue_count INT64 NOT NULL,
  model_version STRING NOT NULL,
  prompt_version STRING NOT NULL,
  taxonomy_version STRING NOT NULL,
  filter_snapshot_json STRING OPTIONS(description = '创建时筛选 JSON'),
  created_by STRING OPTIONS(description = '触发人 username'),
  created_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  error_message STRING
)
OPTIONS(description = '差评分析批次汇总；明细见 analysis_run / segment / issue');
