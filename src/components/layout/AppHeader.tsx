'use client';

import { User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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

  // 히어로 배너 아래에 심어둔 sentinel 이 뷰포트 위로 스크롤되면
  // "히어로를 지나갔다" 로 판정하고 헤더를 다른 페이지와 같은 흰색 불투명
  // 모드로 전환한다. 홈 이외 페이지에서는 sentinel 을 관측하지 않는다.
  const [pastHero, setPastHero] = useState(false);
  useEffect(() => {
    if (!isHome) {
      setPastHero(false);
      return;
    }
    setPastHero(false);
    const sentinel = document.getElementById('home-hero-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // rootMargin -56px = 헤더 높이(h-14). sentinel 이 헤더 아래 영역에서
        // 사라지는 순간 = 히어로가 헤더 뒤로 완전히 밀려간 순간.
        setPastHero(!entry.isIntersecting);
      },
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isHome, pathname]);

  // 흰색(투명) 모드 = 홈이면서 아직 히어로를 안 벗어남. 이 값이 true 일 때만
  // 로고 이미지·nav 텍스트·CreditBadge 예외 스타일이 적용된다.
  const overBanner = isHome && !pastHero;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 backdrop-blur',
        overBanner
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
          overBanner && 'text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]',
        )}
      >
        <div className="flex flex-1 items-center">
          <Link
            href="/"
            className={cn(
              'inline-flex shrink-0 items-center gap-2 font-semibold',
              // overBanner 이면 헤더 컨테이너의 text-white 를 그대로 상속.
              // 그 외 페이지에서는 검정 대신 브랜드 톤 (#373d8e) 로.
              !overBanner && 'text-[#373d8e]',
            )}
          >
            <Image
              src={overBanner ? '/logo_white.png' : '/logo_blue.png'}
              alt=""
              width={28}
              height={28}
              priority
              className="h-7 w-7 object-contain"
            />
            <span>우리학교 클립아트스튜디오</span>
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
                  overBanner
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
          {/* 홈에서는 헤더 컨테이너가 text-white 라서 CreditBadge 의 secondary
              배경 위에 흰 글자가 얹혀 안 보인다. 이 pill 만 어두운 글자로
              되돌리고 shadow 는 제거 (자체 배경으로 이미 대비 확보). */}
          <div className={cn(overBanner && 'text-foreground [text-shadow:none]')}>
            <CreditBadge credits={displayCredits} creditsResetAt={creditsResetAt} />
          </div>
          <Link
            href="/profile"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              overBanner
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
            className={cn(overBanner && 'text-white hover:bg-white/20 hover:text-white')}
          >
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  );
}
