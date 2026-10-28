import {
  LIST_DEFAULT_PAGE,
  LIST_DEFAULT_PAGE_SIZE,
  LIST_MAX_PAGE_SIZE,
  type ListPageQuery,
  type PaginatedListResponse,
} from '@voc/shared';

/** 从 Fastify query 解析统一分页 + q */
export function parseListQuery(
  query: Record<string, unknown>,
  opts?: { defaultPageSize?: number; maxPageSize?: number },
): ListPageQuery & { offset: number } {
  const maxPageSize = opts?.maxPageSize ?? LIST_MAX_PAGE_SIZE;
  const defaultPageSize = opts?.defaultPageSize ?? LIST_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, Number(query.pageSize ?? query.limit ?? defaultPageSize) || defaultPageSize),
  );
  const page = Math.max(1, Number(query.page ?? LIST_DEFAULT_PAGE) || LIST_DEFAULT_PAGE);
  const offset =
    query.offset != null && query.offset !== ''
      ? Math.max(0, Number(query.offset) || 0)
      : (page - 1) * pageSize;
  const q = String(query.q ?? '')
    .trim()
    .toLowerCase();
  return { page, pageSize, offset, q };
}

export function queryStr(query: Record<string, unknown>, key: string): string {
  const v = query[key];
  if (v == null) return '';
  return String(v).trim();
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedListResponse<T> {
  return { items, total, page, pageSize };
}
