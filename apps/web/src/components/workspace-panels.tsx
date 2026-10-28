import { ImportPage } from '@/pages/ImportPage';
import { ProductImportPage } from '@/pages/ProductImportPage';
import { ProductListPage } from '@/pages/ProductListPage';
import { ReviewListPage } from '@/pages/ReviewListPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { BatchPage } from '@/pages/BatchPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { AnalysisHistoryPage } from '@/pages/AnalysisHistoryPage';
import { AnalysisReportPage } from '@/pages/AnalysisReportPage';
import { TaxonomyPage } from '@/pages/TaxonomyPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { PermissionsPage } from '@/pages/PermissionsPage';
import { RequirePageAccess } from '@/components/require-page-access';
import { useWorkspaceTabs } from '@/components/workspace-tabs';
import { cn } from '@/lib/utils';

/** Keep-alive：已打开页签保持挂载，切换只隐藏不卸载 */
export function WorkspacePanels() {
  const { tabs, activeKey } = useWorkspaceTabs();

  return (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            className={cn(
              'absolute inset-0 overflow-y-auto',
              active ? 'z-10' : 'pointer-events-none z-0 invisible',
            )}
            aria-hidden={!active}
          >
            <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 md:py-8">
              <RequirePageAccess path={tab.path} active={active}>
                {tab.kind === 'import' ? <ImportPage /> : null}
                {tab.kind === 'product-import' ? <ProductImportPage /> : null}
                {tab.kind === 'product-list' ? <ProductListPage isActive={active} /> : null}
                {tab.kind === 'review-list' ? <ReviewListPage isActive={active} /> : null}
                {tab.kind === 'history' ? <HistoryPage isActive={active} /> : null}
                {tab.kind === 'analytics' ? <AnalyticsPage isActive={active} /> : null}
                {tab.kind === 'analysis-history' ? (
                  <AnalysisHistoryPage isActive={active} />
                ) : null}
                {tab.kind === 'analysis-report' ? (
                  <AnalysisReportPage batchId={tab.batchId} isActive={active} />
                ) : null}
                {tab.kind === 'taxonomy' ? <TaxonomyPage isActive={active} /> : null}
                {tab.kind === 'settings-accounts' ? <AccountsPage /> : null}
                {tab.kind === 'settings-permissions' ? <PermissionsPage /> : null}
                {tab.kind === 'batch' ? (
                  <BatchPage batchId={tab.batchId} isActive={active} />
                ) : null}
              </RequirePageAccess>
            </div>
          </div>
        );
      })}
    </div>
  );
}
