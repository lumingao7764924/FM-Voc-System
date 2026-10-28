# AI 语义分析实施说明（Step 5 / 轨道 B）

> 给新对话窗口用的开工文档。范围：**只做评论文本的拆句 + 多标签问题分类 + 结果进看板**。  
> **当前排期：** H04 已完成后进入本 Step。  
> **MVP 入口：** 评论分析页「差评分析」按钮 → 按**当前筛选**选最多 N 条（默认 50）有正文的 1～3 星评论异步分析（控 token）。  
> **不做**：Embedding / 未知问题聚类（阶段三）、媒体视觉分析、销售千单强度、钉钉预警、案件整改（品牌权限见 H04 专文）。  
> 权威契约：`docs/统一评论字段字典 v1.0.md` §12；业务逻辑：`docs/产品评论与差评分析系统方案 (2).md` 第 11、13、17.5、18 章；执行清单：`docs/products/差评分析看板实施路线.md` Step 5。

更新时间：2026-10-14（5.3：PackyCode/OpenAI 兼容 LLM 已接；未配 LLM_* 仍走 stub）

---

## 1. 要解决什么问题

轨道 A 已能看星级与量；问题分类树（Step 4）已定稿。  
**还缺：** 把低星（或选定范围）评论，按固定 taxonomy **拆成多片段、打上 L1/L2（可选 L3）**，并保证：

- 每条结论能 **点回原文证据**
- 无证据 / 低置信度 / 安全线索 **不进正式问题统计**（进复核）
- 结果按 **`review_version_id` + `analysis_run_id`** 版本化，可重跑、可对比

**业务心智：** 「这条差评在说哪几个问题、原文哪一句证明的。」  
**不假装：** 置信度 ≠ 正确率；未校准阈值只做路由。

---

## 2. 现状（已有 / 没有）

| 项 | 状态 |
|----|------|
| 评论 Serving：`v_review_current` | 已有 |
| 问题分类树：`review_semantic.dim_issue_taxonomy` + `/taxonomy` | 已有（Step 4） |
| 评论分析看板：`/analytics`（量/星级/分布/原声） | 已有（轨道 A） |
| 导入异步队列模式（`import/queue.ts` fire-and-forget） | 已有，可参考 |
| DDL：`analysis_run` / `fact_review_segment` / `fact_review_issue` | **已有**（`008_analysis_run.sql`；需在目标 BQ 执行） |
| 分析 Worker / stub 分类器 / 批次 API | **已有 MVP**（`POST/GET /api/analysis/batches`） |
| 评论分析页「差评分析」按钮 + 本批 Top 问题 | **已有 MVP** |
| 真 LLM（PackyCode）适配器 | **已做**（`analysis/llmClassify.ts`；三项 `LLM_*` 齐则走 AI，否则 stub） |
| 人工复核队列 UI / 控制库投影 | **未做**（MVP 用 `pending_review`） |
| 看板全站 Top 问题 Pareto / 问题分析器 | **未做**（5.4；现仅本批结果面板） |
| Embedding / 媒体分析 | **不做（Step 6 / 阶段三）** |

---

## 3. 推荐实施顺序（子步骤）

| 子步 | 内容 | 完成标准 |
|------|------|----------|
| **5.1 存储契约** | DDL + shared 类型；只读列表 API 可选 | BQ 能建表；干跑可写内存 |
| **5.2 Worker MVP** | 选一批低星评论异步分析；写 run + segment + issue | 同一批评论可重跑；正式 issue 必有证据 |
| **5.3 模型与门槛** | Prompt + Schema；置信度路由；安全 → pending_review | 非法 JSON / 无证据不上正式表 |
| **5.4 看板增量** | 覆盖率、Top 问题、点回原文 | 业务能筛品牌+时间看 Top 问题并下钻句子 |

建议：**先 5.1 → 5.2 用假模型/规则 stub 打通链路 → 再换真 LLM（5.3）→ 最后看板（5.4）。**

---

## 4. 数据契约（必读摘要）

键规则（字典 §12）：

- 文本分析结果绑定 **`review_version_id` + `analysis_run_id`**
- 仅 `review_id` **不够**（编辑会产生新 version）
- 每次跑批生成新 `analysis_run_id`；重跑不覆盖旧 run（可标记「当前发布」规则另定）
- `input_hash`：对本次输入（原文 + taxonomy_version + prompt/model 版本）做哈希，便于跳过未变内容
- 证据偏移：未修改原文的 Unicode code point `[evidence_start, evidence_end)`

