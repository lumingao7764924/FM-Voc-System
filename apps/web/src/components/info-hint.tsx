import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-is-mobile';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type InfoHintProps = {
  /** 说明正文 */
  children: ReactNode;
  /** 弹层标题，默认「说明」 */
  title?: string;
  /** 触发按钮额外 class */
  className?: string;
  /** 无障碍：简述点什么 */
  label?: string;
};

const HintTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<'button'> & { label: string }
>(function HintTrigger({ className, label, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-full',
        'bg-amber-500/15 text-amber-600 dark:bg-amber-400/20 dark:text-amber-400',
        'transition-colors hover:bg-amber-500/25 hover:text-amber-700',
        'dark:hover:bg-amber-400/30 dark:hover:text-amber-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <CircleAlert className="size-2.5" strokeWidth={2.5} aria-hidden />
    </button>
  );
});

/**
 * 可复用叹号说明：桌面 Popover，移动端底部 Sheet。
 * 用在标题 / 指标旁，避免大段说明常驻占版面。
 */
export function InfoHint({
  children,
  title = '说明',
  className,
  label = '查看说明',
}: InfoHintProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <HintTrigger className={className} label={label} />
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription asChild>
              <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HintTrigger className={className} label={label} />
      </PopoverTrigger>
      <PopoverContent align="start" className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
