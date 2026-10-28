import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_PAGE_PERMISSION_GROUPS,
  SETTINGS_PAGE_COPY,
  type AppPageKey,
  type AppUserAccessUpdateInput,
  type AppUserListItem,
} from '@voc/shared';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/api';
import { PageHeader, PageTitle } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/toast';
import { usePageRefresh, notifyPageRefresh } from '@/hooks/use-page-refresh';

function PageCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function PermissionsPage() {
  const [items, setItems] = useState<AppUserListItem[]>([]);
  const [userId, setUserId] = useState('');
  const [brandsText, setBrandsText] = useState('');
  const [allBrands, setAllBrands] = useState(false);
  const [allPages, setAllPages] = useState(false);
  const [pages, setPages] = useState<AppPageKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const editableItems = useMemo(
    () => items.filter((u) => !u.isBootstrapAdmin),
    [items],
  );

  const selected = items.find((u) => u.userId === userId) ?? null;
  const locked = Boolean(selected?.isBootstrapAdmin);

  function selectUser(u: AppUserListItem) {
    setUserId(u.userId);
    setAllBrands(u.brandKeys === '*');
    setBrandsText(u.brandKeys === '*' ? '' : u.brandKeys.join(', '));
    if (u.pageKeys === '*') {
      setAllPages(true);
      setPages([]);
    } else {
      setAllPages(false);
      setPages([...u.pageKeys]);
    }
  }

  function togglePage(key: AppPageKey, on: boolean) {
    setAllPages(false);
    setPages((prev) => {
      if (on) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((p) => p !== key);
    });
  }

  function toggleGroup(keys: AppPageKey[], on: boolean) {
    setAllPages(false);
    setPages((prev) => {
      if (on) {
        const set = new Set(prev);
        keys.forEach((k) => set.add(k));
        return [...set];
      }
      return prev.filter((p) => !keys.includes(p));
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: AppUserListItem[] }>('/api/admin/users');
      setItems(res.items);
      const editable = res.items.filter((u) => !u.isBootstrapAdmin);
      const keep = editable.find((u) => u.userId === userId);
      if (keep) {
        selectUser(keep);
      } else if (editable[0]) {
        selectUser(editable[0]);
      } else {
        setUserId('');
      }
    } catch (e) {
      toast({
        title: SETTINGS_PAGE_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏
  }, []);

  usePageRefresh('/settings/permissions', () => {
    void load();
  });

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!userId || locked) {
      toast({
        title: SETTINGS_PAGE_COPY.bootstrapNoPermissionEdit,
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      const brandKeys: string[] | '*' = allBrands
        ? '*'
        : brandsText
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
      const pageKeys: AppPageKey[] | '*' = allPages ? '*' : pages;
      const body: AppUserAccessUpdateInput = {
        brandKeys,
        countryCodes: [],
        pageKeys,
      };
      await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/access`, {
        method: 'PUT',
        json: body,
      });
      toast({ title: '已保存', variant: 'success' });
      notifyPageRefresh('/settings/accounts');
      notifyPageRefresh('/settings/permissions');
      await load();
    } catch (err) {
      toast({
        title: SETTINGS_PAGE_COPY.saveFailed,
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={<PageTitle>{SETTINGS_PAGE_COPY.permissionsTitle}</PageTitle>}
      />
      <p className="text-sm text-muted-foreground">{SETTINGS_PAGE_COPY.permissionsHint}</p>
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : editableItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无可配置权限的账号（超级管理员权限固定，不可修改）。请先在「账号」中新建普通账号。
        </p>
      ) : (
        <form className="max-w-lg space-y-5" onSubmit={(e) => void onSave(e)}>
          <fieldset disabled={busy || locked} className="space-y-5 disabled:opacity-70">
            <div>
              <Label>选择账号</Label>
              <Select
                value={userId || undefined}
                disabled={busy}
                onValueChange={(id) => {
                  if (busy) return;
                  const hit = editableItems.find((u) => u.userId === id);
                  if (hit) selectUser(hit);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择用户" />
                </SelectTrigger>
                <SelectContent>
                  {editableItems.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.username}
                      {u.displayName ? ` · ${u.displayName}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{SETTINGS_PAGE_COPY.colBrands}</Label>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allBrands}
                  onChange={(e) => setAllBrands(e.target.checked)}
                />
                {SETTINGS_PAGE_COPY.brandsAll}
              </label>
              {!allBrands ? (
                <Input
                  value={brandsText}
                  placeholder="SKT, TP"
                  onChange={(e) => setBrandsText(e.target.value)}
                />
              ) : null}
            </div>

            <div className="space-y-3">
              <div>
                <Label>{SETTINGS_PAGE_COPY.pagesLabel}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{SETTINGS_PAGE_COPY.pagesHint}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allPages}
                  onChange={(e) => {
                    setAllPages(e.target.checked);
                    if (e.target.checked) setPages([]);
                  }}
                />
                {SETTINGS_PAGE_COPY.pagesAll}
              </label>
              {!allPages
                ? APP_PAGE_PERMISSION_GROUPS.map((group) => {
                    const keys = group.pages.map((p) => p.key);
                    const allOn = keys.every((k) => pages.includes(k));
                    const someOn = keys.some((k) => pages.includes(k));
                    return (
                      <div key={group.title} className="space-y-1.5 rounded-md border px-3 py-2.5">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={allOn}
                            ref={(el) => {
                              if (el) el.indeterminate = !allOn && someOn;
                            }}
                            onChange={(e) => toggleGroup(keys, e.target.checked)}
                          />
                          {group.title}
                        </label>
                        <div className="ml-5 space-y-1.5">
                          {group.pages.map((p) => (
                            <PageCheck
                              key={p.key}
                              label={p.label}
                              checked={pages.includes(p.key)}
                              onChange={(v) => togglePage(p.key, v)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          </fieldset>

          <Button type="submit" disabled={busy || !userId || locked} className="gap-1.5">
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                保存中…
              </>
            ) : (
              SETTINGS_PAGE_COPY.save
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
