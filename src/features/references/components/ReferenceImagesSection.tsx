'use client';

// 참조 이미지 슬롯 관리 UI — Settings 페이지에 마운트된다.
// - 그리드 영역 어디에나 파일을 드래그 앤 드롭해 업로드
// - 모든 빈 슬롯이 클릭 가능 (파일 선택 다이얼로그)
// - 5개 꽉 차면 업로드 비활성화

import { ImagePlus, Loader2, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  useDeleteReferenceImage,
  useReferenceImages,
  useUploadReferenceImage,
} from '@/features/references/hooks/useReferenceImages';

import type { ReferenceImageSlot } from '@/types/domain';

const SLOT_COUNT = 5;
const ACCEPTED_EXT = /\.(png|jpe?g|webp|avif|heic|heif)$/i;

export function ReferenceImagesSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const { data, isLoading, isError, refetch } = useReferenceImages();
  const upload = useUploadReferenceImage();
  const remove = useDeleteReferenceImage();

  const slots = data?.slots ?? [];
  const isFull = slots.length >= SLOT_COUNT;
  const uploadDisabled = isFull || upload.isPending;

  const emptyCells = Array.from({ length: Math.max(0, SLOT_COUNT - slots.length) });

  function openPicker() {
    if (uploadDisabled) return;
    inputRef.current?.click();
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/') && !ACCEPTED_EXT.test(file.name)) {
      toast.error('이미지 파일만 업로드할 수 있어요');
      return;
    }
    try {
      await upload.mutateAsync(file);
      toast.success('참조 이미지를 저장했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleFile(file);
  }

  async function onDelete(slot: ReferenceImageSlot) {
    setPendingDeleteId(slot.id);
    try {
      await remove.mutateAsync(slot.id);
      toast.success('참조 이미지를 삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    } finally {
      setPendingDeleteId(null);
    }
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
          ? '슬롯이 가득 찼어요. 하나를 삭제한 뒤 시도해주세요'
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
        <CardTitle>참조 이미지 슬롯</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          이미지 생성 시 첨부해서 사용할 참조 이미지를 미리 저장해두세요. 계정당 최대{' '}
          <span className="font-semibold">{SLOT_COUNT}개</span>까지 보관할 수 있어요. 아래
          영역으로 파일을 <span className="font-semibold">드래그</span>하거나 빈 슬롯을{' '}
          <span className="font-semibold">클릭</span>해 추가할 수 있어요.
        </p>
        <p className="text-xs text-muted-foreground">
          되도록 4MB 이하를 넣어주세요, 초과 시 리사이즈 됩니다. (JPG → PNG, 초과 시 리사이즈)
        </p>

        {isError ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            <p>참조 이미지를 불러오지 못했어요.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              'relative rounded-lg border-2 border-dashed p-3 transition-colors',
              isDragging
                ? 'border-primary bg-primary/10'
                : 'border-transparent bg-transparent',
            )}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {isLoading
                ? Array.from({ length: SLOT_COUNT }).map((_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      className="aspect-square animate-pulse rounded-md bg-muted"
                      aria-hidden="true"
                    />
                  ))
                : slots.map((slot) => {
                    const deleting = pendingDeleteId === slot.id;
                    return (
                      <div
                        key={slot.id}
                        className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={slot.url}
                          alt={slot.filename ?? '참조 이미지'}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => onDelete(slot)}
                          disabled={deleting}
                          aria-label="참조 이미지 삭제"
                          className={cn(
                            'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-md transition-opacity',
                            'opacity-0 focus:opacity-100 group-hover:opacity-100',
                            deleting && 'opacity-100',
                          )}
                        >
                          {deleting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    );
                  })}

              {!isLoading &&
                emptyCells.map((_, i) => (
                  <button
                    key={`empty-${i}`}
                    type="button"
                    onClick={openPicker}
                    disabled={uploadDisabled}
                    aria-label="참조 이미지 추가"
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors',
                      !uploadDisabled &&
                        'hover:border-primary hover:bg-primary/5 hover:text-primary',
                      uploadDisabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {upload.isPending && i === 0 ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Plus className="h-5 w-5" />
                        <span className="text-[11px]">이미지 추가</span>
                      </>
                    )}
                  </button>
                ))}
            </div>

            {isDragging && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-primary/10 text-primary">
                <ImagePlus className="h-8 w-8" />
                <p className="text-sm font-medium">여기에 놓으면 슬롯에 저장돼요</p>
              </div>
            )}
          </div>
        )}

        {isFull && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            슬롯이 가득 찼어요. 새로 저장하려면 기존 이미지를 하나 삭제해주세요.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
          onChange={onPickFile}
          className="hidden"
        />
      </CardContent>
    </Card>
  );
}
