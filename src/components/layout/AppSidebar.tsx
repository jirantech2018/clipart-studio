'use client';

// 학교설정 항목은 P5-D-A 이후 각 조직의 설정 페이지로 이동. 개인 프로필
// (개인 컨텍스트) 의 school_profiles 는 병존하지만 사이드바 진입점은 없앤다.
// 기존 사용자는 /settings URL 로 직접 접근 가능 (계정 메뉴 통합은 후속 세션).

import {
  Building2,
  Home,
  Image as ImageIcon,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/library', label: '내 라이브러리', icon: ImageIcon },
  { href: '/organizations', label: '내 조직', icon: Building2 },
  { href: '/community', label: '워크스페이스 (공유 라이브러리)', icon: Users },
  { href: '/generate', label: 'AI 이미지 만들기', icon: Sparkles },
];

interface AppSidebarProps {
  isAdmin: boolean;
}

export function AppSidebar({ isAdmin }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/30 p-3 md:block">
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="border-t pt-2" />
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === '/admin'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-primary hover:bg-accent',
              )}
            >
              <Shield className="h-4 w-4" aria-hidden="true" />
              관리자 · 학습 공간
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}
