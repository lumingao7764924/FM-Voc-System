import { Navigate, useLocation } from 'react-router-dom';
import { SETTINGS_PAGE_COPY } from '@voc/shared';
import { usePageAccess } from '@/hooks/use-auth';

/**
 * 页面级权限守卫。
 * - active：无权限时跳转首页
 * - 非 active（keep-alive 隐藏页签）：无权限时不渲染、不跳转
 */
export function RequirePageAccess({
  children,
  path,
  active = true,
}: {
  children: React.ReactNode;
  path?: string;
  active?: boolean;
}) {
  const loc = useLocation();
  const checkPath = path ?? loc.pathname;
  const { loading, allowed, homePath } = usePageAccess(checkPath);

  if (loading) {
    return active ? (
      <p className="p-6 text-sm text-muted-foreground">检查权限…</p>
    ) : null;
  }
  if (!allowed) {
    if (!active) return null;
    if (checkPath === homePath || loc.pathname === homePath) {
      return (
        <p className="p-6 text-sm text-muted-foreground">{SETTINGS_PAGE_COPY.noAccess}</p>
      );
    }
    return <Navigate to={homePath} replace />;
  }
  return <>{children}</>;
}
