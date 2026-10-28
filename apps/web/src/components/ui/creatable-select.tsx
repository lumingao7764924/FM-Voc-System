import * as React from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type CreatableSelectOption = {
  value: string;
  label: string;
};

type CreatableSelectProps = {
  options: CreatableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
};

export function CreatableSelect({
  options,
  value,
  onChange,
  placeholder = '选择或输入',
  className,
  allowClear = true,
}: CreatableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const trimmed = draft.trim();
  const known = options.some((o) => o.value === trimmed);
  const showCreate = trimmed.length > 0 && !known;

  const display =
    options.find((o) => o.value === value)?.label ?? (value || placeholder);

  function commit(next: string) {
    onChange(next.trim());
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-[color,box-shadow]',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'dark:bg-input/30 dark:hover:bg-input/50',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{display}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] space-y-2 p-2"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Input
          ref={inputRef}
          value={draft}
          placeholder={placeholder}
          className="h-9"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            }
          }}
        />
        <ul className="max-h-52 space-y-0.5 overflow-y-auto">
          {allowClear && value ? (
            <li>
              <button
                type="button"
                className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => commit('')}
              >
                清除
              </button>
            </li>
          ) : null}
          {options.map((opt) => {
            const selected = value === opt.value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                  onClick={() => commit(opt.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {selected ? <CheckIcon className="size-3.5 shrink-0 opacity-70" /> : null}
                </button>
              </li>
            );
          })}
          {showCreate ? (
            <li>
              <button
                type="button"
                className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => commit(trimmed)}
              >
                使用「{trimmed}」
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
