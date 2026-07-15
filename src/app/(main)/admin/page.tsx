// Admin-only. /admin 접속 시 Knowledge CMS 로 바로 이동.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  redirect('/admin/knowledge');
}
