import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { canAccessPage, firstAllowedPath, pathToPageKey, type LoginResponse } from '@voc/shared';
import { Loader2 } from 'lucide-react';
import { apiFetch, setSessionKey } from '../api';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';

function resolvePostLoginPath(raw: string | null, access: LoginResponse['access']): string {
  const home = firstAllowedPath(access);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) {
    return home;
  }
  const page = pathToPageKey(raw);
  if (page && !canAccessPage(access, page)) return home;
  return raw;
}

export function LoginPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        json: { username, password },
        encrypt: false,
      });
      setSessionKey(res.sessionKey);
      await refresh();
      nav(resolvePostLoginPath(searchParams.get('next'), res.access));
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '登录失败',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm border shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-semibold tracking-tight">登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <fieldset disabled={loading} className="space-y-4 disabled:opacity-70">
              <div>
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  required
                />
              </div>
            </fieldset>
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  登录中…
                </>
              ) : (
                '进入系统'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
