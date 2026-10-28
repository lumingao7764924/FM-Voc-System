import { FormEvent, useCallback, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import type { CreateImportResponse, ImportBatchSummary } from '@voc/shared';
import { IMPORT_PAGE_COPY } from '@voc/shared';
import { apiFetch, getCookie } from '../api';
import { notifyImportAccepted } from '@/lib/import-events';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { Steps } from '@/components/ui/steps';
import { PageTitle } from '@/components/page-header';
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

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback((next: File | null) => {
    if (!next) {
      setFile(null);
      return;
    }
    if (!isXlsx(next)) {
      toast({ title: IMPORT_PAGE_COPY.needFile, variant: 'destructive' });
      return;
    }
    setFile(next);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!file) {
      toast({ title: IMPORT_PAGE_COPY.needFile, variant: 'destructive' });
      return;
    }
    const uploadingName = file.name;
    setLoading(true);
    try {
      const created = await apiFetch<CreateImportResponse>('/api/imports', {
        method: 'POST',
        json: {
          requestIdempotencyKey: crypto.randomUUID(),
          sourceFileName: uploadingName,
        },
      });

      const fd = new FormData();
      fd.append('file', file);
      const csrf = getCookie('voc_csrf');
      const uploadRes = await fetch(`/api/imports/${created.importBatchId}/file`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: csrf ? { 'x-csrf-token': csrf } : undefined,
      });
      const text = await uploadRes.text();
      let data: unknown = text ? JSON.parse(text) : null;
      if (!uploadRes.ok) {
        const msg =
          data && typeof data === 'object' && 'message' in data
            ? String((data as { message: string }).message)
            : uploadRes.statusText;
        throw new Error(msg);
      }
      void (data as ImportBatchSummary);

      setFile(null);
      setFileKey((k) => k + 1);
      notifyImportAccepted({
        importBatchId: created.importBatchId,
        sourceFileName: uploadingName,
      });
    } catch (err) {
      toast({
        title: IMPORT_PAGE_COPY.uploadFailed,
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -top-6 h-48 bg-[radial-gradient(ellipse_at_top,oklch(0.5_0_0/0.08),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(1_0_0/0.06),transparent_65%)]"
      />

      <div className="relative space-y-8">
        <header className="space-y-5">
          <PageTitle>{IMPORT_PAGE_COPY.title}</PageTitle>
          <Steps
            steps={[
              { title: IMPORT_PAGE_COPY.step1 },
              { title: IMPORT_PAGE_COPY.step2 },
              { title: IMPORT_PAGE_COPY.step3 },
            ]}
          />
        </header>

        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <fieldset disabled={loading} className="space-y-4 disabled:opacity-70">
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
                'group relative flex min-h-[12rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition',
                'border-border/80 bg-muted/20 hover:border-foreground/25 hover:bg-muted/35',
                dragging && 'border-foreground/40 bg-muted/50',
                loading && 'pointer-events-none cursor-wait',
              )}
            >
              <input
                key={fileKey}
                ref={inputRef}
                id="file"
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
                    ? IMPORT_PAGE_COPY.submitting
                    : dragging
                      ? IMPORT_PAGE_COPY.dropActive
                      : file
                        ? `${IMPORT_PAGE_COPY.selectedPrefix} ${file.name}`
                        : IMPORT_PAGE_COPY.dropIdle}
                </p>
                <p className="text-xs text-muted-foreground">{IMPORT_PAGE_COPY.dropHint}</p>
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
                  {IMPORT_PAGE_COPY.clearFile}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={loading || !file} className="min-w-40">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {IMPORT_PAGE_COPY.submitting}
                  </>
                ) : (
                  IMPORT_PAGE_COPY.submit
                )}
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className={`min-w-40 gap-2${loading ? ' pointer-events-none opacity-50' : ''}`}
              >
                <a
                  href={IMPORT_PAGE_COPY.templateHref}
                  download={IMPORT_PAGE_COPY.templateFileName}
                  tabIndex={loading ? -1 : undefined}
                  aria-disabled={loading}
                  onClick={(e) => {
                    if (loading) e.preventDefault();
                  }}
                >
                  <Download className="size-4" />
                  {IMPORT_PAGE_COPY.templateTitle}
                </a>
              </Button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
