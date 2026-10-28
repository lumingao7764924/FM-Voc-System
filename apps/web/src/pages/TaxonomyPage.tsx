import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Upload } from 'lucide-react';
import { apiFetch, getCookie } from '../api';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InfoHint } from '@/components/info-hint';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { CreatableSelect } from '@/components/ui/creatable-select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PageHeader, PageTitle } from '@/components/page-header';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { usePageRefresh, notifyPageRefresh } from '@/hooks/use-page-refresh';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TAXONOMY_VERSION,
  TAXONOMY_PAGE_COPY,
  type IssueTaxonomyItem,
  type IssueTaxonomyListResponse,
  type IssueTaxonomyUploadResult,
  type IssueTaxonomyUpsertInput,
} from '@voc/shared';

const ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TAXONOMY_FLAG_OPTIONS = [
  { value: 'safety', label: TAXONOMY_PAGE_COPY.flagSafety },
  { value: 'product', label: TAXONOMY_PAGE_COPY.flagProduct },
  { value: 'logistics', label: TAXONOMY_PAGE_COPY.flagLogistics },
] as const;

const OWNER_TEAM_OPTIONS = [
  { value: 'product', label: TAXONOMY_PAGE_COPY.ownerProduct },
  { value: 'logistics', label: TAXONOMY_PAGE_COPY.ownerLogistics },
  { value: 'cs', label: TAXONOMY_PAGE_COPY.ownerCs },
  { value: 'ops', label: TAXONOMY_PAGE_COPY.ownerOps },
];

type TaxonomyFlagValue = (typeof TAXONOMY_FLAG_OPTIONS)[number]['value'];

function flagsFromForm(form: {
  isSafetyRelated: boolean;
  isProductControllable: boolean;
  isLogisticsRelated: boolean;
}): TaxonomyFlagValue[] {
  const out: TaxonomyFlagValue[] = [];
  if (form.isSafetyRelated) out.push('safety');
  if (form.isProductControllable) out.push('product');
  if (form.isLogisticsRelated) out.push('logistics');
  return out;
}

function flagsToFormPatch(values: string[]) {
  return {
    isSafetyRelated: values.includes('safety'),
    isProductControllable: values.includes('product'),
    isLogisticsRelated: values.includes('logistics'),
  };
}

type EditForm = {
  issueId: string;
  parentIssueId: string;
  issueLevel: string;
  issueNameCn: string;
  issueNameEn: string;
  issueDescription: string;
  issueOwnerTeam: string;
  defaultSeverity: string;
  isSafetyRelated: boolean;
  isProductControllable: boolean;
  isLogisticsRelated: boolean;
  activeStatus: string;
};

const EMPTY_FORM: EditForm = {
  issueId: '',
  parentIssueId: '',
  issueLevel: '2',
  issueNameCn: '',
  issueNameEn: '',
  issueDescription: '',
  issueOwnerTeam: '',
  defaultSeverity: '',
  isSafetyRelated: false,
  isProductControllable: false,
  isLogisticsRelated: false,
  activeStatus: 'active',
};

function itemToForm(item: IssueTaxonomyItem): EditForm {
  return {
    issueId: item.issueId,
    parentIssueId: item.parentIssueId ?? '',
    issueLevel: String(item.issueLevel),
    issueNameCn: item.issueNameCn,
    issueNameEn: item.issueNameEn ?? '',
    issueDescription: item.issueDescription ?? '',
    issueOwnerTeam: item.issueOwnerTeam ?? '',
    defaultSeverity: item.defaultSeverity != null ? String(item.defaultSeverity) : '',
    isSafetyRelated: item.isSafetyRelated,
    isProductControllable: item.isProductControllable,
    isLogisticsRelated: item.isLogisticsRelated,
    activeStatus: item.activeStatus,
  };
}

