# Cloud Build 自动部署（push → 上线）

仓库内配置：

- `cloudbuild.api.yaml` → 构建并部署 `voc-api`
- `cloudbuild.web.yaml` → 构建并部署 `voc-web`

线上地址（首次手工部署后）：

- API：`https://voc-api-926086630480.us-central1.run.app`
- Web：`https://voc-web-926086630480.us-central1.run.app`

---

## 一、给 Cloud Build 服务账号授权（只需一次）

项目编号：`926086630480`  
默认 Cloud Build 账号：

`926086630480@cloudbuild.gserviceaccount.com`

在 **IAM 与管理 → IAM** 给该账号添加（若已有可跳过）：

| 角色 | 用途 |
|------|------|
| Artifact Registry Writer | 推镜像 |
| Cloud Run Admin | 部署服务 |
| Service Account User | 能借用运行时 SA（部署时需要） |
| Storage Object Admin（或对 cloudbuild 暂存桶有写权限） | 上传构建源码 |

也可在 Cloud Shell 执行：

```bash
PROJECT=feimei-product-voc
CB_SA=926086630480@cloudbuild.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"
```

---

## 二、连接 GitHub 并创建触发器（控制台，只需一次）

1. 打开 [Cloud Build 触发器](https://console.cloud.google.com/cloud-build/triggers?project=feimei-product-voc)
2. **连接代码库** → 选 **GitHub（Cloud Build GitHub App）** → 授权并选中私有仓库 `FM-Voc-System`
3. 创建 **两个** 触发器：

### 触发器 A：API

| 项 | 值 |
|----|-----|
| 名称 | `deploy-voc-api` |
| 事件 | 推送到分支 |
| 分支 | `^main$`（若默认分支是 `master` 就写 `^master$`） |
| 配置 | 仓库中的 Cloud Build 配置文件 |
| 位置 | `cloudbuild.api.yaml` |
| 包含的文件过滤（可选） | `apps/api/**` 与 `packages/shared/**` |

### 触发器 B：Web

| 项 | 值 |
|----|-----|
| 名称 | `deploy-voc-web` |
| 事件 | 推送到分支 |
| 分支 | 同 API |
| 配置文件 | `cloudbuild.web.yaml` |
| 包含的文件过滤（可选） | `apps/web/**` 与 `packages/shared/**` |

保存。可在触发器页点「立即执行」做一次试跑。

---

## 三、以后日常发版

在本机：

```bash
git add .
git commit -m "说明这次改动"
git push origin main
```

然后到 Cloud Build → 历史记录看是否绿勾。几分钟后打开网页验证：

https://voc-web-926086630480.us-central1.run.app

- 只改 API → 一般只跑 `deploy-voc-api`
- 只改前端 → 一般只跑 `deploy-voc-web`
- 改了 `packages/shared` → 两个都可能跑（若配置了路径过滤）

环境变量 / Secret / `API_UPSTREAM` 已在服务上，自动部署**只更新镜像**，不用每次重填。

---

## 四、手动补跑（可选）

```bash
cd ~/FM-Voc-System && git pull
gcloud builds submit --config cloudbuild.api.yaml .
gcloud builds submit --config cloudbuild.web.yaml .
```
