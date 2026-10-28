import { useEffect, useRef } from 'react';

const PAGE_REFRESH = 'voc:page-refresh';

type PageRefreshDetail = { routes: string[] };

/** 路由规范化：与页面 path 一致，作为刷新 key（多开结果页 = 各自完整 path） */
export function routeKey(path: string): string {
  const bare = path.split('?')[0]?.split('#')[0] ?? path;
  const normalized = bare.replace(/\/+$/, '');
  return normalized || '/';
}

/**
 * 按路由通知刷新。新页面无需改 hook，只要 path 对上即可。
 * @example notifyPageRefresh('/reviews/history')
 * @example notifyPageRefresh(['/reviews/history', `/reviews/batches/${id}`])
 */
export function notifyPageRefresh(routes: string | string[]) {
  const list = (Array.isArray(routes) ? routes : [routes])
    .map(routeKey)
    .filter(Boolean);
  if (list.length === 0) return;
  window.dispatchEvent(
    new CustomEvent<PageRefreshDetail>(PAGE_REFRESH, { detail: { routes: list } }),
  );
}

/**
 * 订阅本页路由的刷新。传页面自己的 path（与 workspace tab.path / URL 一致）。
 * 多开实例各自传完整 path，例如 `/reviews/batches/<id>`，互不干扰。
 */
export function usePageRefresh(routes: string | string[], onRefresh: () => void) {
  const wantedKey = (Array.isArray(routes) ? routes : [routes]).map(routeKey).join('\0');
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const wanted = new Set(wantedKey.split('\0').filter(Boolean));
    if (wanted.size === 0) return;

    function handler(ev: Event) {
      const emitted = (ev as CustomEvent<PageRefreshDetail>).detail?.routes ?? [];
      if (emitted.some((r) => wanted.has(routeKey(r)))) {
        onRefreshRef.current();
      }
    }

    window.addEventListener(PAGE_REFRESH, handler);
    return () => window.removeEventListener(PAGE_REFRESH, handler);
  }, [wantedKey]);
}
