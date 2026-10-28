# Product VOC GCP 项目交接

## 2026-09-05 方案修订与部署缺口补充

方案已更新为 V1.2，字段字典为 v1.1；正式文件位于本目录的 [系统方案](产品评论与差评分析系统方案%20(2).md) 和 [字段字典](统一评论字段字典%20v1.0.md)。字段命名、业务键、版本、媒体和恢复规则已有技术设计；真实导出样本、缺失产品关系、访问名单及数据保留范围仍需对应负责人提供。Firestore Native / us-central1 为计划控制库，尚未创建；`review_control` 用于仓库审计/汇总，不承担实时任务锁。

9 月 5 日只读 IAM 核对发现，两个 runtime 未见项目级 BigQuery Job User，API SA 未见 signBlob 绑定。部署前按方案 27.3 补 Job User、具体签名身份/资源权限、Firestore 服务端权限和命名 Cloud Run Job 执行权限，并检查构建身份自己的仓库/部署/actAs 权限。API 读取 Core 来源的 Serving 视图还需 Authorized View 或由 Worker 生成 Serving 实体快照。

IT 当前无 IAM Admin，新增 IAM 角色/绑定、签名账号和所需服务启用由现有有权管理员完成；不需要扩大 IT 到项目 Owner。补齐后用实际 runtime 验证查询、上传/媒体签名和任务触发。本轮只更新文件，以上缺口尚未更改或通过运行时验收。

## 已创建

| 项目项 | 值 |
|---|---|
| GCP Project ID | `feimei-product-voc` |
| 显示名称 | `feimei product VOC` |
| Project number | `926086630480` |
| 结算账户 | `billingAccounts/0158BD-7DDC37-53F58C` |
| BigQuery location | `US` |
| GCS location | `US` |
| Cloud Run / Artifact Registry | `us-central1` |

已启用 BigQuery、Cloud Storage、Cloud Run、Artifact Registry、Cloud Build、Secret Manager、Logging、Monitoring 和 IAM Credentials API。

## 数据资源

BigQuery 数据集均位于 `US`：

- `feimei-product-voc.review_raw`：原始评论落地区
- `feimei-product-voc.review_core`：清洗、去重、商品映射后的核心层
- `feimei-product-voc.review_semantic`：主题、情感、问题标签和 AI 分析层
- `feimei-product-voc.review_serving`：看板查询服务层
- `feimei-product-voc.review_control`：配置、任务状态和审计层

GCS Bucket 均位于 `US`，启用 Uniform Bucket-Level Access 和 Public Access Prevention：

- `gs://feimei-product-voc-raw`
- `gs://feimei-product-voc-media`
- `gs://feimei-product-voc-export`

Artifact Registry 已创建 Docker 仓库：

`us-central1-docker.pkg.dev/feimei-product-voc/review-dashboard`

## 运行时身份

- API：`review-api-runtime@feimei-product-voc.iam.gserviceaccount.com`
  - BigQuery：`review_serving` 只读
  - GCS：media、export 对象只读
- Worker：`review-worker-runtime@feimei-product-voc.iam.gserviceaccount.com`
  - BigQuery：五个 VOC 数据集可写表/视图
  - GCS：raw、media、export 对象管理

### 与当前仓库的关系（避免规划误解）

| | 说明 |
|--|--|
| **目标** | 看板/读 API 用 `review-api-runtime`；导入写任务用 `review-worker-runtime` |
| **现状** | `apps/api` 单体：读+写同一进程；本地 `GOOGLE_APPLICATION_CREDENTIALS` 用 **Worker** JSON 即可 |
| **先上线** | 可先单体部署并挂 Worker（或临时给 API 写权限），**不必**为双 SA 先改业务代码 |
| **以后拆分** | 主要是部署与任务投递；导入逻辑已在 `import/`，不是推倒重做 |
| **两份 JSON** | 可留作管理员侧备份，但**不要进 git**；生产优先 Cloud Run 绑定 SA。多下一份 JSON **不等于**已完成双身份架构 |

## 已授权的开发账号权限

IT 开发账号已配置以下权限（具体身份通过 GCP/IAM 成员设置管理）：

- 项目级：Cloud Run Admin、Cloud Build Editor、BigQuery Job User、Logging Viewer、Monitoring Viewer、Secret Manager Viewer、Service Usage Consumer、Service Account Viewer
- 数据集级：五个 VOC 数据集 `roles/bigquery.dataEditor`
- Bucket 级：三个 VOC Bucket `roles/storage.objectAdmin`
- Artifact Registry：`review-dashboard` 仓库 `roles/artifactregistry.writer`
- 服务账号级：两个运行时服务账号 `roles/iam.serviceAccountUser`

未授予项目 Owner、Editor、IAM Admin 或 Secret Accessor。Secret Manager Viewer 只能查看 Secret 元数据，不能读取 Secret 内容。

## IT 下一步

1. 提交前端/API/Worker 源码或已构建镜像，并在 `review-dashboard` 仓库中使用不可变版本标签。
2. 按新版字段字典 v1.1 创建表/分区/聚簇与通用导入模块；取得一个真实导出样本后验证实际列映射。缺失产品事实、保留政策和人员输入按方案第 38 章收集，不再重做技术字段决策。
3. 使用 `review-api-runtime` 部署看板 API，使用 `review-worker-runtime` 部署导入/分析任务；Cloud Run 服务或 Job 统一使用 `us-central1`。
4. 部署时明确认证策略，不默认开放匿名访问；Secret 通过 Secret Manager 注入，不写入代码、镜像、日志或仓库。
5. 完成一条小批量端到端验收：原始评论入 GCS/BigQuery、去重和商品映射、分析结果落库、看板读取、失败重试和审计记录。

Cloud Run 服务目前尚未创建，因为项目中还没有可部署的源码或镜像。
