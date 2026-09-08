// 한글 음절 → 초성·중성·종성 분해 유틸.
//
// M2-1.2 사용자 지시 (2026-09-08):
//   한글 자음·모음 유형 객관식에서 "목표 자모가 포함된 선택지가 정확히 1개인지"
//   코드로 검증하기 위한 도구. AI 프롬프트에만 의존하지 말고 서버가 hard-check.

/** 초성 19개 (음절 유니코드 순서 기준). */
export const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 중성 21개. */
export const JUNGSUNG_LIST = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

/** 종성 28개 (0 = 종성 없음). */
export const JONGSUNG_LIST = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_END = 0xd7a3; // '힣'

export interface JamoDecomposition {
  chosung: string;
  jungsung: string;
  jongsung: string; // 종성 없으면 ''
}

/** 한글 음절 한 글자를 초·중·종성으로 분해. 한글 음절 아니면 null. */
export function decomposeHangulSyllable(char: string): JamoDecomposition | null {
  if (!char || char.length === 0) return null;
  const code = char.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return null;
  const offset = code - HANGUL_BASE;
  const chosungIdx = Math.floor(offset / (21 * 28));
  const jungsungIdx = Math.floor((offset % (21 * 28)) / 28);
  const jongsungIdx = offset % 28;
  return {
    chosung: CHOSUNG_LIST[chosungIdx] ?? '',
    jungsung: JUNGSUNG_LIST[jungsungIdx] ?? '',
    jongsung: JONGSUNG_LIST[jongsungIdx] ?? '',
  };
}

/**
 * 대상 문자열 내에 특정 자모가 포함되었는지 확인.
 *   - target 이 초성/종성 자음 (ㄱ~ㅎ 계열) → 문자열의 각 음절의 초성 또는 종성에 매치
 *   - target 이 중성 모음 (ㅏ~ㅣ) → 각 음절의 중성에 매치
 *   - 겹자모 (예: ㄳ, ㅄ) 는 그대로 존재 여부 매치
 */
export function stringContainsJamo(text: string, target: string): boolean {
  const isVowel = (JUNGSUNG_LIST as readonly string[]).includes(target);
  for (const ch of text) {
    const decomp = decomposeHangulSyllable(ch);
    if (!decomp) continue;
    if (isVowel) {
      if (decomp.jungsung === target) return true;
    } else {
      if (decomp.chosung === target || decomp.jongsung === target) return true;
    }
  }
  return false;
}

const JAMO_TOKEN_REGEX = /[ㄱ-ㅎㅏ-ㅣ]/g;

/**
 * 문항 stem 에서 목표 자모 (첫 번째 자모 홑문자) 추출.
 * "'ㅏ'가 있는 글자는?" → 'ㅏ'
 * "모음 ㅜ가 들어간 글자를 고르세요." → 'ㅜ'
 * 자모가 없으면 null (자모 유형 문제 아님).
 */
export function extractTargetJamoFromStem(stem: string): string | null {
  const matches = stem.match(JAMO_TOKEN_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[0];
}

/**
 * 자모 유형 문항의 정합성 검증.
 * choices 중 목표 자모를 포함하는 선택지 인덱스 목록 반환.
 * 정확히 1개면 유효, 0개면 정답 부재, 2개 이상이면 정답 다수 (오류).
 */
export function findChoicesContainingJamo(
  choices: string[],
  targetJamo: string,
): number[] {
  const matched: number[] = [];
  choices.forEach((c, i) => {
    if (stringContainsJamo(c, targetJamo)) matched.push(i);
  });
  return matched;
}
