import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 先读仓库根 .env，再用 apps/api/.env 覆盖（LLM_* 以 api 目录为准）
loadEnv({ path: path.resolve(__dirname, '../../../.env') });
loadEnv({ path: path.resolve(__dirname, '../.env'), override: true });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  authUsername: required('AUTH_USERNAME', 'admin'),
  authPassword: required('AUTH_PASSWORD', '123456'),
  jwtSecret: required('JWT_SECRET', 'dev-change-me-jwt-secret-use-long-random-string'),
  sessionCryptoSecret: required(
    'SESSION_CRYPTO_SECRET',
    'dev-change-me-session-crypto-secret-32b-min',
  ),
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
  gcpProjectId: process.env.GCP_PROJECT_ID ?? 'feimei-product-voc',
  gcsRawBucket: process.env.GCS_RAW_BUCKET ?? 'feimei-product-voc-raw',
  importDryRun: (process.env.IMPORT_DRY_RUN ?? 'true') === 'true',
  /** 单次「差评分析」最多处理条数（控 token / 成本） */
  analysisMaxReviews: Math.min(
    200,
    Math.max(1, Number(process.env.ANALYSIS_MAX_REVIEWS ?? 50)),
  ),
  /** PackyCode / OpenAI 兼容；未配置时用 stub */
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmBaseUrl: (process.env.LLM_BASE_URL ?? '').replace(/\/$/, ''),
  llmModel: process.env.LLM_MODEL ?? '',
  /**
   * responses | chat | auto（默认）。
   * gpt-5.6-sol 等 Packy Codex 模型只支持 Responses API。
   */
  llmApiMode: (process.env.LLM_API_MODE ?? 'auto').trim().toLowerCase(),
  /** GPT-5.x 推理强度：none|low|medium|high|xhigh|max；空则不传 */
  llmReasoningEffort: (process.env.LLM_REASONING_EFFORT ?? '').trim().toLowerCase(),
  /** 正式 issue 最低置信度（低于此只保留 segment，不写 issue） */
  llmMinConfidence: Math.min(
    1,
    Math.max(0, Number(process.env.LLM_MIN_CONFIDENCE ?? 0.35) || 0.35),
  ),
  /** 单条评论 LLM 超时（毫秒） */
  llmTimeoutMs: Math.min(
    120_000,
    Math.max(5_000, Number(process.env.LLM_TIMEOUT_MS ?? 45_000) || 45_000),
  ),
};