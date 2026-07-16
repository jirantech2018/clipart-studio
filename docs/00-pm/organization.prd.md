# Organization — PRD v0.2

- **Status**: Reviewed (5 core open questions confirmed by user)
- **Author**: sbtmxk20
- **Date**: 2026-07-16
- **Version**: 0.2 (v0.1 리뷰 반영)
- **Related**: [ClipArt Studio PRD v1.1](./clipart-studio.prd.md), [Organization Design](../02-design/features/organization.design.md)

## Changelog

- **v0.2 (2026-07-16)** — 사용자 리뷰 반영: KPI 4개 갱신, Scope 에 조직 활동 로그 추가, 결정 13 을 `visibility` enum 통합으로 재확정 (기존 is_shareable + is_public 모두 단일 enum 으로 대체)
- **v0.1 (2026-07-16)** — 최초 draft. 13 결정 항목 옵션·추천안 제시

---

## 1. Overview

| 항목 | 내용 |
|-----|------|
| Product | ClipArt Studio — Organization 기능 |
| Category | SaaS 형태 조직 단위 자산 공유·권한 관리 |
| Motivation | 현재 계정 모델 (사람 1명 = 계정 1개) 은 팀 협업·조직 자산 관리 불가. SaaS 로 진화하려면 조직 개념 필수 |
| Position | MY라이브러리(`/library`) 와 워크스페이스(`/community`) **사이** 에 위치하는 새 계층 |

**핵심 목표**: 이미지의 공개 범위를 3단계로 명확히 분리하고, 조직 단위의 자산 공유·권한 통제를 가능하게 한다.

```
private (개인 라이브러리)
  → organization (조직 내부 공유)
    → community (전체 공개)
```

## 2. Problem & Solution

### Problem

**P1. 같은 학교/조직의 사용자가 자료를 공유하기 어렵다.**
현재는 A교사가 만든 이미지를 B교사가 쓰려면 Community 로 완전히 공개하거나 개별 링크 공유해야 함. 조직 내부에만 공유하는 방법이 없음.

**P2. 조직 단위 자산 브랜드 관리가 불가능하다.**
학원·사업체 등이 "조직 자산 라이브러리" 를 운영하고 싶어도 지금은 개인 계정 소유물일 뿐. 사용자가 퇴사하면 자산이 사라짐.

**P3. Community 공개는 되돌리기 어렵고 조심스럽다.**
지금은 Private ↔ Public 두 상태뿐. 중간 단계 "조직 내부에서만 공유" 가 없어서 사용자가 Community 공개를 주저함.

**P4. SaaS 결제·과금 모델이 계정 단위로만 가능하다.**
조직당 크레딧 풀·시트 기반 결제가 불가능. 대량 구매 협상이 안 됨.

### Solution

- **Organization 엔티티 도입** — 여러 계정을 묶는 컨테이너
- **3단계 공개 모델** — private / organization / community
- **역할 기반 권한** — owner/admin/editor/viewer
- **이미지 조직 공유** — 개인이 만든 이미지를 조직 라이브러리로 승격 (역방향도 지원)

## 3. Users & Personas

### 기존 페르소나 (v1.1 유지)
P1 선생님, P2 학생, P3 학교, P4 학교 관계자, P5 일반

### 조직 도입으로 신규 등장
- **P6 조직 소유자 (Org Owner)** — 학원 원장, 학교 정보부장, 스튜디오 대표. 조직 생성·삭제·결제·소유권 이전
- **P7 조직 관리자 (Org Admin)** — 멤버 초대·역할 부여·이미지 승인/공개 담당
- **P8 조직 편집자 (Org Editor)** — 조직 라이브러리 열람 + 자기 이미지를 조직에 공유
- **P9 조직 뷰어 (Org Viewer)** — 조직 라이브러리 열람만

### Account × Organization 관계

- 한 계정은 **여러 조직에 동시에 소속 가능** (교사 A 가 학교 조직 + 개인 학원 조직에 동시 소속 등)
- 한 조직은 여러 멤버를 가짐 (1:N)
- 계정 자체는 여전히 사람 1명 = auth.users 1개
- School Profile 은 여전히 계정 필드로 남음 — 조직과 무관

## 4. 3단계 공개 모델 상세

