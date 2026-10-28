-- review_control.app_user / app_user_access（内部账号与权限，H04 裁剪版）
-- 依据：docs/products/账号与权限管理实施说明.md
-- 同步：已并入 sql/ddl/base_tables.sql（整库重建时跑 base 即可）
-- 用法：已有库只需增量执行本文件（dataset 已存在，无需 CREATE SCHEMA）
-- 说明：仅系统内开账号；不做 Google 登录。密码存哈希，禁止明文。

-- ---------------------------------------------------------------------------
-- 1) 用户账号
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

-- ---------------------------------------------------------------------------
-- 2) 访问权限（一人一行当前有效策略；改权限可 UPDATE 或先关 valid_to 再插新行）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.app_user_access` (
  access_id STRING NOT NULL OPTIONS(description = '权限行 ID，如 acc_usr_admin_v1'),
  user_id STRING NOT NULL OPTIONS(description = '关联 app_user.user_id'),
  -- ARRAY 在 BQ 不能声明 NOT NULL（NULL 与 [] 等价，写入时请用 []）
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
-- 使用约定（实现时遵守）
-- ---------------------------------------------------------------------------
-- 1. 登录：username + 校验 password_hash；status 必须为 active；且存在有效 access 行。
-- 2. brand_keys = [] → 拒绝读业务数据；brand_keys 含 '*' → 全局读者（慎用）。
-- 3. 禁止把 brand_keys NULL/缺省当成「全部」。
-- 4. 未映射评论不得靠 brand IS NULL 越权；按来源上下文 + 授权品牌过滤。
-- 5. 种子管理员：先 INSERT app_user + app_user_access（可用脚本生成 password_hash），
--    勿把明文密码写进本 SQL 仓库。
--
-- 查询当前有效权限示例：
--   SELECT u.*, a.*
--   FROM `feimei-product-voc.review_control.app_user` u
--   JOIN `feimei-product-voc.review_control.app_user_access` a
--     ON a.user_id = u.user_id AND a.valid_to IS NULL
--   WHERE u.username = @username AND u.status = 'active';
