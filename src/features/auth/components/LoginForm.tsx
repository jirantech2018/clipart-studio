'use client';

// Design Ref: §5.3 LoginForm component
// Plan SC: FR-01 Email/OAuth login
//
// 로그인 방식:
//   1) Google OAuth (기존 그대로)
//   2) 이메일 인증번호 (OTP) — Magic Link 대체
//      Step 1: 이메일 입력 → 6자리 OTP 이메일 발송
//      Step 2: OTP 6자리 입력 → verifyOtp → 세션 생성 → next 로 이동
//
// 상태 유지:
//   Supabase 가 발송한 OTP 는 10분 유효. 다른 탭에서 이메일을 확인하고 돌아
//   오는 흐름을 고려해 (email, sentAt) 을 sessionStorage 에 저장. 마운트 시
//   sentAt 이 10분 이내면 자동으로 code 단계로 복원. OTP 자체는 저장 안 함.
//
// Enumeration 방지:
//   존재하지 않는 이메일에도 동일한 성공 안내 문구 노출. Supabase 의 signInWithOtp
//   는 이미 이런 특성을 갖지만, 에러 메시지 노출 방식을 통일해 확실히 한다.
//
// 관리자·조직 권한: 로그인 방식 변경만이며 권한 판정 로직은 무변화.

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

interface LoginFormProps {
  // 서버 컴포넌트에서 넘겨받는 next 경로 우선. CSR 진입 대비 useSearchParams 도 fallback.
  initialNext?: string | null;
}

type Phase = 'idle' | 'code';

const RESEND_COOLDOWN_SECONDS = 60;
const OTP_VALID_WINDOW_MS = 10 * 60 * 1000; // 10분
const STORAGE_KEY = 'clipart-login-otp';

interface StoredOtpState {
  email: string;
  sentAt: number; // epoch ms
}

function loadStoredState(): StoredOtpState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOtpState> | null;
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      typeof parsed.sentAt === 'number' &&
      Date.now() - parsed.sentAt < OTP_VALID_WINDOW_MS
    ) {
      return { email: parsed.email, sentAt: parsed.sentAt };
    }
  } catch {
    // ignore
  }
  return null;
}

function saveStoredState(state: StoredOtpState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function clearStoredState() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Supabase auth 오류 원문을 사용자 문구로 매핑. 기술 오류나 stack trace 는
 * 노출하지 않는다.
 */
function mapVerifyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) {
    return '인증번호가 만료되었습니다. 새 인증번호를 받아주세요.';
  }
  if (m.includes('rate') || m.includes('too many')) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  }
  if (m.includes('exceeded') || m.includes('attempt')) {
    return '인증 시도 횟수를 초과했습니다. 새 인증번호를 받아주세요.';
  }
  if (m.includes('invalid') || m.includes('token')) {
    return '인증번호가 올바르지 않습니다. 다시 확인해주세요.';
  }
  return '로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
}

function mapSendError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate') || m.includes('too many')) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  }
  return '인증번호를 보내지 못했습니다. 잠시 후 다시 시도해주세요.';
}

export function LoginForm({ initialNext }: LoginFormProps = {}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const searchParams = useSearchParams();
  const rawNext = initialNext ?? searchParams?.get('next') ?? null;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;
  const callbackUrl = next
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?next=${encodeURIComponent(next)}`
    : `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;

  // Mount 시 sessionStorage 복원 — 이메일 확인 후 돌아온 경우 phase 유지.
  useEffect(() => {
    const stored = loadStoredState();
    if (stored) {
      setEmail(stored.email);
      setSentAt(stored.sentAt);
      setPhase('code');
    }
  }, []);

  // Resend countdown tick.
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== 'code' || sentAt === null) {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
      return;
    }
    setNow(Date.now());
    tickerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = null;
    };
  }, [phase, sentAt]);

  const secondsLeft = useMemo(() => {
    if (sentAt === null) return 0;
    const elapsed = Math.floor((now - sentAt) / 1000);
    return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
  }, [sentAt, now]);

  const canResend = phase === 'code' && secondsLeft === 0 && !resending && !sending;

  const sendOtp = useCallback(
    async (targetEmail: string): Promise<boolean> => {
      const { error } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: { shouldCreateUser: true },
      });
      if (error) {
        toast.error(mapSendError(error.message));
        return false;
      }
      const at = Date.now();
      setSentAt(at);
      saveStoredState({ email: targetEmail, sentAt: at });
      return true;
    },
    [supabase],
  );

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    const ok = await sendOtp(email.trim());
    setSending(false);
    if (!ok) return;
    setPhase('code');
    setCode('');
    // Enumeration 방지: 신규·기존 무관 동일 문구.
    toast.success('입력한 이메일로 인증번호를 보냈습니다.');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s+/g, '');
    if (trimmed.length !== 6) return;
    setVerifying(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: trimmed,
      type: 'email',
    });
    setVerifying(false);
    if (error) {
      toast.error(mapVerifyError(error.message));
      return;
    }
    if (!data.session) {
      toast.error('로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    clearStoredState();
    toast.success('로그인 완료');
    // 서버 세션 쿠키 반영을 위해 hard navigation.
    window.location.href = next ?? '/';
  }

  async function handleResend() {
    if (!canResend || !email) return;
    setResending(true);
    const ok = await sendOtp(email);
    setResending(false);
    if (ok) {
      setCode('');
      toast.success('새 인증번호를 보냈습니다.');
    }
  }

  function handleChangeEmail() {
    // 이메일 변경 — sentAt 초기화, code 지우기, phase 되돌리기. email 값은
    // 사용자 편의로 유지 (원하면 그대로 다시 요청 가능). storage 도 해제.
    setPhase('idle');
    setCode('');
    setSentAt(null);
    clearStoredState();
  }

  async function handleGoogle() {
    setSending(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    });
    if (error) {
      setSending(false);
      toast.error(`Google 로그인 실패: ${error.message}`);
    }
  }

  const loadingIdle = sending;
  const loadingCode = verifying;

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
          disabled={loadingIdle || loadingCode}
        >
          Google로 계속하기
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">또는</span>
          </div>
        </div>

        {phase === 'idle' && (
          <form onSubmit={handleSendCode} className="space-y-3" noValidate>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">이메일로 로그인</h2>
              <p className="text-xs text-muted-foreground">
                비밀번호 없이 이메일 인증으로 로그인합니다.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                inputMode="email"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loadingIdle || !email}>
              {loadingIdle ? '인증번호 보내는 중…' : '인증번호 받기'}
            </Button>
          </form>
        )}

        {phase === 'code' && (
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">인증번호를 입력해주세요</h2>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span> 으로
                <br />
                6자리 인증번호를 보냈습니다.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="otp">인증번호</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="123456"
                className="tracking-[0.4em] text-center text-lg"
                autoFocus
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loadingCode || code.length !== 6}
            >
              {loadingCode ? '확인 중…' : '로그인'}
            </Button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleChangeEmail}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                이메일 주소 변경
              </button>
              {canResend ? (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  {resending ? '보내는 중…' : '인증번호 다시 보내기'}
                </button>
              ) : (
                <span className="text-muted-foreground">
                  {secondsLeft}초 후 다시 보낼 수 있어요
                </span>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
