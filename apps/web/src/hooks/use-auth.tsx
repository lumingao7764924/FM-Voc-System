import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  canAccessPage,
  firstAllowedPath,
  pathToPageKey,
  type AccessPolicy,
  type AppPageKey,
  type AuthMeResponse,
} from '@voc/shared';
import { apiFetch, setSessionKey } from '@/api';

type AuthContextValue = {
  loading: boolean;
  access: AccessPolicy | null;
  username: string | null;
  refresh: () => Promise<void>;
  can: (page: AppPageKey) => boolean;
  canFlag: (flag: keyof AccessPolicy['flags']) => boolean;
  homePath: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<AccessPolicy | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiFetch<AuthMeResponse>('/api/auth/me');
      setAccess(me.access);
      setUsername(me.username);
    } catch {
      setSessionKey(null);
      setAccess(null);
      setUsername(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => {
    const homePath = access ? firstAllowedPath(access) : '/reviews/list';
    return {
      loading,
      access,
      username,
      refresh,
      can: (page) => (access ? canAccessPage(access, page) : false),
      canFlag: (flag) => Boolean(access?.flags[flag]),
      homePath,
    };
  }, [loading, access, username, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** 页面级权限；未登录/加载中由外层 RequireAuth 处理 */
export function usePageAccess(pathname: string) {
  const { access, loading, homePath, can } = useAuth();
  const page = pathToPageKey(pathname);
  // 报告页：有「评论分析」或「差评分析历史」任一即可
  const allowed =
    page == null
      ? true
      : pathname.startsWith('/analytics/batches/')
        ? can('analytics') || can('analytics.history')
        : can(page);
  return { loading, allowed, page, homePath, access };
}
