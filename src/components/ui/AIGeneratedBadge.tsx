// Design Ref: §7 Security — mandatory "AI 생성" label on all image details
// Plan SC: FR-18 AI generated label required
//
// 2026-08 UX 변경: 사용자 지시로 "AI 생성" 배지 노출을 전 페이지에서 중단.
// 컴포넌트는 유지하되 렌더 결과를 null 로 돌려, 15개+ 사용처의 레이아웃/import
// 를 건드리지 않고 한곳에서 on/off 를 관리한다. 다시 켜야 하면 아래 렌더만
// 되돌리면 된다.

export function AIGeneratedBadge(_props: { className?: string }): null {
  return null;
}
