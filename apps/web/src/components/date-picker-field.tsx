import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function parseYmd(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function formatDisplay(s: string): string {
  const d = parseYmd(s);
  if (!d) return s;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

type DateRangeFieldProps = {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  id?: string;
  /** 同时展示的月份数；窄屏用 1，桌面用 2 */
  numberOfMonths?: number;
};

/** 范围时间选择器：按钮显示已选区间，点开后再在日历上选开始和结束。 */
export function DateRangeField({
  from,
  to,
  onChange,
  id,
  numberOfMonths = 2,
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const fromDate = from ? parseYmd(from) : undefined;
  const toDate = to ? parseYmd(to) : undefined;
  const selected = fromDate ? { from: fromDate, to: toDate } : undefined;
  const label =
    from && to
      ? `${formatDisplay(from)} 至 ${formatDisplay(to)}`
      : from
        ? `${formatDisplay(from)} 起`
        : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            'h-10 w-full justify-start gap-2 px-3 text-left font-normal',
            !label && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{label || '选择日期范围'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-date-range-popover
        className="w-auto p-0"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="px-3 pt-3 text-xs text-muted-foreground">先选开始日期，再选结束日期</p>
        <Calendar
          mode="range"
          selected={selected}
          onSelect={(range) => {
            const nextFrom = range?.from ? formatYmd(range.from) : '';
            const nextTo = range?.to ? formatYmd(range.to) : '';
            onChange({ from: nextFrom, to: nextTo });
            if (nextFrom && nextTo) setOpen(false);
          }}
          numberOfMonths={numberOfMonths}
          defaultMonth={fromDate}
          resetOnSelect
        />
      </PopoverContent>
    </Popover>
  );
}

type DatePickerFieldProps = {
  value: string;
  onChange: (ymd: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** 可选：限制可选范围 */
  fromDate?: Date;
  toDate?: Date;
};

/** shadcn Calendar + Popover 单日选择；value 为 YYYY-MM-DD */
export function DatePickerField({
  value,
  onChange,
  id,
  placeholder = '选择日期',
  className,
  fromDate,
  toDate,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseYmd(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            'h-10 w-full justify-start gap-2 px-3 text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{value ? formatDisplay(value) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? formatYmd(d) : '');
            setOpen(false);
          }}
          disabled={
            fromDate || toDate
              ? [
                  ...(fromDate ? [{ before: fromDate }] : []),
                  ...(toDate ? [{ after: toDate }] : []),
                ]
              : undefined
          }
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
