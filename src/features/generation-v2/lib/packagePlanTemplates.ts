// 목적별 기본 템플릿 — 서버가 /api/package-plan 에서 AI 요청 base 로,
// 그리고 AI 실패 시 fallback 으로 사용한다. 클라이언트는 API 응답 도착
// 전 optimistic UI 로 참조할 수도 있다.
//
// 항목 id 는 카테고리 slug 형태로 서버가 소유 (AI 임의 생성 금지).
// 카테고리 값은 packagePlanTypes.ts 의 PACKAGE_CATEGORIES whitelist.

import type { PackageAiItem } from './packagePlanTypes';

export interface PackagePlanTemplate {
  keywords: string[];
  items: PackageAiItem[];
}

/** 목적 문자열을 정규화된 template 키로 매핑. 미매치 시 'default'. */
export function templateKeyForPurpose(purpose: string): keyof typeof TEMPLATES {
  const trimmed = purpose.trim();
  if (!trimmed) return 'default';
  if (/독서|책/.test(trimmed)) return '독서 행사';
  if (/운동회|체육/.test(trimmed)) return '운동회';
  if (/졸업/.test(trimmed)) return '졸업식';
  if (/입학/.test(trimmed)) return '입학식';
  if (/학사|달력|월간/.test(trimmed)) return '학사 달력';
  if (/축제|페스티벌/.test(trimmed)) return '학교 축제';
  return 'default';
}

