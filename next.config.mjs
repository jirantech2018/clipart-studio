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
    // @sparticuz/chromium 과 puppeteer-core 도 external 로 두어 번들러가
    // native binary · shared lib 참조를 깨뜨리지 않도록 한다 (learning-helper
    // PDF 렌더러가 Railway 에서 정상 실행되기 위한 필수 설정).
    serverComponentsExternalPackages: ['sharp', '@sparticuz/chromium', 'puppeteer-core'],
  },
  // Organization-centric 재구성 (Plan v0.2.2 §M2):
  //   기존 개인 최상위 페이지 (/library, /generate, /generate-v2) 는 삭제되고
  //   MY Organization 하위 경로로 통합된다. 기존 링크·북마크·이메일·검색 결과
  //   호환성을 위해 302 permanent=false 로 매핑만 유지.
  //   앱 내부 링크는 이 redirect 에 의존하지 않고 처음부터 새 경로를 사용한다.
  // iframe 임베드 정책:
  //   - /embed/* 는 마케팅 사이트(clipart.schoolp.co.kr) + namo.site 계열에서 삽입.
  //   - 그 외 경로도 파일럿 배포 사이트(namo.site) 에서 임베드할 수 있도록 허용.
  //     X-Frame-Options 은 여러 도메인 whitelist 를 지원하지 않으므로 제거하고
  //     CSP frame-ancestors 로만 통제한다 (현대 브라우저 표준).
  async headers() {
    const embedAncestors = "frame-ancestors 'self' https://*.schoolp.co.kr https://*.namo.site";
    return [
      {
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: embedAncestors },
        ],
      },
      {
        source: '/((?!embed).*)',
        headers: [
          { key: 'Content-Security-Policy', value: embedAncestors },
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
