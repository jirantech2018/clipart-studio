// generate 페이지 상단 헤더 — 순수 텍스트 h1. '새로고침' 버튼은 제거됐고,
// '생성 취소' 기능은 GenerationForm 의 submit 버튼 자리에서 상태 교체 형태로
// 노출된다 (스트리밍 중에만).

export function GenerateHeader() {
  return (
    <h1 className="text-2xl font-semibold tracking-tight">+클립아트 만들기</h1>
  );
}
