'use client';

// Design intent: pure gallery card. Metadata (prompt/categories/tags) lives on
// the detail page. Action buttons appear on hover so the grid stays clean.
//
// P5-C Phase B: 커뮤니티(공유 라이브러리) 승격 UI 제거. 이 카드에서는 공개
// 액션이 사라지고, 소유자가 커뮤니티에 올리려면 이미지 상세 → "조직에 공유"
// → 조직 라이브러리에서 조직 owner 가 승격하는 흐름을 따른다.

import { Download, Loader2, RotateCcw, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  downloadImageFile,
  useRestoreImage,
  useTrashImage,
} from '@/features/library/hooks/useMyImages';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';
import { cn } from '@/lib/utils';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

// 공유 조직 라벨 포맷: 1곳이면 조직명, 여러 곳이면 "지란초 외 N".
// title (툴팁) 에는 전체 목록을 넣어 그리드에서 마우스 오버로 확인 가능.
function formatSharedOrgsLabel(orgs: { name: string }[]): string {
  const first = orgs[0];
  if (!first) return '';
  if (orgs.length === 1) return first.name;
  return `${first.name} 외 ${orgs.length - 1}`;
}

const ACTOR_LABEL: Record<'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN', string> = {
  USER: '내가',
  ORG_ADMIN: '조직 관리자가',
  SUPER_ADMIN: '이용 관리자가',
};

export function LibraryCard({
  image,
  trashMode = false,
}: {
  image: LibraryImage;
  trashMode?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const selection = useMultiSelection('library');
  const selected = selection.isSelected(image.id);
  const trash = useTrashImage();
  const restore = useRestoreImage();

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadImageFile(image.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
    }
  }

  async function handleTrash(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        '이 이미지를 휴지통으로 이동할까요?\n이미지는 삭제되지 않으며 언제든 다시 복원할 수 있습니다.',
      )
    )
      return;
    try {
      await trash.mutateAsync({ id: image.id });
      toast.success('휴지통으로 이동했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '휴지통 이동 실패');
    }
  }

  async function handleRestore(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await restore.mutateAsync(image.id);
      toast.success('복원했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복원 실패');
    }
  }

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow',
        selected && 'ring-2 ring-primary ring-offset-2',
      )}
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
    >
      <Link
        href={trashMode ? '#' : `/image/${image.id}`}
        onClick={(e) => {
          // 휴지통 이미지의 상세 페이지는 열지 않는다 — 카드 상 액션 (복원)
          // 만 노출한다. 서버 detail API 도 TRASHED 는 404 로 응답.
          if (trashMode) e.preventDefault();
        }}
        className={cn(
          'block h-full w-full',
          trashMode && 'cursor-default',
        )}
        title={trashMode ? '휴지통 이미지는 상세를 열 수 없어요' : image.prompt}
        aria-label={image.prompt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className={cn(
            'h-full w-full object-cover transition-transform',
            // 휴지통 이동 주체에 따라 시각 강도 차등:
            //   SUPER_ADMIN (이용 관리자) — 강한 blur/어두움. 정책적 제거.
            //   USER / ORG_ADMIN (본인·조직) — 약한 blur/어두움. 되돌리기 쉬움.
            trashMode
              ? image.trashActorType === 'SUPER_ADMIN'
                ? 'blur-md scale-110'
                : 'blur-[2px] scale-[1.04]'
              : 'group-hover:scale-[1.02]',
          )}
          loading="lazy"
        />
      </Link>

      {/* 휴지통 이미지 위의 반투명 검은 단일 레이어. 이동 주체에 따라 농도 차등. */}
      {trashMode && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0',
            image.trashActorType === 'SUPER_ADMIN' ? 'bg-black/65' : 'bg-black/30',
          )}
        />
      )}

      {/* 좌상단 선택 체크박스: 미선택 시 hover/focus 로만 표시, 선택 시 항상 표시. */}
      <div
        className={cn(
          'absolute left-2 top-2 transition-opacity',
          selected
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <SelectionCheckbox
          checked={selected}
          onCheckedChange={() => selection.toggle(image.id)}
          ariaLabel={selected ? '선택 해제' : '선택'}
        />
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
        <AIGeneratedBadge />
        {image.sharedOrgs && image.sharedOrgs.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-sm font-medium text-primary-foreground shadow-sm"
            title={image.sharedOrgs.map((o) => o.name).join(', ')}
          >
            <Users className="h-3 w-3" aria-hidden="true" />
            {formatSharedOrgsLabel(image.sharedOrgs)}
          </span>
        )}
      </div>

      {/* Trash 뷰: 이미지 상단에 반투명 오버레이로 처리 주체·사유 표기 */}
      {trashMode && image.trashActorType && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-[11px] text-white">
          <div className="font-medium">
            {ACTOR_LABEL[image.trashActorType]} 휴지통으로 이동
          </div>
          {image.trashReason && (
            <div className="line-clamp-1 opacity-90">{image.trashReason}</div>
          )}
        </div>
      )}

      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {trashMode ? (
          image.trashActorType === 'SUPER_ADMIN' ? (
            // 정책: 이용 관리자가 이동한 이미지는 조직/유저가 복원할 수 없다.
            // 버튼 자리를 disabled + 안내로 대체해 오작동을 예방.
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled
              className="h-8 px-2 shadow-md"
              title="이용 관리자가 이동한 이미지는 관리자만 복원할 수 있어요"
              aria-label="이용 관리자가 이동한 이미지는 관리자만 복원할 수 있어요"
            >
              관리자 복원 필요
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRestore}
              disabled={restore.isPending}
              className="h-8 px-2 shadow-md"
            >
              {restore.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="mr-1 h-3 w-3" />
              )}
              복원
            </Button>
          )
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleDownload}
              disabled={downloading}
              className="h-8 px-2 shadow-md"
            >
              {downloading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-1 h-3 w-3" />
              )}
              다운로드
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleTrash}
              disabled={trash.isPending}
              className="h-8 px-2 shadow-md"
              aria-label="휴지통으로 이동"
              title="휴지통으로 이동"
            >
              {trash.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
