// Design Ref: §3.3 image_categories + PRD D14 학교 컨텍스트 카테고리
// Fixed set of 12 school-context categories. Auto-tagger must pick 1 or 2 from this list.
// "기타" is the escape hatch for content not related to school life.

export const SCHOOL_CATEGORIES = [
  '학교생활',
  '교실/수업',
  '학습/학용품',
  '학교행사',
  '체육/운동',
  '예체능',
  '학교시설',
  '학생',
  '선생님',
  '계절/절기',
  '안전/보건',
  '기타',
] as const;

export type SchoolCategory = (typeof SCHOOL_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(SCHOOL_CATEGORIES);

export function isSchoolCategory(value: string): value is SchoolCategory {
  return CATEGORY_SET.has(value);
}

/** Filter an untrusted string[] down to at most `max` valid categories, preserving order. */
export function pickValidCategories(input: unknown, max = 2): SchoolCategory[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<SchoolCategory>();
  const out: SchoolCategory[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    if (!isSchoolCategory(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
