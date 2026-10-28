import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SETTINGS_PAGE_COPY } from '@voc/shared';
import { useAuth } from '@/hooks/use-auth';

export type WorkspaceTab =
  | { key: 'import'; kind: 'import'; title: string; path: string }
  | { key: 'product-import'; kind: 'product-import'; title: string; path: string }
  | { key: 'product-list'; kind: 'product-list'; title: string; path: string }
  | { key: 'review-list'; kind: 'review-list'; title: string; path: string }
  | { key: 'history'; kind: 'history'; title: string; path: string }
  | { key: 'analytics'; kind: 'analytics'; title: string; path: string }
  | { key: 'analysis-history'; kind: 'analysis-history'; title: string; path: string }
  | {
      key: string;
      kind: 'analysis-report';
      title: string;
      path: string;
      batchId: string;
    }
  | { key: 'taxonomy'; kind: 'taxonomy'; title: string; path: string }
  | { key: 'settings-accounts'; kind: 'settings-accounts'; title: string; path: string }
  | { key: 'settings-permissions'; kind: 'settings-permissions'; title: string; path: string }
  | { key: string; kind: 'batch'; title: string; path: string; batchId: string };

type WorkspaceTabsContextValue = {
  tabs: WorkspaceTab[];
  activeKey: string;
  openPath: (path: string, title?: string) => void;
  activate: (key: string) => void;
  closeTab: (key: string) => void;
  renameTab: (key: string, title: string) => void;
};

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(null);

const REVIEW_LIST_TAB: WorkspaceTab = {
  key: 'review-list',
  kind: 'review-list',
  title: '评论列表',
  path: '/reviews/list',
};

const IMPORT_TAB: WorkspaceTab = {
  key: 'import',
  kind: 'import',
  title: '评论导入',
  path: '/reviews/import',
};

const HISTORY_TAB: WorkspaceTab = {
  key: 'history',
  kind: 'history',
  title: '导入历史',
  path: '/reviews/history',
};

const PRODUCT_IMPORT_TAB: WorkspaceTab = {
  key: 'product-import',
  kind: 'product-import',
  title: '产品导入',
  path: '/products/import',
};

const PRODUCT_LIST_TAB: WorkspaceTab = {
  key: 'product-list',
  kind: 'product-list',
  title: '产品列表',
  path: '/products/list',
};

const ANALYTICS_TAB: WorkspaceTab = {
  key: 'analytics',
  kind: 'analytics',
  title: '评论分析',
  path: '/analytics',
};

const ANALYSIS_HISTORY_TAB: WorkspaceTab = {
  key: 'analysis-history',
  kind: 'analysis-history',
  title: '差评分析历史',
  path: '/analytics/history',
};

const TAXONOMY_TAB: WorkspaceTab = {
  key: 'taxonomy',
  kind: 'taxonomy',
  title: '问题分类树',
  path: '/taxonomy',
};

const ACCOUNTS_TAB: WorkspaceTab = {
  key: 'settings-accounts',
  kind: 'settings-accounts',
  title: SETTINGS_PAGE_COPY.accountsTitle,
  path: '/settings/accounts',
};

const PERMISSIONS_TAB: WorkspaceTab = {
  key: 'settings-permissions',
  kind: 'settings-permissions',
  title: SETTINGS_PAGE_COPY.permissionsTitle,
  path: '/settings/permissions',
};

