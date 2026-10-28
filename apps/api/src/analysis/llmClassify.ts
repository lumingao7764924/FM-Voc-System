import { randomUUID } from 'node:crypto';
import type { IssueTaxonomyItem } from '@voc/shared';
import { env } from '../config.js';
import type { ClassifyIssue, ClassifyResult, ClassifySegment } from './types.js';

export const LLM_PROMPT_VERSION = 'llm-voc-classify-v1';

type LlmSegmentOut = {
  text?: unknown;
  sentiment?: unknown;
  issue_l1_id?: unknown;
  issue_l2_id?: unknown;
  issue_l3_id?: unknown;
  confidence?: unknown;
  aspect?: unknown;
  opinion?: unknown;
};

function codePoints(text: string): string[] {
  return [...text];
}

function findEvidenceOffsets(
  full: string,
  quote: string,
): { start: number; end: number } | null {
  const cps = codePoints(full);
  const q = codePoints(quote.trim());
  if (!q.length) return null;
  for (let i = 0; i <= cps.length - q.length; i += 1) {
    let ok = true;
    for (let j = 0; j < q.length; j += 1) {
      if (cps[i + j] !== q[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i, end: i + q.length };
  }
  const loose = full.indexOf(quote.trim());
  if (loose >= 0) {
    const start = [...full.slice(0, loose)].length;
    const end = start + [...quote.trim()].length;
    return { start, end };
  }
  return null;
}

function buildTaxonomyPrompt(taxonomy: IssueTaxonomyItem[]): string {
  const active = taxonomy.filter((t) => t.activeStatus === 'active' && t.issueLevel >= 1);
  const l1 = active.filter((t) => t.issueLevel === 1);
  const l2 = active.filter((t) => t.issueLevel === 2);
  const lines: string[] = [];
  for (const a of l1) {
    lines.push(`- L1 ${a.issueId}: ${a.issueNameCn}`);
    const children = l2.filter((c) => c.parentIssueId === a.issueId);
    for (const c of children) {
      const desc = (c.issueDescription ?? '').trim().slice(0, 80);
      const safety = c.isSafetyRelated ? ' [安全]' : '';
      lines.push(
        `  - L2 ${c.issueId}: ${c.issueNameCn}${safety}${desc ? ` — ${desc}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

function systemPrompt(): string {
  return `你是美妆护肤 VOC 差评分析助手。根据用户评论与给定问题分类树，做「拆句 + 多标签分类」。

硬性规则：
1. 禁止整评只打一个标签；按观点拆成多个 segment。
2. 每个 segment 的 text 必须是原文中连续出现的子串（证据），不要改写。
3. issue_l1_id / issue_l2_id 只能使用分类树里给出的 id；不确定则 issue_l2_id 为 null，sentiment 仍可标。
4. 仅负面/问题相关 segment 才填 issue；夸奖可 sentiment=positive 且 issue 为空。
5. 安全/过敏相关请尽量命中带 [安全] 的 L2。
6. 只输出一个 JSON 对象，不要 markdown。

JSON 形状：
{
  "segments": [
    {
      "text": "原文证据子串",
      "sentiment": "negative|neutral|positive",
      "issue_l1_id": "l1_xxx 或 null",
      "issue_l2_id": "l2_xxx 或 null",
      "issue_l3_id": null,
      "confidence": 0.0到1.0,
      "aspect": "可选",
      "opinion": "可选"
    }
  ]
}`;
}

function asSentiment(v: unknown): ClassifySegment['sentiment'] {
  const s = String(v ?? '').toLowerCase();
  if (s === 'positive' || s === 'neutral' || s === 'negative') return s;
  return 'neutral';
}

function asId(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  return s;
}

function resolveL1(
  l1Id: string | null,
  l2Id: string | null,
  byId: Map<string, IssueTaxonomyItem>,
): string | null {
  if (l1Id && byId.has(l1Id)) return l1Id;
  if (l2Id) {
    const l2 = byId.get(l2Id);
    if (l2?.parentIssueId && byId.has(l2.parentIssueId)) return l2.parentIssueId;
    if (l2?.issueLevel === 1) return l2.issueId;
  }
  return l1Id && byId.has(l1Id) ? l1Id : null;
}

function parseAndMap(input: {
  reviewText: string;
  taxonomy: IssueTaxonomyItem[];
  rawJson: string;
}): ClassifyResult {
  const byId = new Map(input.taxonomy.map((t) => [t.issueId, t]));
  const missingTaxonomy = input.taxonomy.filter((t) => t.issueLevel >= 2).length === 0;

  let parsed: { segments?: LlmSegmentOut[] };
  try {
    parsed = JSON.parse(input.rawJson) as { segments?: LlmSegmentOut[] };
  } catch {
    throw new Error('llm_invalid_json');
  }
  const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
  if (!rawSegs.length) throw new Error('llm_empty_segments');

  const segments: ClassifySegment[] = [];
  const issues: ClassifyIssue[] = [];
  let hasSafety = false;

  rawSegs.forEach((raw, idx) => {
    const quote = String(raw.text ?? '').trim();
    if (!quote) return;
    const offsets = findEvidenceOffsets(input.reviewText, quote);
    if (!offsets) return;

    const evidence = codePoints(input.reviewText)
      .slice(offsets.start, offsets.end)
      .join('');
    if (!evidence.trim()) return;

    const confidence = Math.min(
      1,
      Math.max(0, Number(raw.confidence ?? 0.5) || 0.5),
    );
    const segmentId = randomUUID();
    const sentiment = asSentiment(raw.sentiment);

    segments.push({
      segmentId,
      segmentIndex: idx,
      segmentTextOriginal: evidence,
      sentiment,
      evidenceStart: offsets.start,
      evidenceEnd: offsets.end,
      segmentConfidence: confidence,
      aspectTerm: raw.aspect != null ? String(raw.aspect).trim() || null : null,
      opinionTerm: raw.opinion != null ? String(raw.opinion).trim() || null : null,
    });

    if (sentiment !== 'negative' || missingTaxonomy) return;
    if (confidence < env.llmMinConfidence) return;

    let l2Id = asId(raw.issue_l2_id);
    let l1Id = asId(raw.issue_l1_id);
    if (l2Id && !byId.has(l2Id)) l2Id = null;
    if (l1Id && !byId.has(l1Id)) l1Id = null;
    l1Id = resolveL1(l1Id, l2Id, byId);
    if (!l1Id && !l2Id) return;

    const l2 = l2Id ? byId.get(l2Id) : null;
    const l1 = l1Id ? byId.get(l1Id) : null;
    const finalL1 = l1Id || l2?.parentIssueId;
    if (!finalL1) return;

    const safety = Boolean(l2?.isSafetyRelated || l1?.isSafetyRelated);
    if (safety) hasSafety = true;

    issues.push({
      reviewIssueId: randomUUID(),
      segmentId,
      issueL1Id: finalL1,
      issueL2Id: l2Id,
      issueL3Id: asId(raw.issue_l3_id),
      issuePolarity: 'negative',
      severityLevel: l2?.defaultSeverity ?? l1?.defaultSeverity ?? null,
      responsibleDomain: l2?.issueOwnerTeam ?? l1?.issueOwnerTeam ?? null,
      evidenceQuoteOriginal: evidence,
      classificationConfidence: confidence,
      isSafetyRelated: safety,
      isProductControllable: l2?.isProductControllable ?? l1?.isProductControllable ?? null,
    });
  });

  if (!segments.length) throw new Error('llm_no_valid_evidence');

  return {
    segments,
    issues,
    hasSafety,
    missingTaxonomy,
    modelVersion: env.llmModel,
    promptVersion: LLM_PROMPT_VERSION,
  };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function extractResponsesText(data: {
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
  output_text?: string;
}): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function userPayload(reviewText: string, taxonomy: IssueTaxonomyItem[]): string {
  return [
    '【问题分类树】',
    buildTaxonomyPrompt(taxonomy),
    '',
    '【评论文本】',
    reviewText,
  ].join('\n');
}

/** Packy 风控会拦默认 undici UA */
function llmHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.llmApiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'OpenAI/NodeJS',
  };
}

/**
 * 仅走 Packy / OpenAI Responses API（gpt-5.6-sol 不支持 chat completions）。
 * 端点：{LLM_BASE_URL}/responses
 */
export async function llmClassifyReview(input: {
  reviewText: string;
  taxonomy: IssueTaxonomyItem[];
}): Promise<ClassifyResult> {
  if (!env.llmApiKey || !env.llmBaseUrl || !env.llmModel) {
    throw new Error('llm_not_configured');
  }

  const url = `${env.llmBaseUrl}/responses`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.llmTimeoutMs);

  const body: Record<string, unknown> = {
    model: env.llmModel,
    instructions: systemPrompt(),
    input: [
      {
        role: 'user',
        content: userPayload(input.reviewText, input.taxonomy),
      },
    ],
  };
  const effort = env.llmReasoningEffort;
  if (
    effort &&
    ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
  ) {
    body.reasoning = { effort };
  }

  try {
    console.info(`[llm] POST ${url} model=${env.llmModel} effort=${effort || 'default'}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: llmHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (/protocol_not_supported/i.test(errText)) {
        throw new Error(
          `llm_protocol:已请求 ${url}，但网关仍报协议错误：${errText.slice(0, 180)}`,
        );
      }
      throw new Error(`llm_http_${res.status}:${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      output_text?: string;
      status?: string;
      error?: { message?: string; code?: string };
    };
    if (data.error?.message) {
      throw new Error(`llm_response_error:${data.error.message.slice(0, 200)}`);
    }
    const content = extractResponsesText(data);
    if (!content.trim()) throw new Error('llm_empty_response');

    return parseAndMap({
      reviewText: input.reviewText,
      taxonomy: input.taxonomy,
      rawJson: extractJson(content),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('llm_timeout');
    }
    const cause = err instanceof Error ? (err as Error & { cause?: Error }).cause : undefined;
    const code =
      cause && 'code' in cause ? String((cause as { code?: string }).code ?? '') : '';
    if (
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      (err instanceof TypeError && /fetch failed/i.test(err.message))
    ) {
      throw new Error(
        `llm_unreachable:${env.llmBaseUrl}${code ? ` (${code})` : ''}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function isLlmConfigured(): boolean {
  return Boolean(env.llmApiKey && env.llmBaseUrl && env.llmModel);
}