### 기본 흐름 (승격)
```
[MY라이브러리] private
     ↓ (이미지 소유자가 명시적 액션)
[조직 라이브러리] organization
     ↓ (조직 admin/owner 가 명시적 액션)
[Community] community
```

### 역방향 (강등)
```
community → organization    (Community 공개 취소)
organization → private       (조직 공유 취소; 조직 소유 이미지의 경우 특별 규칙, §7 참조)
```

### 링크 공유 (P1 에서 도입한 is_shareable)
링크 공유는 위 3단계와 **직교 (orthogonal)** 함. 즉 어떤 공개 단계이든 소유자가 별도로 링크 공유를 켤 수 있음. 단 링크 공유 범위는 조직 정책으로 통제 가능 (§8 참조).

## 5. Success Metrics (KPI) — v0.2 확정

| 지표 | 정의 | 목표 |
|-----|-----|-----|
| **초대 수락률** | 발송된 초대 중 7일 내 수락한 비율 | ≥ 60% |
| **조직 활성화율** | 조직 생성 후 7일 내 owner 외 추가 멤버 최소 1명 확보한 조직 비율 | ≥ 70% |
| **조직 이미지 공유율** | 조직 소속 멤버가 개인 이미지 중 조직에 공유한 비율 | ≥ 40% |
| **Community 승격율** | 조직 라이브러리 이미지 중 Community 로 승격된 비율 | 15~20% |

## 6. Scope

### ✅ In (Organization v1.0)
- 조직 생성/편집/삭제 (owner)
- 이메일 기반 멤버 초대 (링크 만료 7일, 재발송 가능)
- 4가지 역할 (owner/admin/editor/viewer)
- 이미지의 조직 라이브러리 승격/강등
- 조직 라이브러리 페이지 (`/organization/[organizationId]`)
- **`visibility` enum 기반 통합 공개 모델** (`private / organization / authenticated / public`)
- **조직 활동 로그** (organization_activity_logs) — 멤버 초대·삭제·역할 변경, 이미지 공유·강등, Community 승격·취소 등의 이벤트 기록. 조직 관리 페이지에서 admin+ 가 조회 가능

### ❌ Out (v1.0 제외, v2+ 예정)
- 여러 조직 동시 공유 (한 이미지가 여러 조직 라이브러리에 동시에 나타나기) — v2
- 조직 소유 이미지 (개인 소유가 아닌 순수 조직 자산; 결정 5 참조) — v2
- 조직별 결제·크레딧 풀 — v3
- SSO / SAML — v3
- 조직 간 이미지 공유 — v3
- 조직 내 서브그룹 (부서·팀) — v3

---

## 7. Business Rules — 13 결정 항목

각 항목마다 **옵션 → 추천 → 트레이드오프** 형식. 리뷰 후 확정본으로 갱신.

---

### 결정 1. `organizations` 테이블 필수 필드

**옵션**
- (A) 최소: id, name, slug, owner_id, created_at
- (B) 중간: A + description, avatar_url, homepage_url
- (C) 풍부: B + billing_email, address, country, industry

**추천**: **(B) 중간** — description/avatar 는 조직 페이지 UX 에 필수적이고, billing/address 는 결제(v3) 도입 시 별도 `organization_billing` 테이블로 분리하는 편이 유연

**트레이드오프**: (C) 는 v3 결제와 맞물려 재작업 위험. (A) 는 조직 페이지가 너무 밋밋

---

### 결정 2. `organization_members` 스키마

**옵션**
- (A) `(organization_id, user_id, role, joined_at)` — 관계만
- (B) A + `display_name_override` (조직 내 표시명 다르게)
- (C) A + `status`(active/suspended) — 정지된 멤버 관리

**추천**: **(C)** — 정지된 멤버를 즉시 삭제하지 않고 유지하면 감사 로그·복구가 쉬움. display_name_override 는 프라이버시 요구 없이는 굳이

**트레이드오프**: status 컬럼 하나 추가는 비용 미미

---

### 결정 3. `organization_invites` 스키마

**옵션**
- (A) 이메일 기반: `(email, organization_id, invited_by, role, token, expires_at, accepted_at)`
- (B) A + `invited_user_id` (이미 계정이 있는 사용자 초대는 링크 없이 알림)
- (C) 링크만 (이메일 없음): `(organization_id, token, role, max_uses, expires_at)` — 슬랙식 초대 링크

