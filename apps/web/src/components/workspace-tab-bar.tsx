import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { useAuth } from '@/hooks/use-auth';

export function WorkspaceTabBar() {
  const { tabs, activeKey, activate, closeTab } = useWorkspaceTabs();
  const { homePath } = useAuth();
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
  }, [activeKey, tabs.length]);

  return (
    <div className="flex h-12 shrink-0 items-center border-b bg-background/80 backdrop-blur">
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-3 py-1.5',
          'touch-pan-x [-webkit-overflow-scrolling:touch]',
        )}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const closable = tab.path !== homePath;
          return (
            <div
              key={tab.key}
              ref={active ? activeRef : undefined}
              className={cn(
                'group relative flex h-8 max-w-[12rem] shrink-0 items-center rounded-md px-1 transition-colors',
                active
                  ? 'bg-secondary text-secondary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-2 py-1 text-left text-[13px] font-medium"
                onClick={() => activate(tab.key)}
                title={tab.title}
              >
                {tab.title}
              </button>
              {closable ? (
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title}`}
                  className={cn(
                    'mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm',
                    'text-muted-foreground/70 transition hover:bg-background/80 hover:text-foreground',
                    active
                      ? 'opacity-70 hover:opacity-100'
                      : 'opacity-60 md:opacity-0 md:group-hover:opacity-70',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="w-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
