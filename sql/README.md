# BigQuery DDL

## 基础建表（新环境）

文件：`ddl/base_tables.sql`（含字段 description + 查重索引表 `source_row_hash_registry` + 分类树 + 内部账号）

| 数据集 | 对象 |
|---|---|
| `review_control` | `review_import_batch`, `review_import_error`, `source_row_hash_registry`, `import_publication_gate`, `import_publication`, **`app_user`**, **`app_user_access`** |
| `review_raw` | `raw_review_source` |
| `review_core` | `fact_review`, `review_source_observation`, `dim_product_mapping`, `fact_review_media` |
| `review_serving` | `v_review_current`, `v_review_media`（视图） |
| `review_semantic` | **`dim_issue_taxonomy`**, **`analysis_batch`**, **`analysis_run`**, **`fact_review_segment`**, **`fact_review_issue`** |

## 在控制台执行

1. 打开 [BigQuery](https://console.cloud.google.com/bigquery?project=feimei-product-voc)
2. 确认项目为 `feimei-product-voc`
3. 粘贴 `base_tables.sql` 全文 → 运行（`CREATE TABLE IF NOT EXISTS` 可重复）

```bash
bq query --use_legacy_sql=false < sql/ddl/base_tables.sql
```

说明：`fact_review.product_name_cn` / `product_name_en` 留给以后商品映射写入；评论导入模板只保留 `platform_product_name`（平台原名）。

运维脚本：`sql/ops/clear_import_data.sql`（DROP `base_tables.sql` 中的全部表/视图）→ 再跑 `ddl/base_tables.sql` 重建空库。

## 增量 DDL（已有库只补新表）

| 文件 | 说明 |
|------|------|
| `ddl/006_dim_issue_taxonomy.sql` | 问题分类树（已并入 base） |
| `ddl/007_app_user_access.sql` | 内部登录账号 + 权限（已并入 base） |
| `ddl/008_analysis_run.sql` | AI 分析 run / 片段 / 正式问题（已并入 base） |
| `ddl/009_analysis_batch.sql` | AI 分析批次历史（已并入 base） |
| `ddl/010_analysis_run_review_id.sql` | 已有 analysis_run 表补 `review_id` 列 |

```bash
bq query --use_legacy_sql=false < sql/ddl/007_app_user_access.sql
bq query --use_legacy_sql=false < sql/ddl/008_analysis_run.sql
bq query --use_legacy_sql=false < sql/ddl/009_analysis_batch.sql
bq query --use_legacy_sql=false < sql/ddl/010_analysis_run_review_id.sql
```
