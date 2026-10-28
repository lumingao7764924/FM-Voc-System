-- review_semantic.analysis_batch（差评分析批次历史，Step 5）
-- 同步：已并入 sql/ddl/base_tables.sql
-- 用法：已有环境可只跑本文件

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
