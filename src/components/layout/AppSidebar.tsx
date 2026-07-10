'use client';

import { Home, Image as ImageIcon, School, Shield, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/library', label: '내 라이브러리', icon: ImageIcon },
  { href: '/community', label: '워크스페이스 (공유 라이브러리)', icon: Users },
  { href: '/generate', label: 'AI 이미지 만들기', icon: Sparkles },
];

interface AppSidebarProps {
  hasSchoolProfile: boolean;
  isAdmin: boolean;
}

export function AppSidebar({ hasSchoolProfile, isAdmin }: AppSidebarProps) {
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

        <div className="border-t pt-2" />

        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            pathname === '/settings'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <School className="h-4 w-4" aria-hidden="true" />
          {hasSchoolProfile ? '학교설정' : '학교설정 추가'}
        </Link>

        {isAdmin && (
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
        )}
      </nav>
    </aside>
  );
}
