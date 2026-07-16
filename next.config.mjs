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
    // archiver 는 하위 의존성 package.json exports 조건이 webpack 파서와 충돌하므로
    // 마찬가지로 external 로 두어 Node runtime 에서 그대로 require 되게 한다.
    serverComponentsExternalPackages: ['sharp', 'archiver'],
  },
};

export default nextConfig;
