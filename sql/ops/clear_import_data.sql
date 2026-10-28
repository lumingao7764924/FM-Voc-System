-- =============================================================================
-- 清空 VOC BigQuery 对象（对标 sql/ddl/base_tables.sql 全部建表/视图）
--
-- 用法（两步）：
-- 1) 先跑本文件：DROP 全部相关表与视图
-- 2) 再跑 sql/ddl/base_tables.sql 全文：按正确分区/聚类重建空表 + 刷新视图 + 种子 gate
--
-- 注意：会删掉 dim_product_mapping、import_publication_gate 等全部对象，不可恢复。
-- =============================================================================

-- 视图先删（依赖下层表）
DROP VIEW IF EXISTS `feimei-product-voc.review_serving.v_review_media`;
DROP VIEW IF EXISTS `feimei-product-voc.review_serving.v_review_current`;

-- review_core
DROP TABLE IF EXISTS `feimei-product-voc.review_core.fact_review_media`;
DROP TABLE IF EXISTS `feimei-product-voc.review_core.review_source_observation`;
DROP TABLE IF EXISTS `feimei-product-voc.review_core.fact_review`;
DROP TABLE IF EXISTS `feimei-product-voc.review_core.dim_product_mapping`;

-- review_raw
DROP TABLE IF EXISTS `feimei-product-voc.review_raw.raw_review_source`;

-- review_control
DROP TABLE IF EXISTS `feimei-product-voc.review_control.app_user_access`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.app_user`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.source_row_hash_registry`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.review_import_error`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.import_publication`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.import_publication_gate`;
DROP TABLE IF EXISTS `feimei-product-voc.review_control.review_import_batch`;

-- review_semantic
DROP TABLE IF EXISTS `feimei-product-voc.review_semantic.fact_review_issue`;
DROP TABLE IF EXISTS `feimei-product-voc.review_semantic.fact_review_segment`;
DROP TABLE IF EXISTS `feimei-product-voc.review_semantic.analysis_run`;
DROP TABLE IF EXISTS `feimei-product-voc.review_semantic.analysis_batch`;
DROP TABLE IF EXISTS `feimei-product-voc.review_semantic.dim_issue_taxonomy`;

-- 下一步（必做）：在控制台打开并运行 sql/ddl/base_tables.sql 全文
-- 然后重启本地 API，刷新「上传历史」
