-- review_semantic.dim_issue_taxonomy（问题分类树，阶段二 Step 4）
-- 依据：统一评论字段字典 / 方案 8.3、11.3
-- 同步：已并入 sql/ddl/base_tables.sql
-- 用法：已有环境可只跑本文件；新环境优先跑 base_tables.sql 全文

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
