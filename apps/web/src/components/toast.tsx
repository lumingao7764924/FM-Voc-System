import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'destructive';
};

type ToastListener = (t: ToastItem) => void;

const listeners = new Set<ToastListener>();

export function toast(input: Omit<ToastItem, 'id'> & { id?: string }) {
  const item: ToastItem = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title,
    description: input.description,
    variant: input.variant ?? 'default',
  };
  listeners.forEach((l) => l(item));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast: ToastListener = (t) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 4500);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(100vw-2.5rem,22rem)] flex-col gap-2 md:bottom-20">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded-lg border bg-card px-3 py-2.5 shadow-lg',
            t.variant === 'success' && 'border-emerald-500/40',
            t.variant === 'destructive' && 'border-destructive/50',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="关闭"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