export const TEMPLATES = {
  '독서 행사': {
    keywords: ['책', '독서', '성장', '지식', '따뜻한 분위기'],
    items: [
      {
        id: 'reading-poster',
        category: 'poster',
        name: '행사 포스터',
        description: '메인 홍보 및 안내용',
        defaultQuantity: 2,
      },
      {
        id: 'reading-banner',
        category: 'banner',
        name: '가로형 배너',
        description: '홈페이지 · 행사장 안내용',
        defaultQuantity: 3,
      },
      {
        id: 'reading-illustration',
        category: 'illustration',
        name: '독서 삽화',
        description: '게시물 · 활동지 · 학급자료용',
        defaultQuantity: 12,
      },
      {
        id: 'reading-icon',
        category: 'icon',
        name: '책 아이콘',
        description: '목차 · 안내 · 제목 장식용',
        defaultQuantity: 8,
      },
      {
        id: 'reading-decoration',
        category: 'decoration',
        name: '장식 요소',
        description: '테두리 · 배경 · 코너 장식용',
        defaultQuantity: 10,
      },
    ],
  },
  '운동회': {
    keywords: ['운동회', '팀워크', '응원', '역동적', '밝은 분위기'],
    items: [
      {
        id: 'sports-poster',
        category: 'poster',
        name: '행사 포스터',
        description: '운동회 홍보 및 안내용',
        defaultQuantity: 2,
      },
      {
        id: 'sports-banner',
        category: 'banner',
        name: '가로형 배너',
        description: '운동장 · 홈페이지 배너',
        defaultQuantity: 4,
      },
      {
        id: 'sports-illustration',
        category: 'illustration',
        name: '경기 장면 삽화',
        description: '프로그램 · 활동지용',
        defaultQuantity: 10,
      },
      {
        id: 'sports-icon',
        category: 'icon',
        name: '종목 아이콘',
        description: '경기 안내 · 점수판 장식용',
        defaultQuantity: 8,
      },
      {
        id: 'sports-decoration',
        category: 'decoration',
        name: '응원 장식',
        description: '테두리 · 코너 · 리본 장식',
        defaultQuantity: 6,
      },
    ],
  },
  '졸업식': {
    keywords: ['졸업', '축하', '희망', '따뜻한 분위기', '기념'],
    items: [
      {
        id: 'grad-poster',
        category: 'poster',
        name: '졸업식 포스터',
        description: '식장 안내 및 홍보용',
        defaultQuantity: 2,
      },
      {
        id: 'grad-cover',
        category: 'cover',
        name: '졸업앨범 표지',
        description: '앨범 · 문집 표지용',
        defaultQuantity: 3,
      },
      {
        id: 'grad-illustration',
        category: 'illustration',
        name: '졸업 장면 삽화',
        description: '기념자료 · 카드용',
        defaultQuantity: 8,
      },
      {
        id: 'grad-decoration',
        category: 'decoration',
        name: '축하 장식',
        description: '리본 · 꽃 · 별 장식',
        defaultQuantity: 8,
      },
      {
        id: 'grad-divider',
        category: 'divider',
        name: '구분선/줄 장식',
        description: '문집 · 프로그램 장식용',
        defaultQuantity: 4,
      },
    ],
  },
  '입학식': {
    keywords: ['입학', '새 학기', '설렘', '따뜻한 분위기', '환영'],
    items: [
      {
        id: 'entrance-poster',
        category: 'poster',
        name: '입학식 포스터',
        description: '식장 안내 및 홍보용',
        defaultQuantity: 2,
      },
      {
        id: 'entrance-banner',
        category: 'banner',
        name: '환영 배너',
        description: '교문 · 홈페이지 배너',
        defaultQuantity: 3,
      },
      {
        id: 'entrance-illustration',
        category: 'illustration',
        name: '학교 생활 삽화',
        description: '안내자료 · 게시물용',
        defaultQuantity: 8,
      },
      {
        id: 'entrance-icon',
        category: 'icon',
        name: '학용품 아이콘',
        description: '준비물 안내 장식용',
        defaultQuantity: 6,
      },
      {
        id: 'entrance-decoration',
        category: 'decoration',
        name: '환영 장식',
        description: '테두리 · 리본 · 코너 장식',
        defaultQuantity: 6,
      },
    ],
  },
  '학사 달력': {
    keywords: ['학사', '월간', '일정', '심플', '학교 캘린더'],
    items: [
      {
        id: 'calendar-monthly',
        category: 'monthly_image',
        name: '월간 이미지',
        description: '월별 캘린더 상단 이미지',
        defaultQuantity: 12,
      },
      {
        id: 'calendar-icon',
        category: 'icon',
        name: '행사 아이콘',
        description: '학사 일정 · 이벤트 아이콘',
        defaultQuantity: 10,
      },
      {
        id: 'calendar-decoration',
        category: 'decoration',
        name: '달력 장식',
        description: '테두리 · 배경 장식용',
        defaultQuantity: 6,
      },
      {
        id: 'calendar-divider',
        category: 'divider',
        name: '구분선',
        description: '주 · 월 구분 장식용',
        defaultQuantity: 4,
      },
    ],
  },
  '학교 축제': {
    keywords: ['축제', '흥겨움', '학생 참여', '컬러풀', '활기찬 분위기'],
    items: [
      {
        id: 'festival-poster',
        category: 'poster',
        name: '축제 포스터',
        description: '홍보 및 안내용',
        defaultQuantity: 2,
      },
      {
        id: 'festival-banner',
        category: 'banner',
        name: '가로형 배너',
        description: '홈페이지 · 무대 배너',
        defaultQuantity: 4,
      },
      {
        id: 'festival-illustration',
        category: 'illustration',
        name: '축제 장면 삽화',
        description: '프로그램 · 활동지용',
        defaultQuantity: 10,
      },
      {
        id: 'festival-icon',
        category: 'icon',
        name: '부스 아이콘',
        description: '동아리 · 부스 안내 장식용',
        defaultQuantity: 8,
      },
      {
        id: 'festival-decoration',
        category: 'decoration',
        name: '축제 장식',
        description: '리본 · 배경 · 코너 장식',
        defaultQuantity: 6,
      },
    ],
  },
  default: {
    keywords: ['학교', '따뜻한 분위기', '학생', '수업 자료'],
    items: [
      {
        id: 'default-poster',
        category: 'poster',
        name: '포스터',
        description: '메인 홍보 및 안내용',
        defaultQuantity: 2,
      },
      {
        id: 'default-illustration',
        category: 'illustration',
        name: '삽화',
        description: '자료 · 활동지 · 게시물용',
        defaultQuantity: 8,
      },
      {
        id: 'default-icon',
        category: 'icon',
        name: '아이콘',
        description: '안내 · 제목 · 목록 장식용',
        defaultQuantity: 6,
      },
      {
        id: 'default-decoration',
        category: 'decoration',
        name: '장식 요소',
        description: '테두리 · 배경 · 코너 장식용',
        defaultQuantity: 6,
      },
    ],
  },
} as const satisfies Record<string, PackagePlanTemplate>;

export function getTemplateForPurpose(purpose: string): PackagePlanTemplate {
  return TEMPLATES[templateKeyForPurpose(purpose)];
}
