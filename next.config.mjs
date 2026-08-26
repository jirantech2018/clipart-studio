/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // sharp가 서버리스 번들에 포함되지 않고 native runtime 모듈로 남게 해서
    // Vercel의 Linux native 바이너리 프리셋이 정상 로드되도록 한다.
    serverComponentsExternalPackages: ['sharp'],
  },
  // Organization-centric 재구성 (Plan v0.2.2 §M2):
  //   기존 개인 최상위 페이지 (/library, /generate, /generate-v2) 는 삭제되고
  //   MY Organization 하위 경로로 통합된다. 기존 링크·북마크·이메일·검색 결과
  //   호환성을 위해 302 permanent=false 로 매핑만 유지.
  //   앱 내부 링크는 이 redirect 에 의존하지 않고 처음부터 새 경로를 사용한다.
  // /embed/* 라우트는 clipart.schoolp.co.kr (마케팅 사이트) 에서 iframe 으로
  // 삽입한다. 다른 도메인의 clickjacking 은 CSP frame-ancestors 로 차단.
  // 그 외 경로는 여전히 어떤 사이트도 iframe 삽입 금지 (기본 Same-Origin).
  async headers() {
    return [
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://clipart.schoolp.co.kr https://*.schoolp.co.kr",
          },
        ],
      },
      {
        source: '/((?!embed).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      {
        source: '/library',
        destination: '/organization/my/library',
        permanent: false,
      },
      {
        source: '/library/:path*',
        destination: '/organization/my/library/:path*',
        permanent: false,
      },
      {
        source: '/generate',
        destination: '/organization/my/generate',
        permanent: false,
      },
      {
        source: '/generate/:path*',
        destination: '/organization/my/generate/:path*',
        permanent: false,
      },
      {
        source: '/generate-v2',
        destination: '/organization/my/generate',
        permanent: false,
      },
      {
        source: '/generate-v2/:path*',
        destination: '/organization/my/generate/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