### 4.1 必建表（MVP）

依据字典 §12，建议 DDL 落在 `sql/ddl/007_*.sql` 等（命名可调）：

| 表 | 作用 |
|----|------|
| `review_semantic.analysis_run` | 一次分析任务：状态 queued/running/succeeded/failed/pending_review |
| `review_semantic.fact_review_segment` | 拆句片段：aspect/opinion/sentiment/证据偏移/置信度 |
| `review_semantic.fact_review_issue` | 正式问题明细：issue_l1/l2/l3、极性、责任域、证据原文、是否安全等 |

**MVP 可不建（后续再加）：**

- `review_text_analysis`（整评翻译）——若模型直接吃原文可后置
- `review_embedding` / `review_media_analysis` —— Step 6
- 控制库 `human_review_event` —— 首期可用 `analysis_status=pending_review` + issue 不上正式统计代替；有 UI 需求再投影

### 4.2 `analysis_run` 关键字段

`analysis_run_id`、`review_version_id`、`input_hash`、`model_version`、`prompt_version`、`taxonomy_version`、`analysis_status`、`started_at`/`finished_at`、`error_code`

### 4.3 `fact_review_issue` 正式入库门槛（方案 11.4）

同时满足才写入正式问题明细（用于看板统计）：

1. 输出符合 JSON Schema  
2. `issue_*_id` 存在于当前 `taxonomy_version`  
3. 有 `evidence_quote_original`，且能在原文中定位  
4. 非「仅靠未校准 confidence」强行发布  
5. 无字段级明显冲突  

否则：run/片段可保留调试信息，**问题不进 Top 统计**，状态进复核。

---

## 5. 处理链路（方案 11.1，工程裁剪）

```text
选评论（默认：当前有效版本 ∩ 低星 ∩ 可选品牌/时间）
  ↓
创建 analysis_run（queued → running）
  ↓
语言识别（可选）→ 可选翻译（证据仍用原文）
  ↓
拆句 / 观点拆分（禁止「整评只打一个标签」）
  ↓
每片段：aspect / opinion / sentiment / taxonomy 多标签 / 严重度 / 责任域
  ↓
证据抽取 + 置信度
  ↓
门槛分流：正式 issue 表  vs  pending_review
  ↓
run → succeeded / failed / pending_review
```

示例（方案 11.2）：  
「颜色很好看，但是很拔干，而且泵头漏液。」→ **至少 3 个片段**，分别打标。

模型输出示意见方案 11.3；解析后必须映射到 **稳定 `issue_id`**（如 `l2_cs_attitude`），不要只存中文名。

---

## 6. Worker / Job 设计要点

对齐现有导入队列经验：

| 要求 | 建议 |
|------|------|
| 不堵 HTTP | `enqueueAnalysisJob` + `setImmediate` / 独立 worker；请求只返回 `analysis_run_id` 或 batch_id |
| 进程重启 | 首期可与 import 一样「内存队列、重启丢失」；写真库后改为 BQ `queued` 扫描或 Cloud Tasks |
| 可重跑 | 新 `analysis_run_id`；同 `input_hash` 可跳过或强制重跑开关 |
| 批大小 | 先小批（如 50～200 条）验证成本与延迟 |
| 干跑 | `IMPORT_DRY_RUN=true` 时结果写内存，**禁止** Agent 自动灌写真库测试数据 |

建议 API 面（命名可调）：

| 接口 | 作用 |
|------|------|
| `POST /api/analysis/runs` | 按筛选创建跑批（返回 run/batch id） |
| `GET /api/analysis/runs/:id` | 状态与计数 |
| `GET /api/analysis/issues` | 正式问题列表（供看板/下钻） |
| （可选）`GET /api/analysis/reviews/:versionId/segments` | 某评片段与证据 |

权限：沿用现有登录会话；不在本期做品牌级 ACL。

---

## 7. 模型与 Prompt（5.3）

