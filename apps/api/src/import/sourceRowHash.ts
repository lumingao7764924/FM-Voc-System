import { sha256Hex, canonicalJson } from '../crypto.js';

export type SourceRowHashInput = {
  brandKey: string;
  platform: string;
  platformSku: string;
  /** 查重用日期键：有时刻则含 HH:mm:ss */
  reviewDate: string;
  reviewDateKey?: string;
  rating: string | number | null | undefined;
  reviewText: string;
  reviewTitle: string;
  sourceReviewId?: string;
  mediaUrls?: string;
};

/**
 * 无正文、标题、平台评论 ID、媒体 → 没有可靠唯一键，不应做内容查重。
 */
export function isWeakSourceIdentity(input: {
  reviewText?: string;
  reviewTitle?: string;
  sourceReviewId?: string;
  mediaUrls?: string;
}): boolean {
  const has = (v?: string) => Boolean((v ?? '').trim());
  return !(
    has(input.reviewText) ||
    has(input.reviewTitle) ||
    has(input.sourceReviewId) ||
    has(input.mediaUrls)
  );
}

/**
 * 评论内容唯一键（文件内 + BigQuery 历史共用）。
 * 仅对强身份行用于查重；弱身份行导入时跳过查重（见 isWeakSourceIdentity）。
 *
 * 组成：brand+platform+sku+dateKey+rating+title+text+source_review_id+media_urls
 * dateKey 优先用 reviewDateKey（含源表时刻），提高同日不同时评论的区分度。
 */
export function computeSourceRowHash(input: SourceRowHashInput): string {
  return sha256Hex(
    canonicalJson({
      brand: input.brandKey ?? '',
      platform: input.platform ?? '',
      sku: input.platformSku ?? '',
      date: (input.reviewDateKey || input.reviewDate) ?? '',
      rating: input.rating ?? '',
      text: input.reviewText ?? '',
      title: input.reviewTitle ?? '',
      source_review_id: input.sourceReviewId ?? '',
      media_urls: input.mediaUrls ?? '',
    }),
  );
}
