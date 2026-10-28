import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChartColumn,
  History,
  KeyRound,
  List,
  Menu,
  MessageSquareText,
  Package,
  Tags,
  Upload,
  Users,
} from 'lucide-react';
import {
  canAccessPage,
  firstAllowedInGroup,
  firstAllowedPath,
  SETTINGS_PAGE_COPY,
  type AppGroupKey,
  type AppPageKey,
} from '@voc/shared';
import { apiFetch, setSessionKey } from './api';
import { LoginPage } from './pages/LoginPage';
import { TaskDock } from '@/components/task-dock';
import { ToastHost } from '@/components/toast';
import { WorkspaceTabBar } from '@/components/workspace-tab-bar';
import { WorkspacePanels } from '@/components/workspace-panels';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/components/workspace-tabs';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: typeof Upload;
  page: AppPageKey;
  match: (p: string) => boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: '评论',
    items: [
      {
        to: '/reviews/list',
        label: '评论列表',
        icon: MessageSquareText,
        page: 'reviews.list',
        match: (p) => p === '/reviews/list' || p === '/reviews',
      },
      {
        to: '/reviews/import',
        label: '评论导入',
        icon: Upload,
        page: 'reviews.import',
        match: (p) =>
          p === '/reviews/import' ||
          p.startsWith('/reviews/batches/') ||
          p === '/imports' ||
          p.startsWith('/imports/'),
      },
      {
        to: '/reviews/history',
        label: '导入历史',
        icon: History,
        page: 'reviews.history',
        match: (p) => p === '/reviews/history' || p.startsWith('/history'),
      },
    ],
  },
  {
    title: '产品',
    items: [
      {
        to: '/products/list',
        label: '产品列表',
        icon: List,
        page: 'products.list',
        match: (p) => p === '/products/list' || p === '/products',
      },
      {
        to: '/products/import',
        label: '产品导入',
        icon: Package,
        page: 'products.import',
        match: (p) => p === '/products/import' || p === '/mapping',
      },
    ],
  },
  {
    title: '分析',
    items: [
      {
        to: '/analytics',
        label: '评论分析',
        icon: ChartColumn,
        page: 'analytics',
        match: (p) => p === '/analytics',
      },
      {
        to: '/analytics/history',
        label: '差评分析历史',
        icon: History,
        page: 'analytics.history',
        match: (p) => p === '/analytics/history' || p.startsWith('/analytics/history/'),
      },
      {
        to: '/taxonomy',
        label: '问题分类树',
        icon: Tags,
        page: 'taxonomy',
        match: (p) => p === '/taxonomy' || p.startsWith('/taxonomy/'),
      },
    ],
  },
  {
    title: SETTINGS_PAGE_COPY.navGroup,
    items: [
      {
        to: '/settings/accounts',
        label: SETTINGS_PAGE_COPY.accountsTitle,
        icon: Users,
        page: 'settings.accounts',
        match: (p) => p === '/settings/accounts' || p.startsWith('/settings/accounts/'),
      },
      {
        to: '/settings/permissions',
        label: SETTINGS_PAGE_COPY.permissionsTitle,
        icon: KeyRound,
        page: 'settings.permissions',
        match: (p) =>
          p === '/settings/permissions' || p.startsWith('/settings/permissions/'),
      },
    ],
  },
];

function groupHasActive(group: NavGroup, pathname: string) {
  return group.items.some((item) => item.match(pathname));
}

function BrandMark({ className }: { className?: string }) {
  const [dryRun, setDryRun] = useState(false);

  useEffect(() => {
    void apiFetch<{ dryRun?: boolean }>('/api/health', { encrypt: false })
      .then((res) => setDryRun(Boolean(res.dryRun)))
      .catch(() => setDryRun(false));
  }, []);

  return (
    <div className={cn('flex items-center justify-start gap-2', className)}>
      <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
        V
      </div>
      <p className="text-sm font-semibold">Feimei VOC</p>
      {dryRun ? (
        <Tags className="size-3.5 text-amber-500" aria-label="干跑模式" strokeWidth={2} />
      ) : null}
    </div>
  );
}

function NavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const { openPath } = useWorkspaceTabs();
  const { access } = useAuth();
  const loc = useLocation();
  const visibleGroups = useMemo(() => {
    if (!access) return [];
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => canAccessPage(access, item.page)),
    })).filter((g) => g.items.length > 0);
  }, [access]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV_GROUPS.map((g) => [g.title, true])),
  );

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const group of visibleGroups) {
        if (groupHasActive(group, loc.pathname)) next[group.title] = true;
      }
      return next;
    });
  }, [loc.pathname, visibleGroups]);

  function toggleGroup(title: string) {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  return (
    <nav className={cn('flex flex-col gap-2', className)}>
      {visibleGroups.map((group) => {
        const open = openGroups[group.title] ?? true;
        return (
          <div key={group.title} className="space-y-0.5">
            <button
              type="button"
              onClick={() => toggleGroup(group.title)}
              aria-expanded={open}
              className="flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-left text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  !open && '-rotate-90',
                )}
              />
              {group.title}
            </button>
            {open ? (
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.match(loc.pathname);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.to}
                      type="button"
                      onClick={() => {
                        openPath(item.to);
                        onNavigate?.();
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function Shell() {
  const nav = useNavigate();
  const { username, refresh } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    setMobileOpen(false);
    await apiFetch('/api/auth/logout', { method: 'POST', json: {}, encrypt: false });
    setSessionKey(null);
    await refresh();
    nav('/login');
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden md:flex-row">
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <BrandMark />
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <NavLinks />
          <div className="mt-auto space-y-2 pt-6">
            {username ? (
              <p className="truncate text-xs text-muted-foreground" title={username}>
                {username}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">外观</span>
              <ThemeToggle />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void logout()}>
              退出登录
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          <BrandMark />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="打开菜单">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-full">
                <SheetHeader className="items-start border-b px-4 py-4">
                  <SheetTitle className="sr-only">菜单</SheetTitle>
                  <BrandMark />
                </SheetHeader>
                <div className="flex h-full flex-1 flex-col p-4">
                  <NavLinks onNavigate={() => setMobileOpen(false)} />
                  <Separator className="my-4" />
                  {username ? (
                    <p className="mb-2 text-xs text-muted-foreground">{username}</p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-auto w-full"
                    onClick={() => void logout()}
                  >
                    退出登录
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <WorkspaceTabBar />

        <main className="flex min-h-0 flex-1 flex-col bg-muted/30">
          <WorkspacePanels />
        </main>
      </div>

      <TaskDock />
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <WorkspaceTabsProvider>
      <Shell />
    </WorkspaceTabsProvider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, access } = useAuth();
  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">检查登录状态…</p>;
  }
  if (!access) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 根路径 / 各大类入口：按权限落到第一个可访问页 */
function PermissionHomeRedirect({ group }: { group?: AppGroupKey }) {
  const { loading, access, homePath } = useAuth();
  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">检查权限…</p>;
  }
  if (!access) return <Navigate to="/login" replace />;
  const target = group
    ? firstAllowedInGroup(access, group) ?? homePath
    : firstAllowedPath(access);
  return <Navigate to={target} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <PermissionHomeRedirect />
              </RequireAuth>
            }
          />
          <Route
            path="/reviews"
            element={
              <RequireAuth>
                <PermissionHomeRedirect group="reviews" />
              </RequireAuth>
            }
          />
          <Route
            path="/products"
            element={
              <RequireAuth>
                <PermissionHomeRedirect group="products" />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <PermissionHomeRedirect group="settings" />
              </RequireAuth>
            }
          />
          <Route path="/mapping" element={<Navigate to="/products/import" replace />} />
          <Route path="/imports" element={<Navigate to="/reviews/import" replace />} />
          <Route path="/imports/:id" element={<LegacyImportBatchRedirect />} />
          <Route path="/history" element={<Navigate to="/reviews/history" replace />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AuthenticatedApp />
              </RequireAuth>
            }
          />
        </Routes>
        <ToastHost />
      </>
    </AuthProvider>
  );
}

function LegacyImportBatchRedirect() {
  const { id } = useParams();
  return <Navigate to={`/reviews/batches/${id ?? ''}`} replace />;
}
