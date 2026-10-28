import * as React from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type MultiSelectOption = {
  value: string;
  label: string;
};

type MultiSelectProps = {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  emptyLabel?: string;
};

export function MultiSelect({
  options,
  values,
  onChange,
  placeholder = '请选择',
  className,
  emptyLabel = '未选择',
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.filter((o) => values.includes(o.value));
  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.map((o) => o.label).join('、');

  function toggle(value: string) {
    if (values.includes(value)) onChange(values.filter((v) => v !== value));
    else onChange([...values, value]);
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
            selected.length === 0 && 'text-muted-foreground',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{summary || placeholder}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                  onClick={() => toggle(opt.value)}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-sm border border-input',
                      checked && 'border-primary bg-primary text-primary-foreground',
                    )}
                    aria-hidden
                  >
                    {checked ? <CheckIcon className="size-3" /> : null}
                  </span>
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
