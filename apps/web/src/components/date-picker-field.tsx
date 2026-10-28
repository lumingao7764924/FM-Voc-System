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
