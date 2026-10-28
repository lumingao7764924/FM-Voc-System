# 项目进度

更新时间：2026-09-14

## 当前状态

- 方案：V1.2；字段字典：v1.1。
- **阶段一（评论导入工作台）：已完成**，详见 `docs/products/应用技术栈与功能说明.md`。
- **产品映射 H02（P0）：已落地** — 对照表上传 / 列表 / 待映射清单；评论导入自动匹配 `brand_key + platform_sku`。
- BigQuery 阶段一表/视图：`sql/ddl/base_tables.sql`；清空重建：`sql/ops/clear_import_data.sql`。
- 应用：登录 + 导入/映射/历史/结果/任务浮窗/页签；可干跑，亦可 `IMPORT_DRY_RUN=false` 写真库。
- 下一阶段方向：映射历史回写（P1）、差评分析看板、Cloud Run 固化部署、（可选）API/Worker 拆分。

## 阶段一交付摘要

- Web：导入（模板下载 + 拖拽）、历史上传、批次结果（含隔离/重复明细回填）、任务浮窗、多页签 keep-alive。
- API：异步导入队列、解析/隔离/身份/查重、GCS + BQ 写入、孤儿任务修复。
- Shared：模板列契约 + 文案字典（`packages/shared/src/labels.ts`）。

## 产品映射（H02）交付摘要

- Web：`/mapping` 页 — 下载模板、上传对照表、当前有效映射列表、待映射/冲突清单。
- API：`POST /api/mappings/file`、`GET /api/mappings`、`GET /api/mappings/unmapped`；写入 `dim_product_mapping`（`global_sku_v1`，按 SKU 覆盖）。
- 评论导入：写 `fact_review` 前查有效映射；命中 → `confirmed` + 内部字段；未命中 → `pending` 计入 `unmapped_rows`。
- 模板：`apps/web/public/templates/voc_product_mapping_template.xlsx`（工作表 `01_内部SKU主数据`）。
- 未做（P1）：补映射后回写历史评论、单条人工确认。

## 已具备的云底座

- GCP 项目：`feimei-product-voc`。
- BigQuery 数据集与阶段一业务表 / serving 视图。
- GCS：raw、media、export。
- Artifact Registry：`review-dashboard`（`us-central1`）。

## 本地应用

- `npm run dev`：Web `5173` + API `8787`。
- 开发账号：`admin` / （见 `apps/api/.env`，勿提交生产密码）。
- `IMPORT_DRY_RUN=true` 不写云；`false` 需 Worker SA（`GOOGLE_APPLICATION_CREDENTIALS`）。

## 部署前待处理（非阶段一阻塞）

- Cloud Run 部署 web + api；JWT/登录密钥迁入 Secret Manager。
- 按需：API/Worker 分身份、持久任务队列。
- H03/H04 数据范围与访问名单（业务确认）。

## 人工输入清单

- H01：评论规范模板 — 工作台可下载 `apps/web/public/templates/voc_review_import_template.xlsx`；样例亦可参考 `docs/templates/`。
- H02：SKU 对照 — 工作台「产品导入」可下载 `voc_product_mapping_template.xlsx`；亦可参考 `docs/templates/`。
- H03/H04：仍待业务确认。
