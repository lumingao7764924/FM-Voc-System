import { FormEvent, useCallback, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import type { ProductMappingUploadResult } from '@voc/shared';
import { MAPPING_PAGE_COPY } from '@voc/shared';
import { getCookie } from '../api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { PageTitle } from '@/components/page-header';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { notifyPageRefresh } from '@/hooks/use-page-refresh';
import { cn } from '@/lib/utils';

const ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isXlsx(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.xlsx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

export function ProductImportPage() {
  const { openPath } = useWorkspaceTabs();
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ProductMappingUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback((next: File | null) => {
    if (!next) {
      setFile(null);
      return;
    }
    if (!isXlsx(next)) {
      toast({ title: MAPPING_PAGE_COPY.needFile, variant: 'destructive' });
      return;
    }
    setResult(null);
    setFile(next);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!file) {
      toast({ title: MAPPING_PAGE_COPY.needFile, variant: 'destructive' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const csrf = getCookie('voc_csrf');
      const uploadRes = await fetch('/api/mappings/file', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': csrf } : undefined,
      });
      const text = await uploadRes.text();
      const data: unknown = text ? JSON.parse(text) : null;
      if (!uploadRes.ok) {
        const msg =
          data && typeof data === 'object' && 'message' in data
            ? String((data as { message: string }).message)
            : uploadRes.statusText;
        throw new Error(msg);
      }
      setResult(data as ProductMappingUploadResult);
      setFile(null);
      setFileKey((k) => k + 1);
      notifyPageRefresh('/products/list');
    } catch (err) {
      toast({
        title: MAPPING_PAGE_COPY.uploadFailed,
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <PageTitle>{MAPPING_PAGE_COPY.title}</PageTitle>
      </header>

      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <fieldset disabled={loading} className="space-y-4 disabled:opacity-70">
          {result ? (
            <div className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>
                  {MAPPING_PAGE_COPY.resultAdded} {result.added} · {MAPPING_PAGE_COPY.resultUpdated}{' '}
                  {result.updated}
                  {result.duplicateSkipped
                    ? ` · ${MAPPING_PAGE_COPY.resultDuplicate} ${result.duplicateSkipped}`
                    : ''}
                  {result.noSkuSkipped
                    ? ` · ${MAPPING_PAGE_COPY.resultNoSku} ${result.noSkuSkipped}`
                    : ''}
                  （入库 {result.totalRows} 行）
                </span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  disabled={loading}
                  onClick={() => openPath('/products/list')}
                >
                  {MAPPING_PAGE_COPY.goToList}
                </Button>
              </div>
            </div>
          ) : null}

          <div
            role="button"
            tabIndex={loading ? -1 : 0}
            aria-disabled={loading}
            onKeyDown={(e) => {
              if (loading) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onClick={() => {
              if (!loading) inputRef.current?.click();
            }}
            onDragEnter={(e) => {
              if (loading) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              if (loading) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (loading) return;
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              'group relative flex min-h-[10rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center transition',
              'border-border/80 bg-muted/20 hover:border-foreground/25 hover:bg-muted/35',
              dragging && 'border-foreground/40 bg-muted/50',
              loading && 'pointer-events-none cursor-wait',
            )}
          >
            <input
              key={fileKey}
              ref={inputRef}
              id="product-import-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={loading}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <span
              className={cn(
                'flex size-12 items-center justify-center rounded-full border bg-background/80 text-muted-foreground transition group-hover:text-foreground',
                dragging && 'text-foreground',
              )}
            >
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : file ? (
                <FileSpreadsheet className="size-5" />
              ) : (
                <Upload className="size-5" />
              )}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {loading
                  ? MAPPING_PAGE_COPY.submitting
                  : dragging
                    ? MAPPING_PAGE_COPY.dropActive
                    : file
                      ? `${MAPPING_PAGE_COPY.selectedPrefix} ${file.name}`
                      : MAPPING_PAGE_COPY.dropIdle}
              </p>
              <p className="text-xs text-muted-foreground">{MAPPING_PAGE_COPY.dropHint}</p>
              <p className="text-xs text-muted-foreground">{MAPPING_PAGE_COPY.templateDesc}</p>
            </div>
            {file && !loading ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-3 top-3 h-8 gap-1 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setFileKey((k) => k + 1);
                }}
              >
                <X className="size-3.5" />
                {MAPPING_PAGE_COPY.clearFile}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={loading || !file} className="min-w-40">
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {MAPPING_PAGE_COPY.submitting}
                </>
              ) : (
                MAPPING_PAGE_COPY.submit
              )}
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className={`min-w-40 gap-2${loading ? ' pointer-events-none opacity-50' : ''}`}
            >
              <a
                href={MAPPING_PAGE_COPY.templateHref}
                download={MAPPING_PAGE_COPY.templateFileName}
                tabIndex={loading ? -1 : undefined}
                aria-disabled={loading}
                onClick={(e) => {
                  if (loading) e.preventDefault();
                }}
              >
                <Download className="size-4" />
                {MAPPING_PAGE_COPY.templateTitle}
              </a>
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