**实现：** `apps/api/src/analysis/llmClassify.ts`（OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`）。  
未配齐 `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` 时自动走 `stubClassify`。

| env | 说明 |
|-----|------|
| `LLM_API_KEY` | Bearer token（勿提交仓库） |
| `LLM_BASE_URL` | PackyAPI 主站：`https://cf.api.fan/v1`（无尾斜杠） |
| `LLM_API_MODE` | `responses`（gpt-5.6-sol 必选）/ `chat` / `auto` |
| `LLM_MODEL` | 如 `gpt-5.6-sol`（该模型不支持 chat completions） |
| `LLM_MIN_CONFIDENCE` | 默认 `0.35`；低于此不写正式 issue |
| `LLM_TIMEOUT_MS` | 默认 `45000` |

- **输入**：评论文本 + taxonomy L1/L2 精简树（id/名称/描述）  
- **输出**：JSON `segments[]`（text 须为原文连续子串；issue id 须落在树内）  
- **路由：**  
  - `confidence < LLM_MIN_CONFIDENCE` → 保留 segment，不写正式 issue  
  - `is_safety_related=true` → run `pending_review`  
  - 证据匹配失败 / 非法 id → 丢弃该条 issue  
  - LLM HTTP/JSON 失败 → run `failed`（**不**静默回退 stub）

**明确禁止：** 把置信度展示成「准确率」；无证据上总览；把「疑似过敏/假货」当已证实结论。

版本字段：`model_version`、`prompt_version`（`llm-voc-classify-v1`）、`taxonomy_version` 写入 run 与结果行。

---

## 8. 看板增量（5.4）

在现有「评论分析」之上增量，避免暗示「全站 AI 已完成」：

| 能力 | 说明 |
|------|------|
| 已分析覆盖率 | 筛选范围内：有成功正式分析的 version 数 / 评论数 |
| 含负面问题的评论率 | 至少 1 条正式 negative issue 的评论占比 |
| Top 问题 Pareto | 按 issue（建议 L2）聚合去重评论数；点击下钻 |
| 证据下钻 | 打开原声时高亮 `evidence_quote` 或展示片段列表 |

问题分析器（方案第 18 章）完整版可二期：首期可用「Pareto + 侧栏原声/片段」代替热力图全家桶。

**仍不展示：** 每千单强度、AI 覆盖率若无正式 run 则置灰或隐藏。

---

## 9. 明确不做（防范围膨胀）

| 项 | 原因 |
|----|------|
| Embedding / 新问题聚类 | 阶段三；固定树先稳报表 |
| 媒体 OCR / 缺陷视觉 | Step 6 |
| 人工案件 / 钉钉 | 控制面与运维未排期 |
| 分析页「是否映射」/ CSV 导出 | 轨道 A 已确认不做/暂缓 |
| 整评单标签 | 违反方案 11.2 |

---

## 10. 验收清单（建议）

- [ ] DDL 在目标项目可执行；干跑内存路径可用  
- [ ] 跑 20～50 条已知低星：片段 ≥1，正式 issue 均有可回原文的证据  
- [ ] 故意缺证据 / 非法 issue_id → 不进正式统计  
- [ ] 安全类样例进入 pending_review  
- [ ] 同一批重跑产生新 `analysis_run_id`，旧 run 仍可查  
- [ ] 看板能看到 Top 问题并点到至少 1 条原文证据  
- [ ] `IMPORT_DRY_RUN=false` 时，未口头确认不自动灌测试 run

---

## 11. 与仓库文档的关系

| 文档 | 用途 |
|------|------|
| 本文 | **Step 5 开工说明**：做什么、不做什么、顺序 |
| `差评分析看板实施路线.md` | 总清单；Step 5 勾选以本文为准推进 |
| `统一评论字段字典 v1.0.md` §12 | 表与字段权威 |
| `产品评论与差评分析系统方案 (2).md` 11 / 13 / 17.5 / 18 | 业务规则与页面蓝图 |
| `应用技术栈与功能说明.md` | Step 5 落地后回写阶段结论 |

---

## 12. 建议下周动手顺序（给 Agent）

1. 写 `sql/ddl/007_analysis_run.sql`（含 segment / issue，或拆多文件）  
2. `@voc/shared` 增加 Analysis 类型与文案  
3. `apps/api/src/analysis/`：store（BQ + 干跑内存）+ queue + stub classifier  
4. `POST /api/analysis/runs` + 状态查询  
5. 换真模型适配器（同一 Schema）  
6. `/analytics` 或新页挂 Top 问题 + 证据下钻  

开工前先读：`apps/api/.env` 的 `IMPORT_DRY_RUN`；写真库禁止自动灌测试分析数据。