type TaxonomyTreeRow = {
  item: IssueTaxonomyItem;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

function buildTaxonomyTree(items: IssueTaxonomyItem[]) {
  const byId = new Map(items.map((i) => [i.issueId, i]));
  const childrenMap = new Map<string, IssueTaxonomyItem[]>();
  const roots: IssueTaxonomyItem[] = [];

  for (const item of items) {
    const parentId = item.parentIssueId?.trim();
    if (parentId && byId.has(parentId)) {
      const siblings = childrenMap.get(parentId) ?? [];
      siblings.push(item);
      childrenMap.set(parentId, siblings);
    } else {
      roots.push(item);
    }
  }

  const sortNodes = (nodes: IssueTaxonomyItem[]) =>
    [...nodes].sort((a, b) => a.issueId.localeCompare(b.issueId));
  for (const [pid, kids] of childrenMap) {
    childrenMap.set(pid, sortNodes(kids));
  }

  return { roots: sortNodes(roots), childrenMap };
}

function flattenTaxonomyTree(
  roots: IssueTaxonomyItem[],
  childrenMap: Map<string, IssueTaxonomyItem[]>,
  expandedKeys: Set<string>,
  depth = 0,
): TaxonomyTreeRow[] {
  const out: TaxonomyTreeRow[] = [];
  for (const item of roots) {
    const children = childrenMap.get(item.issueId) ?? [];
    const hasChildren = children.length > 0;
    const expanded = expandedKeys.has(item.issueId);
    out.push({ item, depth, hasChildren, expanded });
    if (hasChildren && expanded) {
      out.push(...flattenTaxonomyTree(children, childrenMap, expandedKeys, depth + 1));
    }
  }
  return out;
}

function parentIdsWithChildren(items: IssueTaxonomyItem[]): string[] {
  const ids = new Set<string>();
  const byId = new Set(items.map((i) => i.issueId));
  for (const i of items) {
    if (i.parentIssueId && byId.has(i.parentIssueId)) ids.add(i.parentIssueId);
  }
  return [...ids];
}

export function TaxonomyPage({ isActive = true }: { isActive?: boolean }) {
  const [version, setVersion] = useState(DEFAULT_TAXONOMY_VERSION);
  const [data, setData] = useState<IssueTaxonomyListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [editingExisting, setEditingExisting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<IssueTaxonomyListResponse>(
        `/api/taxonomy?version=${encodeURIComponent(version)}`,
      );
      setData(res);
      if (res.taxonomyVersion && res.taxonomyVersion !== version) {
        setVersion(res.taxonomyVersion);
      }
    } catch (e) {
      toast({
        title: TAXONOMY_PAGE_COPY.saveFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [version]);

  usePageRefresh('/taxonomy', () => {
    void load();
  });

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  useEffect(() => {
    const items = data?.items ?? [];
    if (!items.length) {
      setExpandedKeys(new Set());
      return;
    }
    setExpandedKeys(new Set(parentIdsWithChildren(items)));
  }, [version, data?.items]);

  const toggleExpand = useCallback((issueId: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const treeRows = useMemo(() => {
    const items = data?.items ?? [];
    if (!items.length) return [];
    const { roots, childrenMap } = buildTaxonomyTree(items);
    return flattenTaxonomyTree(roots, childrenMap, expandedKeys);
  }, [data?.items, expandedKeys]);

  const ownerOptions = useMemo(() => {
    const known = new Map(OWNER_TEAM_OPTIONS.map((o) => [o.value, o]));
    for (const item of data?.items ?? []) {
      const v = item.issueOwnerTeam?.trim();
      if (v && !known.has(v)) known.set(v, { value: v, label: v });
    }
    return [...known.values()];
  }, [data?.items]);

  const columns: DataTableColumn<TaxonomyTreeRow>[] = useMemo(
    () => [
      {
        id: 'name',
        header: TAXONOMY_PAGE_COPY.colName,
        cell: (r) => (
          <div
            className="flex min-w-0 items-center gap-0.5"
            style={{ paddingLeft: `${r.depth * 1.25}rem` }}
          >
            {r.hasChildren ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-expanded={r.expanded}
                onClick={() => toggleExpand(r.item.issueId)}
              >
                {r.expanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </Button>
            ) : (
              <span className="inline-block size-7 shrink-0" aria-hidden />
            )}
            <span
              className={cn('min-w-0 truncate', r.depth === 0 && 'font-medium')}
              style={{ opacity: Math.max(0.72, 1 - r.depth * 0.08) }}
            >
              {r.item.issueNameCn}
              {r.item.issueNameEn ? (
                <span className="ml-2 text-xs opacity-80">{r.item.issueNameEn}</span>
              ) : null}
            </span>
          </div>
        ),
      },
      {
        id: 'flags',
        header: TAXONOMY_PAGE_COPY.fieldFlags,
        cell: (r) => {
          const flags = [
            r.item.isSafetyRelated ? TAXONOMY_PAGE_COPY.flagSafety : null,
            r.item.isProductControllable ? TAXONOMY_PAGE_COPY.flagProduct : null,
            r.item.isLogisticsRelated ? TAXONOMY_PAGE_COPY.flagLogistics : null,
          ].filter(Boolean) as string[];
          if (!flags.length) return '—';
          return (
            <div className="flex flex-wrap gap-1">
              {flags.map((label) => (
                <Badge
                  key={label}
                  variant={label === TAXONOMY_PAGE_COPY.flagSafety ? 'destructive' : 'secondary'}
                >
                  {label}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: 'owner',
        header: TAXONOMY_PAGE_COPY.colOwner,
        cell: (r) => r.item.issueOwnerTeam || '—',
      },
      {
        id: 'status',
        header: TAXONOMY_PAGE_COPY.colStatus,
        cell: (r) =>
          r.item.activeStatus === 'active'
            ? TAXONOMY_PAGE_COPY.active
            : TAXONOMY_PAGE_COPY.inactive,
      },
      {
        id: 'actions',
        header: TAXONOMY_PAGE_COPY.colActions,
        cell: (r) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={Boolean(busy)}
            onClick={() => {
              if (busy) return;
              setEditingExisting(true);
              setForm(itemToForm(r.item));
              setSheetOpen(true);
            }}
          >
            <Pencil className="size-3.5" />
            {TAXONOMY_PAGE_COPY.edit}
          </Button>
        ),
      },
    ],
    [toggleExpand, busy],
  );

  async function downloadTemplate() {
    setBusy('template');
    try {
      const csrf = getCookie('voc_csrf');
      const res = await fetch('/api/taxonomy/template', {
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': csrf } : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = TAXONOMY_PAGE_COPY.templateFileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: TAXONOMY_PAGE_COPY.uploadFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const file = inputRef.current?.files?.[0];
    if (!file) {
      toast({ title: TAXONOMY_PAGE_COPY.needFile, variant: 'destructive' });
      return;
    }
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const csrf = getCookie('voc_csrf');
      const uploadRes = await fetch(
        `/api/taxonomy/file?version=${encodeURIComponent(version)}`,
        {
          method: 'POST',
          body: fd,
          credentials: 'include',
          headers: csrf ? { 'x-csrf-token': csrf } : undefined,
        },
      );
      const text = await uploadRes.text();
      const json: unknown = text ? JSON.parse(text) : null;
      if (!uploadRes.ok) {
        const msg =
          json && typeof json === 'object' && 'message' in json
            ? String((json as { message: string }).message)
            : uploadRes.statusText;
        throw new Error(msg);
      }
      const uploadResult = json as IssueTaxonomyUploadResult;
      toast({ title: uploadResult.message, variant: 'success' });
      if (inputRef.current) inputRef.current.value = '';
      notifyPageRefresh('/taxonomy');
      await load();
    } catch (err) {
      toast({
        title: TAXONOMY_PAGE_COPY.uploadFailed,
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  }

  async function onSave() {
    if (busy) return;
    setBusy('save');
    try {
      const body: IssueTaxonomyUpsertInput = {
        // 新建由后端按名称/层级自动生成；编辑沿用已有 id（表单不展示）
        issueId: editingExisting ? form.issueId.trim() || undefined : undefined,
        taxonomyVersion: version,
        parentIssueId: form.parentIssueId.trim() || null,
        issueLevel: Number(form.issueLevel),
        issueNameCn: form.issueNameCn.trim(),
        issueNameEn: form.issueNameEn.trim() || null,
        issueDescription: form.issueDescription.trim() || null,
        issueOwnerTeam: form.issueOwnerTeam.trim() || null,
        defaultSeverity: form.defaultSeverity ? Number(form.defaultSeverity) : null,
        isSafetyRelated: form.isSafetyRelated,
        isProductControllable: form.isProductControllable,
        isLogisticsRelated: form.isLogisticsRelated,
        activeStatus: form.activeStatus,
      };
      await apiFetch('/api/taxonomy', { method: 'POST', json: body });
      setSheetOpen(false);
      notifyPageRefresh('/taxonomy');
      await load();
    } catch (e) {
      toast({
        title: TAXONOMY_PAGE_COPY.saveFailed,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  }

  const versions = useMemo(() => {
    const list = data?.versions?.length ? [...data.versions] : [];
    if (!list.includes(DEFAULT_TAXONOMY_VERSION)) list.unshift(DEFAULT_TAXONOMY_VERSION);
    if (!list.includes(version)) list.push(version);
    return [...new Set(list)];
  }, [data?.versions, version]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <div className="flex items-center gap-1.5">
            <PageTitle>{TAXONOMY_PAGE_COPY.pageTitle}</PageTitle>
            <InfoHint title={TAXONOMY_PAGE_COPY.pageTitle} label="页面说明">
              {TAXONOMY_PAGE_COPY.pageHint}
            </InfoHint>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={TAXONOMY_PAGE_COPY.versionLabel}
              className="inline-flex items-center rounded-lg border border-border/80 bg-muted/50 p-0.5"
            >
              {versions.map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={version === v ? 'secondary' : 'ghost'}
                  className={
                    version === v
                      ? 'h-8 px-3 font-mono text-xs shadow-sm'
                      : 'h-8 px-3 font-mono text-xs text-muted-foreground'
                  }
                  onClick={() => setVersion(v)}
                >
                  {v}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={Boolean(busy)}
              onClick={() => void downloadTemplate()}
            >
              <Download className="size-3.5" />
              {TAXONOMY_PAGE_COPY.templateTitle}
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={Boolean(busy)}
              onClick={() => {
                if (busy) return;
                setEditingExisting(false);
                setForm({ ...EMPTY_FORM, issueLevel: '2' });
                setSheetOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              {TAXONOMY_PAGE_COPY.create}
            </Button>
          </div>
        }
      />

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void onUpload(e)}>
        <fieldset disabled={Boolean(busy)} className="flex flex-wrap items-end gap-3 disabled:opacity-70">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Label htmlFor="taxonomy-file" className="mb-0">
                {TAXONOMY_PAGE_COPY.import}
              </Label>
              <InfoHint title={TAXONOMY_PAGE_COPY.import} label="导入说明">
                {TAXONOMY_PAGE_COPY.templateDesc}
              </InfoHint>
            </div>
            <Input
              id="taxonomy-file"
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="max-w-xs cursor-pointer"
            />
          </div>
          <Button type="submit" size="sm" className="gap-1.5" disabled={Boolean(busy)}>
            {busy === 'upload' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {busy === 'upload' ? '导入中…' : TAXONOMY_PAGE_COPY.import}
          </Button>
        </fieldset>
      </form>

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : treeRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{TAXONOMY_PAGE_COPY.empty}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={treeRows}
          getRowKey={(r) => r.item.issueId}
          pagination={false}
        />
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (busy === 'save') return;
          setSheetOpen(open);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4 text-left">
            <SheetTitle>
              {editingExisting ? TAXONOMY_PAGE_COPY.edit : TAXONOMY_PAGE_COPY.create}
            </SheetTitle>
          </SheetHeader>
          <fieldset
            disabled={busy === 'save'}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 disabled:opacity-70"
          >
            <div>
              <Label>层级</Label>
              <Select
                value={form.issueLevel}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    issueLevel: v,
                    parentIssueId: v === '1' ? '' : f.parentIssueId,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">L1</SelectItem>
                  <SelectItem value="2">L2</SelectItem>
                  <SelectItem value="3">L3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.issueLevel !== '1' ? (
              <div>
                <Label>父级</Label>
                <Select
                  value={form.parentIssueId || undefined}
                  onValueChange={(v) => setForm((f) => ({ ...f, parentIssueId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择父级分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.items ?? [])
                      .filter((i) => i.issueLevel < Number(form.issueLevel))
                      .map((i) => (
                        <SelectItem key={i.issueId} value={i.issueId}>
                          {i.issueNameCn}
                          {i.issueNameEn ? ` · ${i.issueNameEn}` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div>
              <Label>中文名称</Label>
              <Input
                value={form.issueNameCn}
                onChange={(e) => setForm((f) => ({ ...f, issueNameCn: e.target.value }))}
              />
            </div>
            <div>
              <Label>英文名称</Label>
              <Input
                value={form.issueNameEn}
                onChange={(e) => setForm((f) => ({ ...f, issueNameEn: e.target.value }))}
              />
            </div>
            <div>
              <Label>说明</Label>
              <Input
                value={form.issueDescription}
                onChange={(e) => setForm((f) => ({ ...f, issueDescription: e.target.value }))}
              />
            </div>
            <div>
              <Label>{TAXONOMY_PAGE_COPY.colOwner}</Label>
              <CreatableSelect
                options={ownerOptions}
                value={form.issueOwnerTeam}
                onChange={(v) => setForm((f) => ({ ...f, issueOwnerTeam: v }))}
                placeholder={TAXONOMY_PAGE_COPY.ownerPlaceholder}
              />
            </div>
            <div>
              <Label>默认严重度 1～5</Label>
              <Input
                value={form.defaultSeverity}
                onChange={(e) => setForm((f) => ({ ...f, defaultSeverity: e.target.value }))}
              />
            </div>
            <div>
              <Label>{TAXONOMY_PAGE_COPY.fieldFlags}</Label>
              <MultiSelect
                options={[...TAXONOMY_FLAG_OPTIONS]}
                values={flagsFromForm(form)}
                onChange={(values) => setForm((f) => ({ ...f, ...flagsToFormPatch(values) }))}
                emptyLabel={TAXONOMY_PAGE_COPY.flagNone}
              />
            </div>
            <div>
              <Label>状态</Label>
              <Select
                value={form.activeStatus}
                onValueChange={(v) => setForm((f) => ({ ...f, activeStatus: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{TAXONOMY_PAGE_COPY.active}</SelectItem>
                  <SelectItem value="inactive">{TAXONOMY_PAGE_COPY.inactive}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </fieldset>
          <SheetFooter className="border-t px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              disabled={busy === 'save'}
              onClick={() => setSheetOpen(false)}
            >
              {TAXONOMY_PAGE_COPY.cancel}
            </Button>
            <Button
              type="button"
              disabled={busy === 'save'}
              className="gap-1.5"
              onClick={() => void onSave()}
            >
              {busy === 'save' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  保存中…
                </>
              ) : (
                TAXONOMY_PAGE_COPY.save
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
