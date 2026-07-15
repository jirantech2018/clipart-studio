'use client';

// Knowledge 상세 편집에서 사용할 이미지 관리 UI.
// - Positive / Negative 두 그룹으로 나눠서 그리드로 표시
// - 각 그룹에 드래그앤드롭 or 클릭으로 이미지 업로드
// - 이미지별: 대표 지정, caption/viewpoint 편집, 순서 편집, 삭제
// - Positive 10 / Negative 5 상한, 서버 트리거가 최종 검증

import { ImagePlus, Loader2, Star, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useDeleteKnowledgeImage,
  useUpdateKnowledgeImage,
  useUploadKnowledgeImage,
} from '@/features/knowledge/hooks/useKnowledge';
import { cn } from '@/lib/utils';
import {
  KNOWLEDGE_NEGATIVE_IMAGE_LIMIT,
  KNOWLEDGE_POSITIVE_IMAGE_LIMIT,
} from '@/types/domain';

import type { KnowledgeImage, ReferenceType } from '@/types/domain';

interface Props {
  knowledgeId: string;
  images: KnowledgeImage[];
}

export function KnowledgeImagesEditor({ knowledgeId, images }: Props) {
  const positives = images
    .filter((i) => i.referenceType === 'positive')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const negatives = images
    .filter((i) => i.referenceType === 'negative')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ImageGroup
        knowledgeId={knowledgeId}
        referenceType="positive"
        title="Positive (이렇게 그려야 함)"
        description="이미지 생성 시 실제 참고 자료로 API 에 전달됩니다. 대표 이미지가 첫 번째로 전달돼요."
        limit={KNOWLEDGE_POSITIVE_IMAGE_LIMIT}
        items={positives}
      />
      <ImageGroup
        knowledgeId={knowledgeId}
        referenceType="negative"
        title="Negative (이렇게 그리면 안 됨)"
        description="API 에 전달되지 않아요. 관리자 비교와 금지 조건 텍스트 작성용 참고 자료입니다."
        limit={KNOWLEDGE_NEGATIVE_IMAGE_LIMIT}
        items={negatives}
      />
    </div>
  );
}

interface GroupProps {
  knowledgeId: string;
  referenceType: ReferenceType;
  title: string;
  description: string;
  limit: number;
  items: KnowledgeImage[];
}

function ImageGroup({
  knowledgeId,
  referenceType,
  title,
  description,
  limit,
  items,
}: GroupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadKnowledgeImage();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const isFull = items.length >= limit;
  const uploadDisabled = isFull || upload.isPending;

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드 가능합니다');
      return;
    }
    try {
      await upload.mutateAsync({
        knowledgeId,
        file,
        referenceType,
        isPrimary: items.length === 0, // 첫 이미지는 자동 대표
        sortOrder: items.length,
      });
      toast.success('이미지를 추가했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    }
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleFile(file);
  }

  function onDragEnter(e: React.DragEvent) {
    if (uploadDisabled) return;
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) setIsDragging(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (uploadDisabled) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    if (uploadDisabled) {
      toast.error(
        isFull
          ? `이 그룹은 최대 ${limit}장까지 등록 가능합니다`
          : '업로드 중입니다',
      );
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await handleFile(file);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            {items.length} / {limit}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'relative rounded-md border-2 border-dashed p-2 transition-colors',
            isDragging
              ? 'border-primary bg-primary/10'
              : 'border-transparent bg-transparent',
          )}
        >
          {items.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploadDisabled}
              className={cn(
                'flex h-32 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors',
                !uploadDisabled &&
                  'hover:border-primary hover:bg-primary/5 hover:text-primary',
                uploadDisabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {upload.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-xs">이미지 추가 (드래그 or 클릭)</span>
                </>
              )}
            </button>
          ) : (
            <div className="space-y-2">
              {items.map((img) => (
                <ImageRow key={img.id} knowledgeId={knowledgeId} image={img} />
              ))}
              {!isFull && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploadDisabled}
                  className={cn(
                    'flex h-10 w-full items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground transition-colors',
                    !uploadDisabled &&
                      'hover:border-primary hover:bg-primary/5 hover:text-primary',
                    uploadDisabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {upload.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="h-3 w-3" />
                      이미지 더 추가 ({items.length}/{limit})
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {isDragging && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-primary/10 text-primary">
              <ImagePlus className="h-8 w-8" />
              <p className="text-sm font-medium">여기에 놓으면 등록돼요</p>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
          onChange={handlePick}
          className="hidden"
        />
      </CardContent>
    </Card>
  );
}

interface RowProps {
  knowledgeId: string;
  image: KnowledgeImage;
}

function ImageRow({ knowledgeId, image }: RowProps) {
  const update = useUpdateKnowledgeImage();
  const remove = useDeleteKnowledgeImage();
  const [caption, setCaption] = useState(image.caption);
  const [viewpoint, setViewpoint] = useState(image.viewpoint);
  const [saving, setSaving] = useState(false);
  const busy = update.isPending || remove.isPending || saving;

  const captionDirty = caption !== image.caption;
  const viewpointDirty = viewpoint !== image.viewpoint;
  const dirty = captionDirty || viewpointDirty;

  async function saveMeta() {
    if (!dirty) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        knowledgeId,
        imageId: image.id,
        patch: {
          ...(captionDirty && { caption }),
          ...(viewpointDirty && { viewpoint }),
        },
      });
      toast.success('저장했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function togglePrimary() {
    if (image.isPrimary) return; // 대표는 다른 이미지를 대표로 지정해서 해제
    try {
      await update.mutateAsync({
        knowledgeId,
        imageId: image.id,
        patch: { isPrimary: true },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '대표 지정 실패');
    }
  }

  async function handleDelete() {
    if (!window.confirm('이 이미지를 삭제할까요?')) return;
    try {
      await remove.mutateAsync({ knowledgeId, imageId: image.id });
      toast.success('삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }

  return (
    <div className="flex gap-3 rounded-md border bg-muted/20 p-2">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.filename ?? '참고 이미지'}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {image.isPrimary && (
          <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            <Star className="h-2.5 w-2.5 fill-current" />
            대표
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div>
          <Label htmlFor={`cap-${image.id}`} className="text-[11px]">
            설명 (caption)
          </Label>
          <Input
            id={`cap-${image.id}`}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveMeta}
            placeholder="이 이미지에서 AI가 봐야 하는 것"
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label htmlFor={`vw-${image.id}`} className="text-[11px]">
            뷰포인트
          </Label>
          <Input
            id={`vw-${image.id}`}
            value={viewpoint}
            onChange={(e) => setViewpoint(e.target.value)}
            onBlur={saveMeta}
            placeholder="정면 / 측면 / 근접 / 사용 장면 등"
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col justify-between gap-1">
        <button
          type="button"
          onClick={togglePrimary}
          disabled={busy || image.isPrimary}
          title={image.isPrimary ? '이미 대표 이미지' : '대표 이미지로 지정'}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
            image.isPrimary
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:bg-accent',
            busy && 'cursor-not-allowed opacity-50',
          )}
        >
          <Star className={cn('h-3 w-3', image.isPrimary && 'fill-current')} />
          대표
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          title="이미지 삭제"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md border border-destructive/30 bg-background px-2 text-[11px] text-destructive transition-colors',
            'hover:bg-destructive/10',
            busy && 'cursor-not-allowed opacity-50',
          )}
        >
          {remove.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          삭제
        </button>
      </div>
    </div>
  );
}
