import { useEffect, useState } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePickerField } from '@/components/date-picker-field';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

/** 列表统一筛选项（面板卡片内展示） */
export type ListFilterField = {
  id: string;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'select' | 'date';
  options?: Array<{ value: string; label: string }>;
  className?: string;
};

const ALL_VALUE = '__all__';

function countActiveFilters(values: Record<string, string>) {
  return Object.values(values).filter((v) => v != null && String(v).trim() !== '').length;
}

function FilterFields({
  filters,
  draftFilters,
  setDraftFilters,
  onEnterApply,
}: {
  filters: ListFilterField[];
  draftFilters: Record<string, string>;
  setDraftFilters: (next: Record<string, string>) => void;
  onEnterApply?: () => void;
}) {
  return (
    <div className="grid gap-3">
      {filters.map((f) => {
        const fieldId = `list-filter-${f.id}`;
        return (
          <div key={f.id} className={cn(f.className)}>
            {f.label ? <Label htmlFor={fieldId}>{f.label}</Label> : null}
            {f.type === 'select' ? (
              <Select
                value={
                  draftFilters[f.id] === '' || draftFilters[f.id] == null
                    ? ALL_VALUE
                    : draftFilters[f.id]
                }
                onValueChange={(v) => {
                  setDraftFilters({
                    ...draftFilters,
                    [f.id]: v === ALL_VALUE ? '' : v,
                  });
                }}
              >
                <SelectTrigger id={fieldId} className="w-full">
                  <SelectValue placeholder={f.placeholder ?? '请选择'} />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? []).map((opt) => (
                    <SelectItem
                      key={opt.value || ALL_VALUE}
                      value={opt.value === '' ? ALL_VALUE : opt.value}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : f.type === 'date' ? (
              <DatePickerField
                id={fieldId}
                value={draftFilters[f.id] ?? ''}
                onChange={(ymd) =>
                  setDraftFilters({ ...draftFilters, [f.id]: ymd })
                }
                placeholder={f.placeholder ?? '选择日期'}
              />
            ) : (
              <Input
                id={fieldId}
                type="text"
                placeholder={f.placeholder}
                value={draftFilters[f.id] ?? ''}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, [f.id]: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onEnterApply?.();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export type ListFiltersPanelProps = {
  filters: ListFilterField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  className?: string;
};

/**
 * 列表统一筛选入口：桌面 Popover 卡片，移动端底部 Sheet。
 */
export function ListFiltersPanel({
  filters,
  values,
  onChange,
  className,
}: ListFiltersPanelProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);

  useEffect(() => {
    setDraft(values);
  }, [values]);

  function apply(next: Record<string, string>) {
    onChange(next);
    setOpen(false);
  }

  function reset() {
    const empty: Record<string, string> = {};
    for (const f of filters) empty[f.id] = '';
    setDraft(empty);
    apply(empty);
  }

  const activeCount = countActiveFilters(values);

  const fields = (
    <FilterFields
      filters={filters}
      draftFilters={draft}
      setDraftFilters={setDraft}
      onEnterApply={() => apply(draft)}
    />
  );

  const actions = (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={reset}>
        重置
      </Button>
      <Button type="button" size="sm" className="gap-1.5" onClick={() => apply(draft)}>
        <Search className="size-3.5" />
        应用
      </Button>
    </>
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setOpen(true)}
          >
            <ListFilter className="size-3.5" />
            筛选
            {activeCount > 0 ? (
              <Badge variant="secondary" className="ml-0.5 font-normal">
                {activeCount}
              </Badge>
            ) : null}
          </Button>
          <SheetContent
            side="bottom"
            className="gap-0 rounded-t-xl p-0 max-h-[85dvh]"
          >
            <SheetHeader className="shrink-0 space-y-0 border-b px-6 py-4 pr-12 text-left">
              <SheetTitle>筛选条件</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
              {fields}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {actions}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <ListFilter className="size-3.5" />
              筛选
              {activeCount > 0 ? (
                <Badge variant="secondary" className="ml-0.5 font-normal">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-[min(36rem,80vh)] w-[22rem] flex-col gap-0 overflow-hidden p-0"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {fields}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-background p-3">
              {actions}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {activeCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={reset}
        >
          <X className="size-3.5" />
          清除
        </Button>
      ) : null}
    </div>
  );
}
