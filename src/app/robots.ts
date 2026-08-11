import type { MetadataRoute } from 'next';

const SITE_URL = 'https://clipart.schoolp.co.kr';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/auth/',
          '/organization/my',
          '/organization/my/',
          '/organizations/new',
          '/profile',
          '/image/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
