// Admin 허브 페이지. 관리자 이메일 (ADMIN_EMAIL) 만 접근 가능.
// 두 개의 도구를 카드로 노출:
//   1. Token Dashboard (/admin/token-dashboard)
//   2. Image Knowledge CMS (/admin/knowledge)

import { BookOpen, ClipboardList, Coins, Images } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">관리자</h1>
        <p className="text-sm text-muted-foreground">
          운영 도구를 이 페이지에서 열 수 있어요. 접근 권한은 관리자 이메일로만 제한됩니다.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminBanner
          href="/admin/organization-requests"
          title="조직 개설 신청"
          description="사용자가 신청한 조직 개설 요청을 검토하고 승인 · 거절합니다. 승인 시 실제 워크스페이스와 owner 멤버십이 자동 생성돼요."
          icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
          accent="from-emerald-100 to-emerald-50 border-emerald-200 text-emerald-700"
        />
        <AdminBanner
          href="/admin/token-dashboard"
          title="Token Dashboard"
          description="Workspace 별 크레딧 잔액과 사용량을 확인하고, 조직에 크레딧을 지급하거나 조정합니다. Ledger 이력을 함께 볼 수 있어요."
          icon={<Coins className="h-6 w-6" aria-hidden="true" />}
          accent="from-amber-100 to-amber-50 border-amber-200 text-amber-700"
        />
        <AdminBanner
          href="/admin/image-review"
          title="이미지 리뷰"
          description="모든 Workspace 에서 생성된 이미지를 한곳에서 확인하고, 품질이 낮은 이미지를 휴지통으로 이동합니다. 실제 삭제는 하지 않아 언제든 복원할 수 있어요."
          icon={<Images className="h-6 w-6" aria-hidden="true" />}
          accent="from-rose-100 to-rose-50 border-rose-200 text-rose-700"
        />
        <AdminBanner
          href="/admin/knowledge"
          title="Image Knowledge CMS"
          description="AI 이미지 모델이 이해하지 못하는 학교 고유 사물·공간을 설명·참조 이미지와 함께 등록합니다. 홈 히어로 배너도 여기서 관리."
          icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
          accent="from-sky-100 to-sky-50 border-sky-200 text-sky-700"
        />
      </div>
    </div>
  );
}

function AdminBanner({
  href,
  title,
  description,
  icon,
  accent,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className={
        'group block rounded-lg border bg-gradient-to-br p-5 transition-shadow hover:shadow-md ' +
        accent
      }
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-white/70 p-2 shadow-sm">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-foreground">{title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-foreground group-hover:underline">
            열기 →
          </div>
        </div>
      </div>
    </Link>
  );
}