function tabFromPath(pathname: string, title?: string): WorkspaceTab | null {
  if (
    pathname === '/reviews/list' ||
    pathname === '/reviews' ||
    pathname === '/'
  ) {
    return REVIEW_LIST_TAB;
  }
  if (pathname === '/reviews/import' || pathname === '/imports') {
    return IMPORT_TAB;
  }
  if (pathname === '/reviews/history' || pathname === '/history') {
    return HISTORY_TAB;
  }
  if (pathname === '/products/list' || pathname === '/products') {
    return PRODUCT_LIST_TAB;
  }
  if (pathname === '/products/import' || pathname === '/mapping') {
    return PRODUCT_IMPORT_TAB;
  }
  const analysisBatch = pathname.match(/^\/analytics\/batches\/([^/]+)$/);
  if (analysisBatch) {
    const batchId = analysisBatch[1]!;
    return {
      key: `analysis-report:${batchId}`,
      kind: 'analysis-report',
      batchId,
      path: `/analytics/batches/${batchId}`,
      title: title ?? `差评报告 ${batchId.slice(0, 8)}`,
    };
  }
  if (pathname === '/analytics/history' || pathname.startsWith('/analytics/history/')) {
    return ANALYSIS_HISTORY_TAB;
  }
  if (pathname === '/analytics' || pathname.startsWith('/analytics/')) {
    return ANALYTICS_TAB;
  }
  if (pathname === '/taxonomy' || pathname.startsWith('/taxonomy/')) {
    return TAXONOMY_TAB;
  }
  if (pathname === '/settings/accounts' || pathname.startsWith('/settings/accounts')) {
    return ACCOUNTS_TAB;
  }
  if (
    pathname === '/settings/permissions' ||
    pathname.startsWith('/settings/permissions')
  ) {
    return PERMISSIONS_TAB;
  }
  if (pathname === '/settings') {
    return ACCOUNTS_TAB;
  }

  const batch =
    pathname.match(/^\/reviews\/batches\/([^/]+)$/) ||
    pathname.match(/^\/imports\/([^/]+)$/);
  if (batch) {
    const batchId = batch[1]!;
    return {
      key: `batch:${batchId}`,
      kind: 'batch',
      batchId,
      path: `/reviews/batches/${batchId}`,
      title: title ?? `结果 ${batchId.slice(0, 8)}`,
    };
  }
  return null;
}

function homeTabFromPath(homePath: string): WorkspaceTab {
  return tabFromPath(homePath) ?? REVIEW_LIST_TAB;
}

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { homePath, loading } = useAuth();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeKey, setActiveKey] = useState('');
  const [bootstrapped, setBootstrapped] = useState(false);

  const ensureTab = useCallback((tab: WorkspaceTab, options?: { updateTitle?: boolean }) => {
    setTabs((prev) => {
      const exists = prev.some((t) => t.key === tab.key);
      if (exists) {
        if (options?.updateTitle && tab.title) {
          return prev.map((t) => (t.key === tab.key ? { ...t, title: tab.title } : t));
        }
        return prev;
      }
      return [...prev, tab];
    });
    setActiveKey(tab.key);
  }, []);

  // 权限就绪后：打开当前路由页签；无匹配则落到首页
  useEffect(() => {
    if (loading) return;
    const fromRoute = tabFromPath(location.pathname);
    const home = homeTabFromPath(homePath);
    if (!bootstrapped) {
      const initial = fromRoute ?? home;
      setTabs([initial]);
      setActiveKey(initial.key);
      setBootstrapped(true);
      if (!fromRoute && location.pathname !== home.path) {
        navigate(home.path, { replace: true });
      }
      return;
    }
    if (fromRoute) {
      ensureTab(fromRoute);
    }
  }, [loading, location.pathname, homePath, bootstrapped, ensureTab, navigate]);

  const openPath = useCallback(
    (path: string, title?: string) => {
      const tab = tabFromPath(path, title);
      if (!tab) return;
      ensureTab(tab, title ? { updateTitle: true } : undefined);
      if (location.pathname !== tab.path) navigate(tab.path);
    },
    [ensureTab, location.pathname, navigate],
  );

  const activate = useCallback(
    (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (!tab) return;
      setActiveKey(key);
      if (location.pathname !== tab.path) navigate(tab.path);
    },
    [tabs, location.pathname, navigate],
  );

  const closeTab = useCallback(
    (key: string) => {
      const home = homeTabFromPath(homePath);
      if (key === home.key) return;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        if (idx < 0) return prev;
        const next = prev.filter((t) => t.key !== key);
        if (activeKey === key) {
          const fallback = next[Math.max(0, idx - 1)] ?? home;
          setActiveKey(fallback.key);
          navigate(fallback.path);
        }
        return next.length ? next : [home];
      });
    },
    [activeKey, navigate, homePath],
  );

  const renameTab = useCallback((key: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, title } : t)));
  }, []);

  const value = useMemo(
    () => ({ tabs, activeKey, openPath, activate, closeTab, renameTab }),
    [tabs, activeKey, openPath, activate, closeTab, renameTab],
  );

  return (
    <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>
  );
}

export function useWorkspaceTabs() {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) throw new Error('useWorkspaceTabs must be used within WorkspaceTabsProvider');
  return ctx;
}

export {
  HISTORY_TAB,
  IMPORT_TAB,
  PRODUCT_IMPORT_TAB,
  PRODUCT_LIST_TAB,
  REVIEW_LIST_TAB,
  ANALYTICS_TAB,
  TAXONOMY_TAB,
  ACCOUNTS_TAB,
  PERMISSIONS_TAB,
};
