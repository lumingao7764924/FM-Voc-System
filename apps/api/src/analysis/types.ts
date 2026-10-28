/** 分类器统一输出（stub / LLM 共用） */
export type ClassifySegment = {
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

export type ClassifyIssue = {
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

export type ClassifyResult = {
  segments: ClassifySegment[];
  issues: ClassifyIssue[];
  hasSafety: boolean;
  missingTaxonomy: boolean;
  /** 分类器标识，写入 run 时可覆盖 */
  modelVersion?: string;
  promptVersion?: string;
};
