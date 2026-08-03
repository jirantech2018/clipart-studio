'use client';

import { User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CreditBadge } from '@/features/auth/components/CreditBadge';
import { useAuthStore } from '@/lib/store/authStore';
import { cn } from '@/lib/utils';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

// 상단 메뉴. 홈("/") = 공유라이브러리라서 로고 클릭이 진입점이고 nav 에는
// 굳이 두지 않음. 관리 는 isAdmin 일 때만 렌더.
const NAV_ITEMS = [
  { href: '/generate', label: '+클립아트 만들기' },
  { href: '/library', label: 'MY' },
  { href: '/organizations', label: '우리학교' },
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

  // 우측 사람 아이콘 = 계정 메뉴 트리거. 외부 클릭 / Escape / 라우트 변경 시
  // 자동으로 닫는다.
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAccountMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!accountMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountMenuOpen]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 backdrop-blur-xl',
        overBanner
          // 홈 히어로 위에 얹힌 특수 상태 — 반투명 흰 유지 (기존 톤). border 는
          // 없애고 배경만 살짝 진하게 해서 아이덴티티 유지.
          ? 'bg-white/25 dark:bg-white/10'
          // 일반 페이지 — 배경 gradient 위에 얹히므로 반투명 흰 유리 톤 +
          // 하단 subtle shadow 로만 경계 표시 (외곽선 없음, glass 계열 통일).
          : 'bg-white/60 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_4px_16px_rgba(15,23,42,0.05)]',
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
          <div className="relative" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => setAccountMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="계정 메뉴"
              title="계정 메뉴"
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-full',
                overBanner
                  ? 'text-white hover:bg-white/20'
                  : 'hover:bg-accent',
              )}
            >
              <User className="h-4 w-4" aria-hidden="true" />
            </button>
            {accountMenuOpen && (
              // 드롭다운 자체는 overBanner 여부와 무관하게 흰 배경/어두운 글자로.
              // (헤더 컨테이너의 text-white 를 상속하지 않도록 text-foreground 강제)
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-md border bg-background text-foreground shadow-md [text-shadow:none]"
              >
                <Link
                  href="/profile"
                  role="menuitem"
                  onClick={() => setAccountMenuOpen(false)}
                  className="block px-3 py-2 text-sm hover:bg-accent"
                >
                  개인 설정
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    handleLogout();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
