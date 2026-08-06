// Organization 컨텍스트 (v1 generation 페이지에서 사용). 원래는 삭제된
// `/generate/page.tsx` 안에 export 되어 있었으나, Plan v0.2.2 §M2 에서
// 페이지가 삭제되어 shared 위치로 이동한다.
//
// v2 (generation-v2) 로의 UI 통합은 M4 UI 정리 시점에 처리 예정.
// 그 전까지 GenerationForm / SchoolContextCard 가 이 타입을 계속 참조한다.

import type { SchoolLevel } from '@/types/domain';

export interface OrgGenerationContext {
  id: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  schoolLevel: SchoolLevel | null;
  basePrompt: string | null;
  styleEnabled: boolean;
}
