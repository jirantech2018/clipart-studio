import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // text-sm (0.875rem / 14px) 을 앱 전역 최소 크기로 강제.
      // text-xs 는 기본이 0.75rem 인데 sm 과 동일 값으로 올림 — 이미
      // 프로젝트 전반에 text-xs 가 많아 개별 교체 대신 스케일 자체를 조정.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
      },
      // 전역 기본 폰트를 Pretendard 로. @font-face 정의는 globals.css 최상단.
      // font-sans 유틸리티가 곧 Pretendard → 시스템 sans 순서를 갖는다.
      fontFamily: {
        sans: [
          'Pretendard',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Apple SD Gothic Neo',
          'Noto Sans KR',
          'Malgun Gothic',
          'sans-serif',
        ],
      },
      // Conversation Timeline 슬롯/썸네일 등장, 상태 전환용 소프트 fade.
      // 지시서상 "200~300ms 자연스러운 Transition" 범위에서만 사용.
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 250ms ease-out',
        'fade-in-up': 'fade-in-up 250ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
