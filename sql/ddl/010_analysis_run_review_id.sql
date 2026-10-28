-- 给已有 analysis_run 补 review_id（报告按批次拉评论列表需要）
-- 新环境：base_tables / 008 已含该列则本文件可跳过（ADD COLUMN IF NOT EXISTS 需 BQ 支持）

ALTER TABLE `feimei-product-voc.review_semantic.analysis_run`
ADD COLUMN IF NOT EXISTS review_id STRING
OPTIONS(description = '评论逻辑 ID；与 review_version_id 配套，便于按批次出报告');
