import { useParams } from 'react-router-dom';
import { AnalysisReportPage } from '@/pages/AnalysisReportPage';
import { ThemeToggle } from '@/components/theme-toggle';

/** 免登录公开分享页：/s/:token */
export function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        无效的分享链接
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-5 sm:px-6">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <AnalysisReportPage shareToken={token} publicView />
      </div>
    </div>
  );
}
