import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProductMappingItem,
  ProductMappingListResponse,
  ProductMappingSpuGroup,
} from '@voc/shared';
import { MAPPING_PAGE_COPY } from '@voc/shared';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '../api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import { PageHeader, PageTitle } from '@/components/page-header';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { TruncatedText } from '@/components/truncated-text';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { Badge } from '@/components/ui/badge';
import { buildListQuery } from '@/lib/list-query';
import { usePageRefresh } from '@/hooks/use-page-refresh';

const EMPTY = '-';
/** 同 SPU 默认展示的 SKU 行数，超出可展开 */
const COLLAPSED_SKU_LIMIT = 3;

/** 一页内按 SPU 组展开的 SKU 行；首行带 rowspan，其余跳过合并列 */
type ProductListRow = {
  groupKey: string;
  brandKey: string;
  internalSpu: string | null;
  productNameCn: string | null;
  productNameEn: string | null;
  mappingGranularity: string;
  sku: ProductMappingItem;
  /** 当前可见行数（含折叠），用于 rowspan */
  visibleSize: number;
  /** 组内真实 SKU 总数 */
  totalSkuCount: number;
  isGroupStart: boolean;
  /** 当前可见的最后一行（放展开/收起） */
  isVisibleEnd: boolean;
  collapsed: boolean;
};

function pickName(skus: ProductMappingItem[], field: 'productNameCn' | 'productNameEn') {
  for (const s of skus) {
    const t = s[field]?.trim();
    if (t) return t;
  }
  return null;
}

function flattenGroups(
  groups: ProductMappingSpuGroup[],
  expandedKeys: Set<string>,
): ProductListRow[] {
  const rows: ProductListRow[] = [];
  for (const g of groups) {
    const skus = g.skus.length ? g.skus : [];
    if (!skus.length) continue;
    const groupKey = `${g.brandKey}|${g.internalSpu || skus[0]!.internalSku}`;
    const productNameCn = pickName(skus, 'productNameCn');
    const productNameEn = pickName(skus, 'productNameEn');
    const totalSkuCount = skus.length;
    const collapsed = totalSkuCount > COLLAPSED_SKU_LIMIT && !expandedKeys.has(groupKey);
    const visibleSkus = collapsed ? skus.slice(0, COLLAPSED_SKU_LIMIT) : skus;
    const visibleSize = visibleSkus.length;

    visibleSkus.forEach((sku, i) => {
      rows.push({
        groupKey,
        brandKey: g.brandKey,
        internalSpu: g.internalSpu,
        productNameCn,
        productNameEn,
        mappingGranularity: g.mappingGranularity,
        sku,
        visibleSize,
        totalSkuCount,
        isGroupStart: i === 0,
        isVisibleEnd: i === visibleSize - 1,
        collapsed,
      });
    });
  }
  return rows;
}

function groupRowSpan(row: ProductListRow) {
  return row.isGroupStart ? row.visibleSize : 0;
}

export function ProductListPage({ isActive: _isActive = true }: { isActive?: boolean }) {
  const { openPath } = useWorkspaceTabs();
  const [groups, setGroups] = useState<ProductMappingSpuGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState({ brand: '', q: '' });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const loadGenRef = useRef(0);

  const loadList = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setListLoading(true);
    try {
      const mapRes = await apiFetch<ProductMappingListResponse>(
        `/api/mappings?${buildListQuery({
          page,
          pageSize,
          brand: filters.brand,
          q: filters.q,
        })}`,
      );
      if (gen !== loadGenRef.current) return;
      setGroups(mapRes.items);
      setTotal(mapRes.total);
      setBrands(mapRes.brands ?? []);
      setExpandedKeys(new Set());
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      toast({
        title: '加载失败',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      if (gen === loadGenRef.current) setListLoading(false);
    }
  }, [page, pageSize, filters.brand, filters.q]);

  useEffect(() => {
    void loadList();
    return () => {
      loadGenRef.current += 1;
    };
  }, [loadList]);

  usePageRefresh('/products/list', () => {
    void loadList();
  });

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const rows = useMemo(() => flattenGroups(groups, expandedKeys), [groups, expandedKeys]);

  const columns = useMemo<DataTableColumn<ProductListRow>[]>(
    () => [
      {
        id: 'brand',
        header: MAPPING_PAGE_COPY.colBrand,
        rowSpan: groupRowSpan,
        cell: (r) => r.brandKey,
      },
      {
        id: 'spu',
        header: MAPPING_PAGE_COPY.colSpu,
        className: 'font-mono text-xs',
        rowSpan: groupRowSpan,
        cell: (r) => r.internalSpu || EMPTY,
      },
      {
        id: 'sku',
        header: MAPPING_PAGE_COPY.colSku,
        className: 'max-w-[16rem]',
        cell: (r) => {
          const showToggle = r.isVisibleEnd && r.totalSkuCount > COLLAPSED_SKU_LIMIT;
          return (
            <div className="space-y-1">
              <TruncatedText text={r.sku.internalSku} className="font-mono text-xs" />
              {showToggle ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
                  onClick={() => toggleGroup(r.groupKey)}
                >
                  {r.collapsed ? (
                    <>
                      <ChevronDown className="size-3.5" />
                      展开全部（{r.totalSkuCount}）
                    </>
                  ) : (
                    <>
                      <ChevronUp className="size-3.5" />
                      收起
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'nameCn',
        header: MAPPING_PAGE_COPY.colNameCn,
        className: 'max-w-[12rem]',
        rowSpan: groupRowSpan,
        cell: (r) => (
          <TruncatedText text={r.productNameCn?.trim() || null} empty={EMPTY} />
        ),
      },
      {
        id: 'nameEn',
        header: MAPPING_PAGE_COPY.colNameEn,
        className: 'max-w-[14rem] text-muted-foreground',
        rowSpan: groupRowSpan,
        cell: (r) => (
          <TruncatedText
            text={r.productNameEn?.trim() || null}
            empty={EMPTY}
            className="text-muted-foreground"
          />
        ),
      },
      {
        id: 'granularity',
        header: MAPPING_PAGE_COPY.colGranularity,
        rowSpan: groupRowSpan,
        cell: (r) => r.mappingGranularity,
      },
    ],
    [toggleGroup],
  );

  const brandOptions = useMemo(
    () => [
      { value: '', label: '全部品牌' },
      ...brands.map((b) => ({ value: b, label: b })),
    ],
    [brands],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <PageTitle>
            {MAPPING_PAGE_COPY.listPageTitle}
            {!listLoading ? (
              <Badge variant="secondary" className="ml-2 align-middle text-sm font-normal">
                {total}
              </Badge>
            ) : null}
          </PageTitle>
        }
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => openPath('/products/import')}>
            {MAPPING_PAGE_COPY.title}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.groupKey}|${r.sku.internalSku}|${r.sku.mappingPublicationId}`}
        loading={listLoading}
        emptyText={MAPPING_PAGE_COPY.listEmpty}
        pagination
        clientPagination={false}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        filters={[
          {
            id: 'brand',
            label: MAPPING_PAGE_COPY.colBrand,
            type: 'select',
            options: brandOptions,
          },
          {
            id: 'q',
            label: 'SPU / SKU / 产品名',
            placeholder: 'SPU / SKU / 产品名',
          },
        ]}
        filterValues={filters}
        onFilterChange={(next) => {
          setFilters({ brand: next.brand ?? '', q: next.q ?? '' });
          setPage(1);
        }}
      />
    </div>
  );
}
