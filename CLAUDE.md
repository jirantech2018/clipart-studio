# CLAUDE.md — ClipArt Studio

프로젝트 컨텍스트를 Claude Code에 제공하기 위한 파일. **한국어**로 응답하고, **한국어 커밋 메시지 사용 안 함** (Conventional Commits 영문).

## 1. Product

- **한 줄**: 계정 기반 AI 클립아트 생성·재사용 서비스 (학교 컨텍스트 최적화)
- **North Star**: 찾고, 없으면 만들고, 만들면 **계정의 자산이 된다**. 그리고 **Community에서 공유할 수 있다.**
- **Killer Feature**: 이미지 체이닝 (i2i로 하나의 캐릭터를 세계관으로 확장)

## 2. Source of Truth

작업 전 반드시 참조:
- `docs/00-pm/clipart-studio.prd.md` (v1.1) — Product Requirements
- `docs/01-plan/features/clipart-studio.plan.md` (v0.1) — Plan
- `docs/02-design/features/clipart-studio.design.md` (v0.1) — Design (SSoT for architecture)

**규칙**: 이 3개 문서와 코드가 어긋나면 문서가 이깁니다. 코드 변경 시 문서를 먼저 갱신.

## 3. Architecture (Pragmatic — Design §2.0)

```
src/
├─ app/           # Next.js App Router (page.tsx, route.ts)
├─ features/      # 기능별 도메인 모듈 (다른 feature 참조 금지)
│  ├─ auth/       # 로그인, Onboarding, CreditBadge
│  ├─ profile/    # School Profile
│  ├─ generation/ # (module-2) 배치 생성
│  ├─ library/    # (module-3) 저장·검색
│  ├─ chaining/   # (module-4) i2i
│  └─ community/  # (module-5) 공개 풀
├─ services/      # 외부 서비스 어댑터 (교체 가능)
│  ├─ supabase/   # DB + Auth 클라이언트
│  ├─ credit/     # RPC 호출 (reserve/refund)
│  ├─ image-gen/  # (module-2) gpt-image-1 / FLUX
│  ├─ r2/         # (module-3) Cloudflare R2
│  └─ tagging/    # (module-3) gpt-4o-mini
├─ components/
│  ├─ ui/         # 재사용 UI (Button, Card, ...)
│  └─ layout/     # AppHeader, AppSidebar
├─ lib/           # 공통 유틸 (store, query, utils)
└─ types/         # 도메인 타입, Zod 스키마
```

**Import 규칙** (Design §9.3):
- `features/{X}` → `features/{Y}` 직접 참조 **금지**. 공유 로직은 `services/` 또는 `lib/`로.
- `services/` → `features/`, `app/` 참조 금지 (역방향)
- `types/`, `lib/` → 외부 의존 최소화

## 4. Tech Stack

| 계층 | 기술 |
|-----|------|
| Framework | Next.js 14 App Router |
| State | Zustand (UI) + TanStack Query (서버 상태) |
| Form | react-hook-form + Zod |
| Styling | Tailwind CSS + shadcn/ui (수동 축약본) |
| DB | Supabase PostgreSQL (RLS) |
| Auth | Supabase Auth (OTP + OAuth) |
| Storage | Cloudflare R2 (module-3부터) |
| AI | OpenAI gpt-image-1 (1순위) / Replicate FLUX (2순위) |
| Test | Vitest (unit) + Playwright (E2E) |
| Package | pnpm |

## 5. Non-Negotiable Rules

1. **Credit 계산 금지**: `services/credit/index.ts`의 `reserveCredits` / `refundCredits` RPC만 사용. `credits = credits - N` 절대 금지 (race condition).
2. **AI 키 서버 전용**: `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`은 `NEXT_PUBLIC_` 접두사 금지. 이미지 생성은 100% Route Handler 경유.
3. **AI 라벨 필수**: 이미지 상세에는 반드시 `<AIGeneratedBadge />` 노출 (§5.4 Page UI Checklist).
4. **Community = 명시적 공개만**: 기본 Private. `is_public=TRUE` 토글 없이는 절대 타 계정 노출 금지 (RLS로 강제).
5. **School Profile은 Optional**: 미보유자는 "🏫 학교 스타일 적용" 토글 UI 자체가 렌더링되지 않아야 함.
6. **Pending 자동 삭제**: 생성물 24시간 미저장 시 자동 삭제 배치 (module-2에서 구현).
7. **학습자료 생성 원칙**: `docs/03-analysis/learning-generation-principles.md` 를 반드시 준수. 학습자료 생성·프롬프트·검수·재생성·테스트 관련 모든 변경은 착수 전 §10 반사실 테스트(과목·단원·주제명을 다른 미지 교과로 바꿔도 유효한가)를 통과해야 한다. 사례별 if/else, 금지어 목록, 특정 문자열 검사, 특정 정답을 아는 테스트 코드는 공통 생성·검수 경로에 추가 금지.

## 6. Naming & Style

- 컴포넌트: `PascalCase.tsx` (예: `GenerationForm.tsx`)
- 유틸: `camelCase.ts` (예: `parseSSE.ts`)
- 폴더: `kebab-case/` (예: `image-gen/`)
- 훅: `useX` (예: `useSchoolProfile`)
- Adapter Interface: `XAdapter` (예: `ImageGenAdapter`)
- Zod Schema: `xSchema` (예: `schoolProfileSchema`)
- DB Function: `snake_case` (예: `reserve_credits`)

## 7. Testing Policy

- **module 완성 = 코드 + 테스트 통과** (Design §8 원칙)
- Vitest: `services/credit`, `services/image-gen` 어댑터 등 순수 로직
- Playwright: 4 골든 패스 (§8.4)
- 새 API endpoint 추가 시 L1 테스트 시나리오 우선 작성 후 구현

## 8. PDCA Status

- Phase: **Do (module-1 Foundation)** — 진행 중
- 다음: module-2 Generation Core (`/pdca do clipart-studio --scope module-2`)