**추천**: **(A) 이메일 기반** — v1.0 에는 명확한 흐름 하나만. 이미 계정이 있으면 로그인 후 초대 링크 클릭 시 즉시 가입. (C) 링크만 방식은 편하지만 무분별 가입 위험

**트레이드오프**: (C) 는 대규모 조직 온보딩엔 편리. 하지만 v1.0 스코프 넘음

---

### 결정 4. 조직 역할·권한 매트릭스

**옵션**
- (A) 3단계: owner / admin / member
- (B) **4단계: owner / admin / editor / viewer**
- (C) 세밀 (커스텀 역할)

**추천**: **(B) 4단계** — 조직에 "열람만 가능한 참관자" 요구가 흔함 (교장·감사자·클라이언트 리뷰). (C) 는 SaaS 성숙기에 필요, v1.0 은 과잉

**권한 매트릭스 (추천안)**

| 액션 | owner | admin | editor | viewer |
|---|:-:|:-:|:-:|:-:|
| 조직 삭제 | ✓ | ✗ | ✗ | ✗ |
| 조직 정보 수정 | ✓ | ✓ | ✗ | ✗ |
| 멤버 초대·역할 변경·강퇴 | ✓ | ✓ | ✗ | ✗ |
| 조직 라이브러리 열람 | ✓ | ✓ | ✓ | ✓ |
| 조직 라이브러리 이미지 다운로드 | ✓ | ✓ | ✓ | ✓ |
| 내 이미지를 조직에 공유 | ✓ | ✓ | ✓ | ✗ |
| 남의 조직 공유 이미지 강등(취소) | ✓ | ✓ | 본인 것만 | ✗ |
| 조직→Community 공개 승격 | ✓ | ✓ | ✗ | ✗ |
| Community→조직 강등 | ✓ | ✓ | ✗ | ✗ |
| 조직 이미지 삭제 | ✓ | ✓ | 본인 것만 | ✗ |

---

### 결정 5. 개인 소유 vs 조직 소유 이미지 구분 — v0.2 확정

**옵션**
- (A) **개인 소유만** — 이미지는 항상 계정(auth.users) 소유. 조직 공유 = 조회 권한 부여
- (B) 조직 소유 병존 — 이미지에 `owner_type: 'user'|'organization'` 을 두어 순수 조직 자산 지원
- (C) 소유권 이전 — 개인 이미지를 조직에 "이관" 하면 개인 라이브러리에서 사라지고 조직 자산이 됨

**확정: (A) 개인 소유만 (v1.0)**. v2 에서 (B) 로 확장 여지 남김
- v1.0 은 SaaS 로의 첫 걸음. 소유권 개념 복잡화는 리스크
- 조직 이미지 = "누군가 개인이 만든 이미지에 조직 라벨이 붙은 것"
- 크레딧도 여전히 계정 단위로 소비

**트레이드오프**: (B/C) 는 조직 브랜드 관리에 유리하지만 소유권 이전 시 크레딧·과금 정책이 복잡해짐

---

### 결정 6. 이미지의 Organization 공유 방식 — v0.2 확정

**옵션**
- (A) `images.organization_id` 컬럼 (nullable, 단일 조직) — 이미지가 한 조직에만 공유 가능
- (B) `image_organization_shares` 연결 테이블 — 한 이미지가 여러 조직에 동시 공유 가능
- (C) 하이브리드: `images.organization_id` 를 primary organization 으로 두고 추가 공유는 별도 테이블

**확정: (B) 연결 테이블** — v1.0 UI 는 단일 조직으로만 노출하지만 스키마는 확장 가능하게. 나중에 여러 조직 동시 공유(스코프 out) 를 도입할 때 스키마 마이그레이션 불필요
- 테이블명: `image_organization_shares(image_id, organization_id, shared_by_user_id, shared_at)`
- v1.0 API 는 이미지 하나당 조직 하나까지만 허용 (Zod 검증)
- 데이터 구조는 이미 N:N

**트레이드오프**: (A) 가 v1.0 쿼리는 단순. 하지만 확장 시 재작업 큼

---

### 결정 7. Community 공개 권한 (조직 이미지)

**옵션**
- (A) 이미지 소유자만 Community 공개 가능 (조직과 무관)
- (B) 조직 owner/admin 이 대리 공개 가능 (조직 라이브러리에 있는 이미지 한정)
- (C) 조직 owner/admin 만 가능 — 개인이 조직에 공유한 순간 Community 결정권도 조직에

