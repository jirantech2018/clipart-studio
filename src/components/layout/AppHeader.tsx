'use client';

import { User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { OrgNav } from '@/components/layout/OrgNav';
import { cn } from '@/lib/utils';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

// v0.2.9 M4-1: 상단 nav 구조 개편.
//   - CreditBadge / "우리학교" 링크 제거. 크레딧은 각 workspace 화면에서 표시.
//   - 로고 옆에 OrgNav 로 "내 작업실" + 사용자가 속한 조직 목록을 노출.
//     내 작업실은 첫번째 고정, 나머지는 드래그로 순서 조정 (localStorage).
//     헤더 폭에 다 안 담기면 넘친 만큼 우측 "더보기" 드롭다운.
//   - 관리자 진입은 계정 드롭다운의 "관리자" 항목 (isAdmin 인 사용자만).

export function AppHeader({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createSupabaseBrowserClient();

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('로그아웃 실패');
      return;
    }
    router.push('/login');
    router.refresh();
  }

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
        setPastHero(!entry.isIntersecting);
      },
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isHome, pathname]);

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
          ? 'bg-white/25 dark:bg-white/10'
          : 'bg-white/60 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_4px_16px_rgba(15,23,42,0.05)]',
      )}
    >
      {/* 좌: 로고 + OrgNav / 우: 계정 메뉴. 로고와 조직 nav 는 자연스럽게
          붙어 있어야 하므로 flex-1 로 좌측 영역이 확장되고 나머지 조직 nav 는
          그 안에서 오버플로우 처리. */}
      <div
        className={cn(
          'flex h-14 items-center gap-3 px-6',
          overBanner && 'text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]',
        )}
      >
        <Link
          href="/"
          className={cn(
            'inline-flex shrink-0 items-center gap-2 font-semibold',
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

        {/* 조직 nav — 로고 옆에 붙여서 시작. 오버플로우는 우측 "더보기". */}
        <div className="ml-2 hidden min-w-0 flex-1 md:flex">
          <OrgNav overBanner={overBanner} />
        </div>

        <div className="flex items-center gap-2">
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
                {isAdmin && (
                  <>
                    <div className="border-t" />
                    <Link
                      href="/admin"
                      role="menuitem"
                      onClick={() => setAccountMenuOpen(false)}
                      className="block px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
                    >
                      관리자
                    </Link>
                  </>
                )}
                <div className="border-t" />
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
