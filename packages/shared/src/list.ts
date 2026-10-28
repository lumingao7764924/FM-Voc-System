/**
 * 列表接口统一分页约定（前后端共用）。
 *
 * Query：
 * - page: 1-based，默认 1
 * - pageSize: 每页条数，默认 20
 * - q: 可选全文/模糊搜索
 * 业务筛选项（brand、status 等）由各接口自行扩展，命名用小写短横或驼峰均可，推荐短词：brand、status
 *
 * Response 至少：
 * { items, total, page, pageSize }
 */

export interface ListPageQuery {
  page: number;
  pageSize: number;
  /** 通用模糊搜索（文件名 / SKU / 名称等，语义由接口定义） */
  q: string;
}

export interface PaginatedListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const LIST_DEFAULT_PAGE = 1;
export const LIST_DEFAULT_PAGE_SIZE = 20;
export const LIST_MAX_PAGE_SIZE = 200;
