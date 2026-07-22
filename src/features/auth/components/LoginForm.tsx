'use client';

// Design Ref: §5.3 LoginForm component
// Plan SC: FR-01 Email/OAuth login

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

interface LoginFormProps {
  // 서버 컴포넌트에서 확실히 넘겨받는 next 경로. 클라이언트 useSearchParams 는
  // 초기 렌더링·CSR 전환 등에서 값이 유실될 수 있어 서버 prop 을 우선한다.
  initialNext?: string | null;
}

export function LoginForm({ initialNext }: LoginFormProps = {}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const supabase = createSupabaseBrowserClient();
  const searchParams = useSearchParams();
  // 우선순위: 서버 prop → 클라이언트 URL query. 서버가 확실히 넘긴 값이면
  // 그걸 신뢰하고, 아니면 CSR 로 진입한 경우를 대비해 useSearchParams 로 보조.
  const rawNext = initialNext ?? searchParams?.get('next') ?? null;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;
  const callbackUrl = next
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?next=${encodeURIComponent(next)}`
    : `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });
    setLoading(false);
    if (error) {
      toast.error(`전송 실패: ${error.message}`);
      return;
    }
    setSent(true);
    toast.success('이메일로 로그인 링크를 전송했습니다');
  }

  async function handleGoogle() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    });
    if (error) {
      setLoading(false);
      toast.error(`Google 로그인 실패: ${error.message}`);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle>ClipArt Studio</CardTitle>
        <CardDescription>계정에 클립아트가 쌓이는 서비스</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={loading}
        >
          Google로 계속
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">또는</span>
          </div>
        </div>

        {sent ? (
          <p className="text-center text-sm text-muted-foreground">
            {email} 로 로그인 링크를 보냈습니다.
            <br />
            이메일을 확인해주세요.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? '전송 중…' : '이메일로 로그인 링크 받기'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
