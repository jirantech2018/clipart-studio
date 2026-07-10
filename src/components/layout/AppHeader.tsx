'use client';

import { User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CreditBadge } from '@/features/auth/components/CreditBadge';
import { useAuthStore } from '@/lib/store/authStore';
import { createSupabaseBrowserClient } from '@/services/supabase/client';

export function AppHeader({
  credits,
  creditsResetAt,
}: {
  credits: number;
  creditsResetAt: string | null;
}) {
  const router = useRouter();
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

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-4 px-6">
        <Link href="/" className="shrink-0 font-semibold">
          ClipArt Studio
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <CreditBadge credits={displayCredits} creditsResetAt={creditsResetAt} />
          <Link
            href="/profile"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent"
            aria-label="계정정보"
            title="계정정보"
          >
            <User className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  );
}
