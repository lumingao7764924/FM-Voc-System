# Feimei Product VOC — 应用

评论导入工作台：React 前端 + Node API。BigQuery / GCS 凭据只在服务端使用。

## 本地启动

```bash
# 在仓库根目录
cp .env.example apps/api/.env   # 或直接使用已有 apps/api/.env
npm install
npm run build -w @voc/shared
npm run dev:api                 # http://127.0.0.1:8787
npm run dev:web                 # http://127.0.0.1:5173
```

默认账号（仅开发，上线请改 Secret）：

- 用户名：`admin`
- 密码：`123456`

打开 http://localhost:5173 → 登录 →「评论导入」上传规范 xlsx。

默认 `IMPORT_DRY_RUN=true`：解析与批次状态在内存中完成，**不写**真实 BigQuery/GCS，便于先验证页面与接口。

## 写入真实 BigQuery

1. 准备有写权限的服务账号密钥（建议 `review-worker-runtime`），本地：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/绝对路径/sa.json
```

2. 在 `apps/api/.env` 设置：

```bash
IMPORT_DRY_RUN=false
GCP_PROJECT_ID=feimei-product-voc
GCS_RAW_BUCKET=feimei-product-voc-raw
```

3. 重启 API，再上传文件。

## 安全要点

- 前端只有会话 Cookie + 短时会话派生密钥（用于请求体 AES-GCM），**没有** BQ 密钥。
- 登录口令、JWT_SECRET、SESSION_CRYPTO_SECRET 仅存在服务端 `.env` / Secret Manager。
- 生产请开启 `COOKIE_SECURE=true`，并走 Cloud Run HTTPS。

## Cloud Run（概要）

- 镜像仓库：`us-central1-docker.pkg.dev/feimei-product-voc/review-dashboard`
- API 服务绑定可写 BQ/GCS 的 SA（见 `docs/gcp-bootstrap.md` 的 worker SA）
- Web 用 nginx 反代 `/api`；部署时设置 `API_UPSTREAM=https://voc-api-….run.app`
- 无自有域名也可：直接用 Cloud Run 分配的 `*.run.app` HTTPS 地址
- 密钥放 Secret Manager，不要写进镜像 / GitHub

## 目录

- `apps/web` — Vite + React + **shadcn/ui + Tailwind**（响应式）
- `apps/api` — Fastify + 导入逻辑
- `packages/shared` — 共享类型与模板列名
- `sql/ddl` — BigQuery 建表
- `docs/templates` — 评论/主数据 Excel 模板
- `.cursor/rules/web-shadcn-tailwind.mdc` — 前端优先用 shadcn + Tailwind
