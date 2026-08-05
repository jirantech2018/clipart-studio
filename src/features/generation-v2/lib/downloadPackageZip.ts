// Package completed 화면의 "전체 다운로드" CTA 진입점.
//
// 기존 features/library 의 downloadImagesAsZip 을 그대로 재사용하되,
// Package UI 는 CompletedImage 배열을 다루므로 얇게 감싼다.
//
// 향후 Category 별 다운로드가 추가될 때 filter 만 넘겨 재사용할 수 있도록
// 두 번째 인자를 optional filter 함수로 열어둔다. 필터 통과 && 유효한
// imageId·thumbnailUrl 을 가진 이미지만 서버로 요청.

import { downloadImagesAsZip } from '@/features/library/hooks/useMyImages';

import type { CompletedImage } from '@/lib/store/conversationStore';

export async function downloadPackageZip(
  images: CompletedImage[],
  filter?: (image: CompletedImage) => boolean,
): Promise<void> {
  const eligible = images.filter((img) => {
    // 성공한 이미지만 ZIP 대상. thumbnailUrl 이 없는 경우 서버 조회 실패
    // 흔적 → 제외 (사용자 지시 §ZIP: 실패·취소·URL 없음 제외).
    if (!img.imageId) return false;
    if (!img.thumbnailUrl) return false;
    if (filter && !filter(img)) return false;
    return true;
  });

  if (eligible.length === 0) {
    throw new Error('다운로드할 이미지가 없어요');
  }

  await downloadImagesAsZip(
    eligible.map((img) => img.imageId),
    'library',
  );
}
