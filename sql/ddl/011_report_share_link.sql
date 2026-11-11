-- review_control.report_share_link（差评报告分享短链，7 天有效）
-- 用法：已有环境可只跑本文件

CREATE TABLE IF NOT EXISTS `feimei-product-voc.review_control.report_share_link` (
  share_token STRING NOT NULL OPTIONS(description = '对外短链 token，不暴露 batch_id'),
  batch_id STRING NOT NULL OPTIONS(description = '关联 analysis_batch.batch_id'),
  created_by STRING OPTIONS(description = '创建人 username'),
  created_at TIMESTAMP NOT NULL OPTIONS(description = '创建时间'),
  expires_at TIMESTAMP NOT NULL OPTIONS(description = '过期时间（创建后 7 天）')
)
OPTIONS(description = '差评分析报告公开分享短链；凭 token 免登录读报告');