**추천**: **(B)** — 이미지 소유자의 권리는 유지하되, 조직 admin 도 대리 공개 가능. 조직 브랜드 통제에 유리
- 단, 이미지 소유자는 언제든 자기 이미지를 조직에서 강등(§8) 시켜 Community 노출을 막을 수 있음
- Community 승격 시 알림은 이미지 소유자에게 반드시 전송

**트레이드오프**: (C) 는 SaaS 브랜드 통제에 강력. 하지만 계정 소유권 침해 소지

---

### 결정 8. 조직 탈퇴 시 이미지 처리

**옵션**
- (A) 조직 공유 자동 취소 (개인 라이브러리로 되돌아감)
- (B) 조직에 남음 (owner 승인 시 유지)
- (C) 사용자 선택 (탈퇴 시 이미지별 처리 dialog)

**추천**: **(A) 자동 취소** — 개인 소유 원칙(결정 5) 과 일치. 명확하고 데이터 소유 감각과 맞음
- 예외 규칙: `image_organization_shares.left_membership_kept: bool` 필드로 "탈퇴 후에도 조직에 남기고 싶다" 명시적 케이스만 예외 처리 (v2)

**트레이드오프**: (B) 는 조직 자산 손실 방지. 하지만 사용자 동의 없이 남기는 건 소유권 원칙 위반

---

### 결정 9. 조직 삭제 시 자산 처리

**옵션**
- (A) 조직만 삭제, 이미지는 개인 소유 그대로 유지 (조직 공유 링크만 끊어짐)
- (B) 조직 관련 데이터 (초대·멤버) 만 삭제, `image_organization_shares` 는 남겨서 조직 재활성 시 복구 가능
- (C) 하드 삭제 (모든 관계 제거) + 삭제 전 owner 에게 confirm

**추천**: **(A) + soft delete** — organizations 테이블에 `deleted_at` (soft delete). 실제 데이터는 30일 유지 후 하드 삭제. 이미지 자체는 개인 소유로 안전
- 30일 유예 기간 동안 owner 는 복구 가능
- 30일 후 CASCADE 로 members/invites/shares 모두 삭제

**트레이드오프**: (C) 는 즉시 정리로 GDPR 등에 유리. 하지만 실수 삭제 복구 불가

---

### 결정 10. 한 이미지의 여러 조직 동시 공유 여부 — v0.2 확정

**옵션**
- (A) v1.0 부터 지원 (UI + API 모두 열기)
- (B) 스키마는 지원 (연결 테이블), UI 는 단일 조직만 노출 — **v2 에서 UI 확장**
- (C) 스키마도 단일 (images.organization_id) — 나중에 스키마 마이그레이션

**확정: (B)** — 결정 6 과 짝. 스키마는 유연하되 v1.0 사용자는 혼란 없이 "1 이미지 - 1 조직" 으로 시작

**트레이드오프**: (A) 는 v1.0 UX 복잡화. (C) 는 v2 마이그레이션 비용

---

### 결정 11. `images.organization_id` 직접 vs 연결 테이블

결정 6 과 동일. **연결 테이블 (`image_organization_shares`)** 로 결정.

---

### 결정 12. RLS & API 권한 정책

Design 문서(§4) 에서 상세. PRD 수준 결정:

- **모든 접근 제어는 RLS 로 강제** — Non-Negotiable Rule 4 유지 (Community 노출은 명시 토글만)
- **API 는 이중 방어층** — RLS + 명시 조건 (P2a 에서 확립한 패턴 유지)
- **역할 검증은 서버에서만** — 클라이언트는 UI 힌트로만 사용

---

### 결정 13. 공개 범위 표현 (visibility 통합) — v0.2 재확정

**v0.1 리뷰 결과**: 사용자가 "is_shareable boolean 을 유지하지 말고, 하나의 `visibility` enum 으로 통합" 을 선택. 이에 따라 `is_public` 컬럼도 별개로 두지 않고 같은 enum 에 흡수한다.

**최종 결정**: **단일 `images.visibility` enum 도입 → 기존 `is_public` + `is_shareable` 두 boolean 을 모두 대체**

**enum 값과 의미**

