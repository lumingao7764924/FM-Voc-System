import type { IssueTaxonomyItem } from '@voc/shared';
import { env } from '../config.js';
import { isLlmConfigured, llmClassifyReview, LLM_PROMPT_VERSION } from './llmClassify.js';
import {
  STUB_MODEL_VERSION,
  STUB_PROMPT_VERSION,
  stubClassifyReview,
} from './stubClassify.js';
import type { ClassifyResult } from './types.js';

export type { ClassifyResult } from './types.js';

/** 创建批次时写入的模型/提示词版本 */
export function resolveModelVersions(): {
  modelVersion: string;
  promptVersion: string;
} {
  if (isLlmConfigured()) {
    return {
      modelVersion: env.llmModel,
      promptVersion: LLM_PROMPT_VERSION,
    };
  }
  return {
    modelVersion: STUB_MODEL_VERSION,
    promptVersion: STUB_PROMPT_VERSION,
  };
}

/**
 * 有 LLM_* 配置 → PackyCode/OpenAI 兼容调用；否则 stub。
 * LLM 失败时抛错，由 service 记为 classify_error（不静默回退 stub，避免污染正式 issue）。
 */
export async function classifyReview(input: {
  reviewText: string;
  taxonomy: IssueTaxonomyItem[];
}): Promise<ClassifyResult> {
  if (isLlmConfigured()) {
    return llmClassifyReview(input);
  }
  const stub = stubClassifyReview(input);
  return {
    ...stub,
    modelVersion: STUB_MODEL_VERSION,
    promptVersion: STUB_PROMPT_VERSION,
  };
}
