import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  SETTINGS_PAGE_COPY,
  type AppUserListItem,
  type AppUserUpsertInput,
} from '@voc/shared';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/api';
import { PageHeader, PageTitle } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { toast } from '@/components/toast';
import { usePageRefresh, notifyPageRefresh } from '@/hooks/use-page-refresh';

export function AccountsPage() {
  const [items, setItems] = useState<AppUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AppUserListItem | null>(null);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    status: 'active' as 'active' | 'disabled',
  });
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: AppUserListItem[] }>('/api/admin/users');
      setItems(res.items);
    } catch (e) {
      toast({
        title: SETTINGS_PAGE_COPY.loadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePageRefresh('/settings/accounts', () => {
    void load();
  });

  function openCreate() {
    if (busy || deletingId) return;
    setEditing(null);
    setForm({ username: '', displayName: '', password: '', status: 'active' });
    setSheetOpen(true);
  }

  function openEdit(u: AppUserListItem) {
    if (busy || deletingId) return;
    setEditing(u);
    setForm({
      username: u.username,
      displayName: u.displayName ?? '',
      password: '',
      status: u.status === 'disabled' ? 'disabled' : 'active',
    });
    setSheetOpen(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (!editing && !form.password.trim()) {
        toast({
          title: SETTINGS_PAGE_COPY.passwordRequired,
          variant: 'destructive',
        });
        return;
      }
      const body: AppUserUpsertInput = {
        username: form.username.trim(),
        displayName: form.displayName.trim() || null,
        password: form.password.trim() || undefined,
        status: form.status,
        brandKeys: editing?.brandKeys ?? [],
        pageKeys: editing?.pageKeys ?? [],
      };
      if (editing) {
        await apiFetch(`/api/admin/users/${encodeURIComponent(editing.userId)}`, {
          method: 'PUT',
          json: body,
        });
      } else {
        await apiFetch('/api/admin/users', { method: 'POST', json: body });
      }
      setSheetOpen(false);
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

  async function onDelete(u: AppUserListItem) {
    if (u.isBootstrapAdmin || busy || deletingId) return;
    if (!window.confirm(`${SETTINGS_PAGE_COPY.confirmDeleteUser}\n${u.username}`)) return;
    setDeletingId(u.userId);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(u.userId)}`, {
        method: 'DELETE',
        json: {},
      });
      toast({ title: '已删除', variant: 'success' });
      notifyPageRefresh('/settings/accounts');
      notifyPageRefresh('/settings/permissions');
      await load();
    } catch (err) {
      toast({
        title: SETTINGS_PAGE_COPY.deleteFailed,
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  }

  const rowBusy = Boolean(busy || deletingId);

  const columns: DataTableColumn<AppUserListItem>[] = [
    {
      id: 'username',
      header: SETTINGS_PAGE_COPY.colUsername,
      cell: (r) => (
        <span className="font-medium">
          {r.username}
          {r.isBootstrapAdmin ? (
            <Badge variant="secondary" className="ml-2 font-normal">
              管理员
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'display',
      header: SETTINGS_PAGE_COPY.colDisplayName,
      cell: (r) => r.displayName || '—',
    },
    {
      id: 'status',
      header: SETTINGS_PAGE_COPY.colStatus,
      cell: (r) =>
        r.status === 'active' ? SETTINGS_PAGE_COPY.active : SETTINGS_PAGE_COPY.disabled,
    },
    {
      id: 'actions',
      header: SETTINGS_PAGE_COPY.colActions,
      cell: (r) =>
        r.isBootstrapAdmin ? (
          <span className="text-xs text-muted-foreground">
            {SETTINGS_PAGE_COPY.bootstrapLocked}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rowBusy}
              onClick={() => openEdit(r)}
            >
              {SETTINGS_PAGE_COPY.editUser}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-destructive hover:text-destructive"
              disabled={rowBusy}
              onClick={() => void onDelete(r)}
            >
              {deletingId === r.userId ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  删除中…
                </>
              ) : (
                SETTINGS_PAGE_COPY.deleteUser
              )}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={<PageTitle>{SETTINGS_PAGE_COPY.accountsTitle}</PageTitle>}
        actions={
          <Button type="button" size="sm" disabled={rowBusy} onClick={openCreate}>
            {SETTINGS_PAGE_COPY.createUser}
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={items}
        getRowKey={(r) => r.userId}
        loading={loading}
        pagination={false}
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setSheetOpen(open);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4 text-left">
            <SheetTitle>
              {editing ? SETTINGS_PAGE_COPY.editUser : SETTINGS_PAGE_COPY.createUser}
            </SheetTitle>
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => void onSave(e)}>
            <fieldset disabled={busy} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              <div>
                <Label>用户名</Label>
                <Input
                  value={form.username}
                  disabled={Boolean(editing) || busy}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>显示名</Label>
                <Input
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                />
              </div>
              <div>
                <Label>{editing ? '新密码（留空不改）' : '密码'}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required={!editing}
                />
              </div>
              <div>
                <Label>状态</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value === 'disabled' ? 'disabled' : 'active',
                    }))
                  }
                >
                  <option value="active">{SETTINGS_PAGE_COPY.active}</option>
                  <option value="disabled">{SETTINGS_PAGE_COPY.disabled}</option>
                </select>
              </div>
            </fieldset>
            <SheetFooter className="border-t px-6 py-3">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setSheetOpen(false)}
              >
                {SETTINGS_PAGE_COPY.cancel}
              </Button>
              <Button type="submit" disabled={busy} className="gap-1.5">
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    保存中…
                  </>
                ) : (
                  SETTINGS_PAGE_COPY.save
                )}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