| 값 | 접근 가능한 사용자 | Community 페이지 노출 |
|---|---|---|
| `private` | 소유자만 | ✗ |
| `organization` | 소유자 + 이 이미지를 공유받은 조직의 active 멤버 | ✗ |
| `authenticated` | 로그인한 모든 회원 (링크만 알면) | ✗ |
| `public` | 로그인한 모든 회원 (링크 or Community 진입 모두) | ✓ |

**정책적 의미**:
- 승격 흐름 `private → organization → authenticated → public` 이 자연스러운 부분 순서로 표현됨
- Community 노출 = `visibility='public'` 로 조회 필터 단순화 (기존 `WHERE is_public = TRUE` 그대로 대체)
- 링크 공유 상태 = `visibility >= 'authenticated'` (즉 `authenticated` 또는 `public`) — 링크 클릭 시 로그인 회원이면 볼 수 있음
- 비회원 접근은 v1.0 out. 필요하면 v2 에서 별도 flag 로 추가

**마이그레이션 규칙** (033):
```sql
ALTER TABLE images ADD COLUMN visibility image_visibility NOT NULL DEFAULT 'private';

UPDATE images SET visibility = 'public'         WHERE is_public = TRUE;
UPDATE images SET visibility = 'authenticated'  WHERE is_public = FALSE AND is_shareable = TRUE;
-- 나머지는 default 'private' 유지

ALTER TABLE images DROP COLUMN is_public;
ALTER TABLE images DROP COLUMN is_shareable;
```

**조직 policy 상한**: `organizations.max_visibility` — 조직 admin 이 "우리 조직 이미지는 authenticated 이상 못 나가게" 상한 강제 가능. 이미지 소유자가 그 상한을 넘어서는 visibility 로 세팅하려 하면 API/RLS 에서 거부.

**트레이드오프**: 하나의 enum 으로 통합하면 semantic 이 훨씬 깔끔하고, 두 boolean 조합의 애매한 상태(is_public=TRUE + is_shareable=TRUE 등) 도 사라짐. 대신 마이그레이션 규모가 P1/P2 확장분까지 통째로 재작업.

---

## 8. Deferred Decisions (설계 리뷰에서 결정 필요)

- **크레딧 정책**: 조직 멤버가 조직 컨텍스트에서 생성한 이미지의 크레딧은 누가 부담? (v1.0 은 개인 부담, v3 결제 도입 시 재검토)
- **알림 정책**: 조직 초대·이미지 승격 등의 알림 채널 (이메일 only vs 인앱 vs 둘 다)
- **감사 로그**: 조직 내 액션(승격·강등·역할 변경) 감사 로그 저장 여부 (v1.0 out, v2 예정)
- **조직 slug 정책**: URL 에 노출될 slug 의 예약어·중복 규칙

## 9. Open Questions — v0.2 Status

### ✅ v0.1 리뷰에서 확정된 항목
1. **결정 5 — 이미지 소유**: 개인 소유만 (v1.0)
2. **결정 6/10/11 — 공유 방식**: image_organization_shares 연결 테이블, N:N 스키마, v1.0 UI 단일 조직
3. **결정 13 — 공개 범위 표현**: `visibility` enum 통합 (`private / organization / authenticated / public`). is_public + is_shareable 모두 대체
4. **Scope In**: 조직 활동 로그 (organization_activity_logs) 추가
5. **KPI**: 초대 수락률 60% / 조직 활성화율 70% / 조직 이미지 공유율 40% / Community 승격율 15~20%

### 🟡 여전히 열려있는 항목 (구현 착수 전에 확정 필요)

- **`public` 의 의미 재확정**: 현재 정의는 "로그인 회원 누구나 접근 + Community 페이지 노출". 비회원 접근은 v1.0 out. 사용자가 원한 정의와 일치하는지 확인 필요
- **조직 slug 예약어 목록**: `admin`, `new`, `settings`, `invites`, `api` 등
- **초대 만료 기본값**: 7일 확정 (Design v0.1 도 7일). 변경 없이 갈지
- **조직 삭제 유예 기간**: 30일 (soft delete). 변경 없이 갈지
- **viewer 다운로드 권한**: 결정 4 매트릭스에서 viewer 도 다운로드 가능. 이 정책 유지?
- **크레딧 정책**: 조직 컨텍스트에서 생성한 이미지의 크레딧 부담 주체 (v1.0 은 개인 부담 유지)
- **알림 채널**: 이메일 only vs 인앱 vs 둘 다 (v1.0 은 이메일 only 추천)
