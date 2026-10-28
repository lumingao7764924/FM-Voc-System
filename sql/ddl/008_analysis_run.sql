-- review_semantic.analysis_run / fact_review_segment / fact_review_issue（Step 5 AI 语义分析）
-- 依据：统一评论字段字典 §12；docs/products/AI语义分析实施说明.md
-- 同步：已并入 sql/ddl/base_tables.sql
-- 用法：已有环境可只跑本文件；新环境优先跑 base_tables.sql 全文

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
