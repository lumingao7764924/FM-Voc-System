/**
 * 前端拼列表 Query：统一 page / pageSize / q + 业务筛选项。
 */
export function buildListQuery(params: {
  page?: number;
  pageSize?: number;
  q?: string;
  [key: string]: string | number | undefined | null;
}): string {
  const sp = new URLSearchParams();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  sp.set('page', String(page));
  sp.set('pageSize', String(pageSize));
  for (const [k, v] of Object.entries(params)) {
    if (k === 'page' || k === 'pageSize') continue;
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  return sp.toString();
}
