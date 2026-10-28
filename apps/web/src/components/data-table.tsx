import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ListFiltersPanel,
  type ListFilterField,
} from '@/components/list-filters';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

function TableLoadingOverlay() {
  return (
    <div
      className="absolute inset-0 z-[2] flex items-center justify-center bg-background/40 backdrop-blur-[1px]"
      aria-busy
      aria-label="加载中"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** 虚拟列表时的列宽，如 4.5rem / minmax(0,1fr) */
  width?: string;
  /**
   * 表格行合并：返回 rowspan。
   * - `>1`：本行渲染并跨行
   * - `0`：本行不渲染该格（已被上行合并）
   * - 默认 `1`
   */
  rowSpan?: (row: T, rowIndex: number, rows: T[]) => number;
};

/** @deprecated 使用 ListFilterField；保留别名兼容旧引用 */
export type DataTableFilterField = ListFilterField;

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  emptyText?: string;
  title?: ReactNode;
  titleCount?: number;
  actions?: ReactNode;
  toolbar?: ReactNode;
  filters?: ListFilterField[];
  filterValues?: Record<string, string>;
  onFilterChange?: (values: Record<string, string>) => void;
  /** 筛选按钮旁的额外操作（如「同步映射」） */
  filterActions?: ReactNode;
  pagination?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  clientPagination?: boolean;
  className?: string;
  maxHeightClassName?: string | false;
  /**
   * 虚拟滚动（适合大批量一次性列表，如隔离明细）。
   * 开启后使用网格行渲染 + @tanstack/react-virtual。
   */
  virtual?: boolean;
  /** 虚拟列表视口高度 px，默认 360 */
  virtualHeight?: number;
  /** 预估行高，默认 72 */
  estimateRowHeight?: number;
};

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZES = [20, 50, 100];
const EMPTY_FILTERS: Record<string, string> = {};

function VirtualRows<T>({
  columns,
  rows,
  getRowKey,
  height,
  estimateSize,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  height: number;
  estimateSize: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    // 按实际内容测高，避免固定行高把多行文字挤叠
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
  });

  const gridTemplate = columns.map((c) => c.width ?? 'minmax(5em, 1fr)').join(' ');

  return (
    <div className="overflow-hidden rounded-lg border">
      <div ref={parentRef} className="overflow-auto" style={{ height }}>
        <div className="min-w-[42rem]">
          <div
            className="sticky top-0 z-[1] grid gap-x-4 border-b bg-muted/95 px-3 py-2.5 text-xs font-medium text-muted-foreground backdrop-blur"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {columns.map((col) => (
              <div
                key={col.id}
                className={cn('min-w-[5em] whitespace-nowrap', col.headerClassName)}
              >
                {col.header}
              </div>
            ))}
          </div>
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={getRowKey(row)}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 grid w-full gap-x-4 border-b px-3 py-2.5 text-sm"
                  style={{
                    transform: `translateY(${item.start}px)`,
                    gridTemplateColumns: gridTemplate,
                  }}
                >
                  {columns.map((col) => (
                    <div key={col.id} className={cn('min-w-0', col.className)}>
                      {col.cell(row)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading,
  emptyText = '暂无数据',
  title,
  titleCount,
  actions,
  toolbar,
  filters,
  filterValues,
  onFilterChange,
  filterActions,
  pagination = true,
  page: pageProp,
  pageSize: pageSizeProp,
  total: totalProp,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  clientPagination = true,
  className,
  maxHeightClassName = 'max-h-[28rem]',
  virtual = false,
  virtualHeight = 360,
  estimateRowHeight = 72,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();
  const resolvedFilterValues = filterValues ?? EMPTY_FILTERS;
  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(pageSizeProp ?? DEFAULT_PAGE_SIZE);

  const page = pageProp ?? internalPage;
  const pageSize = pageSizeProp ?? internalPageSize;

  function setPage(next: number) {
    if (pageProp == null) setInternalPage(next);
    onPageChange?.(next);
  }

  function setPageSize(next: number) {
    if (pageSizeProp == null) setInternalPageSize(next);
    onPageSizeChange?.(next);
    setPage(1);
  }

  const total = totalProp ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pageCount);

  const displayRows = useMemo(() => {
    if (!pagination || !clientPagination) return rows;
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, pagination, clientPagination, safePage, pageSize]);

  const showCount = titleCount ?? (title != null ? total : undefined);

  return (
    <div className={cn('space-y-3', className)}>
      {title != null || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {typeof title === 'string' ? (
              <h2 className="text-base font-semibold">{title}</h2>
            ) : (
              title
            )}
            {showCount != null ? (
              <Badge variant="secondary" className="font-normal">
                {showCount}
              </Badge>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {toolbar
        ? toolbar
        : filters && filters.length > 0 && onFilterChange
          ? (
              <div className="flex flex-wrap items-center gap-2">
                <ListFiltersPanel
                  filters={filters}
                  values={resolvedFilterValues}
                  onChange={(next) => {
                    setPage(1);
                    onFilterChange(next);
                  }}
                />
                {filterActions}
              </div>
            )
          : filterActions
            ? <div className="flex flex-wrap items-center gap-2">{filterActions}</div>
            : null}

      {loading && displayRows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : displayRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : virtual ? (
        <div className="relative">
          <div className={cn(loading && 'pointer-events-none opacity-60')}>
            <VirtualRows
              columns={columns}
              rows={displayRows}
              getRowKey={getRowKey}
              height={virtualHeight}
              estimateSize={estimateRowHeight}
            />
          </div>
          {loading ? <TableLoadingOverlay /> : null}
        </div>
      ) : (
        <div className="relative">
          <div
            className={cn(
              'overflow-auto rounded-lg border',
              maxHeightClassName !== false && maxHeightClassName,
              loading && 'pointer-events-none opacity-60',
            )}
          >
            <Table className="min-w-[42rem]">
              <TableHeader className="sticky top-0 z-[1] bg-muted/95 backdrop-blur">
                <TableRow className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableHead
                      key={col.id}
                      className={cn('min-w-[5em] whitespace-nowrap', col.headerClassName)}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((row, rowIndex) => (
                  <TableRow key={getRowKey(row)}>
                    {columns.map((col) => {
                      const span = col.rowSpan?.(row, rowIndex, displayRows) ?? 1;
                      if (span === 0) return null;
                      return (
                        <TableCell
                          key={col.id}
                          rowSpan={span > 1 ? span : undefined}
                          className={cn(span > 1 && 'align-top', col.className)}
                        >
                          {col.cell(row)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {loading ? <TableLoadingOverlay /> : null}
        </div>
      )}

      {pagination && total > 0 ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground',
            loading && 'pointer-events-none opacity-60',
          )}
        >
          {isMobile ? (
            <span>共 {total} 条</span>
          ) : (
            <div className="flex items-center gap-2">
              <span>每页</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger size="sm" className="w-[4.5rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>
                共 {total} 条 · 第 {safePage}/{pageCount} 页
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft className="size-4" />
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              下一页
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
