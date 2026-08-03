// 다양성 생성 slotPrompts 배열 길이를 batchSize 에 맞춰 정합하는 유틸.
//
// 규칙 (지시 §3 + 기존 GenerationForm 동작):
//   - 늘어난 경우 : 기존 값 보존 + 뒤에 빈 문자열 채움
//   - 줄어든 경우 : 앞쪽 값 보존 + 초과 항목 제거
//   - 동일 길이 : 새 배열로 clone 후 반환 (얕은 복사 보장)
//   - 순서 변경 없음
//
// /generate 와 /generate-v2 두 곳에서 재사용한다.

export function resizeSlotPrompts(
  prev: readonly string[],
  batchSize: number,
): string[] {
  const target = Math.max(0, Math.floor(batchSize));
  if (prev.length === target) return [...prev];
  if (prev.length < target) {
    return [
      ...prev,
      ...Array.from({ length: target - prev.length }, () => ''),
    ];
  }
  return prev.slice(0, target);
}
