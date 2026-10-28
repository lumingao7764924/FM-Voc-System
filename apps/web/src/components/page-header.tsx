import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 工作台页面主标题：各业务页统一字号与字重 */
export function PageTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1 className={cn('text-2xl font-semibold tracking-tight', className)}>{children}</h1>
  );
}

/** 标题行：左侧标题（可带徽章等），右侧操作 */
export function PageHeader({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  /** 标题同行附加内容（如 Badge） */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {typeof title === 'string' || typeof title === 'number' ? (
          <PageTitle>{title}</PageTitle>
        ) : (
          title
        )}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
