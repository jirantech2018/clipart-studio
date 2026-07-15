// 이 페이지는 /admin 로 통합됨. 기존 링크/북마크가 깨지지 않게 리다이렉트만 남긴다.

import { redirect } from 'next/navigation';

export default function AdminPromptsRedirect() {
  redirect('/admin');
}
