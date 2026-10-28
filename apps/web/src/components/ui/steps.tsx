import * as React from 'react';
import { cn } from '@/lib/utils';

export type StepItem = {
  title: string;
  description?: string;
};

type StepsProps = {
  steps: StepItem[];
  /** 当前步骤，从 1 起；未传则全部为引导态（无高亮进度） */
  current?: number;
  className?: string;
};

/**
 * 横向步骤条（桌面）/ 纵向（窄屏），风格对齐现有 shadcn zinc。
 */
export function Steps({ steps, current, className }: StepsProps) {
  return (
    <ol
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0',
        className,
      )}
    >
      {steps.map((step, index) => {
        const n = index + 1;
        const done = current != null && n < current;
        const active = current != null && n === current;
        const idle = current == null;
        return (
          <li
            key={`${n}-${step.title}`}
            className={cn(
              'relative flex flex-1 gap-3 sm:flex-col sm:gap-2 sm:pr-6',
              index < steps.length - 1 &&
                'sm:after:absolute sm:after:left-[1.15rem] sm:after:top-4 sm:after:h-px sm:after:w-[calc(100%-1.15rem)] sm:after:bg-border',
            )}
          >
            <span
              className={cn(
                'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
                idle && 'border-border bg-background text-muted-foreground',
                done && 'border-foreground bg-foreground text-background',
                active && 'border-foreground bg-foreground text-background',
                current != null && !done && !active && 'border-border bg-muted text-muted-foreground',
              )}
            >
              {n}
            </span>
            <div className="min-w-0 space-y-0.5 pt-1 sm:pt-0">
              <p
                className={cn(
                  'text-sm font-medium leading-snug',
                  active || idle ? 'text-foreground' : done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.title}
              </p>
              {step.description ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
