import { Toaster } from 'sonner';

import { QueryProvider } from '@/lib/query/provider';

import './globals.css';

import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

const SITE_URL = 'https://clipart.schoolp.co.kr';
const SITE_NAME = 'ClipArt Studio';
const SITE_DESC =
  '학교 현장을 위한 AI 클립아트 서비스. 원하는 이미지를 찾고, 없으면 만들고, 우리학교 워크스페이스에서 함께 활용하세요.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  keywords: [
    '클립아트',
    'AI 클립아트',
    '학교 클립아트',
    '수업 자료',
    '교육 이미지',
    'AI 이미지 생성',
    'ClipArt Studio',
    '스쿨피',
  ],
  authors: [{ name: '지란초 SchoolP', url: 'https://schoolp.co.kr' }],
  creator: '지란초 SchoolP',
  publisher: '지란초 SchoolP',
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESC,
    images: [
      {
        url: '/logo_blue.png',
        alt: `${SITE_NAME} 로고`,
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: SITE_NAME,
    description: SITE_DESC,
    images: ['/logo_blue.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  verification: {
    // Google Search Console — 환경변수 GOOGLE_SITE_VERIFICATION 에 콘솔에서
    // 발급받은 값(=<meta name="google-site-verification" content="..."/>)만
    // 넣으면 자동 렌더. 값이 없으면 태그 자체가 나오지 않는다.
    google: process.env.GOOGLE_SITE_VERIFICATION,
    // 네이버 서치어드바이저 — 표준 필드가 없어 other 로 삽입.
    other: process.env.NAVER_SITE_VERIFICATION
      ? { 'naver-site-verification': process.env.NAVER_SITE_VERIFICATION }
      : undefined,
  },
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <QueryProvider>
          {children}
          <Toaster richColors position="top-right" />
        </QueryProvider>
      </body>
    </html>
  );
}
