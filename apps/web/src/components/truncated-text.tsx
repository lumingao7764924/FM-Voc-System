import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

type TruncatedTextProps = {
  text: string | null | undefined;
  /** 空值展示，默认 - */
  empty?: string;
  className?: string;
  contentClassName?: string;
};

/**
 * 表格等场景的溢出省略：桌面悬停、移动端点击查看全文。
 * 未溢出时不出现浮层。
 */
export function TruncatedText({
  text,
  empty = '-',
  className,
  contentClassName,
}: TruncatedTextProps) {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);

  const raw = text?.trim() ?? '';
  const display = raw || empty;
  const canPreview = Boolean(raw);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [display]);

  useEffect(() => {
    if (!overflow) setOpen(false);
  }, [overflow]);

  if (!canPreview) {
    return <span className={cn('block min-w-0 truncate', className)}>{empty}</span>;
  }

  return (
    <Popover
      open={overflow && open}
      onOpenChange={(next) => {
        if (isMobile && overflow) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'block w-full min-w-0 max-w-full border-0 bg-transparent p-0 text-left',
            overflow && isMobile ? 'cursor-pointer' : 'cursor-default',
          )}
          onMouseEnter={() => {
            if (!isMobile && overflow) setOpen(true);
          }}
          onMouseLeave={() => {
            if (!isMobile) setOpen(false);
          }}
          onClick={(e) => {
            if (!isMobile || !overflow) {
              e.preventDefault();
              return;
            }
            setOpen((v) => !v);
          }}
        >
          <span ref={ref} className={cn('block min-w-0 truncate', className)}>
            {display}
          </span>
        </button>
      </PopoverTrigger>
      {overflow ? (
        <PopoverContent
          align="start"
          side="top"
          className={cn(
            'max-h-64 w-auto max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto whitespace-pre-wrap break-words text-xs font-normal leading-relaxed',
            contentClassName,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={() => {
            if (!isMobile) setOpen(true);
          }}
          onMouseLeave={() => {
            if (!isMobile) setOpen(false);
          }}
        >
          {raw}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
