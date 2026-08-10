// Admin-only. /admin 접속 시 Token Dashboard 로 바로 이동 (M4-1 primary landing).
// Knowledge CMS 는 `/admin/knowledge` 에서 계속 접근 가능.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  redirect('/admin/token-dashboard');
}
