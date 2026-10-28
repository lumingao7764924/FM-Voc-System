import type { IssueTaxonomyItem } from '@voc/shared';
import { ANALYSIS_COPY } from '@voc/shared';
import { randomUUID } from 'node:crypto';

export const STUB_MODEL_VERSION = ANALYSIS_COPY.modelStub;
export const STUB_PROMPT_VERSION = ANALYSIS_COPY.promptStub;

export type StubSegment = {
  segmentId: string;
  segmentIndex: number;
  segmentTextOriginal: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  evidenceStart: number;
  evidenceEnd: number;
  segmentConfidence: number;
  aspectTerm: string | null;
  opinionTerm: string | null;
};

export type StubIssue = {
  reviewIssueId: string;
  segmentId: string;
  issueL1Id: string;
  issueL2Id: string | null;
  issueL3Id: string | null;
  issuePolarity: 'negative' | 'positive' | 'neutral';
  severityLevel: number | null;
  responsibleDomain: string | null;
  evidenceQuoteOriginal: string;
  classificationConfidence: number;
  isSafetyRelated: boolean;
  isProductControllable: boolean | null;
};

export type StubClassifyResult = {
  segments: StubSegment[];
  issues: StubIssue[];
  /** 任一安全类命中 → run 进 pending_review（issue 仍可写，看板可另过滤） */
  hasSafety: boolean;
  /** 无可用 taxonomy 时 true */
  missingTaxonomy: boolean;
};

/** Unicode code point 切片与偏移（与字典证据约定一致） */
function codePoints(text: string): string[] {
  return [...text];
}

function sliceByCodePoints(text: string, start: number, end: number): string {
  return codePoints(text).slice(start, end).join('');
}

function findEvidenceOffsets(
  full: string,
  quote: string,
): { start: number; end: number } | null {
  const cps = codePoints(full);
  const q = codePoints(quote);
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
  return null;
}

/** 按中英文句读粗拆；禁止整评单标签 */
function splitSegments(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？；.!?;\n])|(?<=，|,)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (parts.length >= 2) return parts;
  // 短评：仍拆成至少 1 段；若含「但是/而且」再拆
  const soft = trimmed.split(/(?:但是|而且|不过|可是)/).map((s) => s.trim()).filter(Boolean);
  if (soft.length >= 2) return soft;
  return [trimmed];
}

function matchIssue(
  segment: string,
  taxonomy: IssueTaxonomyItem[],
): IssueTaxonomyItem | null {
  const active = taxonomy.filter((t) => t.activeStatus === 'active' && t.issueLevel >= 2);
  const lower = segment.toLowerCase();
  let best: IssueTaxonomyItem | null = null;
  let bestScore = 0;
  for (const t of active) {
    let score = 0;
    const name = t.issueNameCn.trim();
    if (name && segment.includes(name)) score += 5;
    for (const ex of t.positiveExamples ?? []) {
      const e = ex.trim();
      if (e && (segment.includes(e) || lower.includes(e.toLowerCase()))) score += 3;
    }
    const desc = (t.issueDescription ?? '').trim();
    if (desc.length >= 2) {
      for (const token of desc.split(/[\s、,，；;]+/).filter((x) => x.length >= 2)) {
        if (segment.includes(token)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && bestScore >= 3) return best;
  // 弱匹配：名称单字过短则跳过
  for (const t of active) {
    const name = t.issueNameCn.trim();
    if (name.length >= 2 && segment.includes(name)) return t;
  }
  return null;
}

function resolveL1(
  item: IssueTaxonomyItem,
  byId: Map<string, IssueTaxonomyItem>,
): string {
  if (item.issueLevel === 1) return item.issueId;
  let cur: IssueTaxonomyItem | undefined = item;
  const seen = new Set<string>();
  while (cur?.parentIssueId && !seen.has(cur.issueId)) {
    seen.add(cur.issueId);
    const parent = byId.get(cur.parentIssueId);
    if (!parent) break;
    if (parent.issueLevel === 1) return parent.issueId;
    cur = parent;
  }
  return item.parentIssueId || item.issueId;
}

/**
 * Stub 分类器：规则拆句 + taxonomy 关键词命中。
 * 无证据 / 无命中 → 不上正式 issue。
 */
export function stubClassifyReview(input: {
  reviewText: string;
  taxonomy: IssueTaxonomyItem[];
}): StubClassifyResult {
  const text = input.reviewText ?? '';
  const taxonomy = input.taxonomy.filter((t) => t.activeStatus === 'active');
  const byId = new Map(taxonomy.map((t) => [t.issueId, t]));
  const missingTaxonomy = taxonomy.filter((t) => t.issueLevel >= 2).length === 0;

  const rawParts = splitSegments(text);
  const segments: StubSegment[] = [];
  const issues: StubIssue[] = [];
  let hasSafety = false;

  rawParts.forEach((part, idx) => {
    const offsets = findEvidenceOffsets(text, part);
    if (!offsets) return;
    const quote = sliceByCodePoints(text, offsets.start, offsets.end);
    if (!quote.trim()) return;

    const segmentId = randomUUID();
    const negHint =
      /不|差|烂|假|漏|拔干|刺激|过敏|疼|痒|退货|失望|贵|慢|破|脏/.test(part);
    const posHint = /好|喜欢|推荐|满意|不错|香|滋润/.test(part);
    const sentiment: StubSegment['sentiment'] = negHint
      ? 'negative'
      : posHint
        ? 'positive'
        : 'neutral';

    segments.push({
      segmentId,
      segmentIndex: idx,
      segmentTextOriginal: quote,
      sentiment,
      evidenceStart: offsets.start,
      evidenceEnd: offsets.end,
      segmentConfidence: 0.55,
      aspectTerm: null,
      opinionTerm: null,
    });

    if (sentiment !== 'negative' || missingTaxonomy) return;

    const hit = matchIssue(quote, taxonomy);
    if (!hit) return;

    const l1 = resolveL1(hit, byId);
    const l2 = hit.issueLevel === 2 ? hit.issueId : hit.issueLevel > 2 ? hit.parentIssueId : null;
    const l3 = hit.issueLevel === 3 ? hit.issueId : null;
    if (hit.isSafetyRelated) hasSafety = true;

    issues.push({
      reviewIssueId: randomUUID(),
      segmentId,
      issueL1Id: l1,
      issueL2Id: l2,
      issueL3Id: l3,
      issuePolarity: 'negative',
      severityLevel: hit.defaultSeverity,
      responsibleDomain: hit.issueOwnerTeam,
      evidenceQuoteOriginal: quote,
      classificationConfidence: 0.5,
      isSafetyRelated: hit.isSafetyRelated,
      isProductControllable: hit.isProductControllable,
    });
  });

  return { segments, issues, hasSafety, missingTaxonomy };
}
