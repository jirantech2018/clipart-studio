'use client';

import { User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CreditBadge } from '@/features/auth/components/CreditBadge';
import { useAuthStore } from '@/lib/store/authStore';
import { cn } from '@/lib/utils';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

// 상단 메뉴. 홈은 로고 클릭으로 이동하므로 nav 에 포함하지 않는다.
// 관리 는 isAdmin 일 때만 렌더 (계산은 서버 layout 에서 isAdmin(user.email)).
const NAV_ITEMS = [
  { href: '/generate', label: '만들기' },
  { href: '/library', label: 'MY' },
  { href: '/organizations', label: '우리학교' },
  { href: '/community', label: '공유라이브러리' },
] as const;

const ADMIN_ITEM = { href: '/admin', label: '관리' } as const;

export function AppHeader({
  credits,
  creditsResetAt,
  isAdmin,
}: {
  credits: number;
  creditsResetAt: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createSupabaseBrowserClient();
  // Live credits from Zustand — updated by useCreateJob / useJobStream after batch generation.
  // Falls back to server-rendered `credits` until the first client mutation lands.
  const storeCredits = useAuthStore((s) => s.profile?.credits);
  const displayCredits = storeCredits ?? credits;

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('로그아웃 실패');
      return;
    }
    router.push('/login');
    router.refresh();
  }

  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  // 홈 ("/") 에서만 반투명 흰 헤더로 히어로 배경 이미지가 헤더 뒤로 비쳐
  // 보이게 한다. 그 외 페이지는 기존과 동일한 불투명 배경 유지.
  const isHome = pathname === '/';

  return (
    <header
      className={cn(
        'sticky top-0 z-40 backdrop-blur',
        isHome
          ? 'border-b border-white/20 bg-white/25 dark:bg-white/10'
          : 'border-b bg-background/95',
      )}
    >
      {/* 3분할: 좌(로고) / 중앙(nav) / 우(액션). flex-1 로 세 영역을 균등하게
          잡아, nav 는 justify-center 로 정확히 헤더 중앙에 위치.
          홈에서는 모든 텍스트/아이콘을 흰색으로 (배경 이미지 위에 얹혀 있음),
          그 외 페이지는 기본 색상 유지. */}
      <div
        className={cn(
          'flex h-14 items-center gap-4 px-6',
          isHome && 'text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]',
        )}
      >
        <div className="flex flex-1 items-center">
          <Link href="/" className="shrink-0 font-semibold">
            ClipArt Studio
          </Link>
        </div>
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                  isHome
                    ? cn(
                        'text-white hover:bg-white/20',
                        active && 'bg-white/25',
                      )
                    : cn(
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        item.href === ADMIN_ITEM.href && !active && 'text-primary',
                      ),
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-1 items-center justify-end gap-3">
          <CreditBadge credits={displayCredits} creditsResetAt={creditsResetAt} />
          <Link
            href="/profile"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              isHome
                ? 'text-white hover:bg-white/20'
                : 'hover:bg-accent',
            )}
            aria-label="계정정보"
            title="계정정보"
          >
            <User className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={cn(isHome && 'text-white hover:bg-white/20 hover:text-white')}
          >
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  );
}
