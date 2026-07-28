'use client';

// 홈 히어로 배너 이미지 관리 (관리자 전용).
//   • "공유 라이브러리에서 선택" — is_on_community=TRUE 이미지 중 큐레이션.
//     이번 단계의 기본 흐름. Hero = 대표 작품 개념.
//   • "이미지 업로드" — 임의 파일 업로드 (호환성 유지). 향후 마케팅 배너 등
//     생성 이미지가 아닌 자료에 사용.

import { CheckCircle2, ImagePlus, Loader2, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useCommunity } from '@/features/community/hooks/useCommunity';
import {
  useCurateHomeHeroImage,
  useDeleteHomeHeroImage,
  useHomeHeroImages,
  useUploadHomeHeroImage,
} from '@/features/knowledge/hooks/useHomeHeroImages';
import { cn } from '@/lib/utils';

export function HomeHeroImagesManager() {
  const { data, isLoading } = useHomeHeroImages();
  const upload = useUploadHomeHeroImage();
  const del = useDeleteHomeHeroImage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    for (const file of files) {
      try {
        await upload.mutateAsync(file);
      } catch (err) {
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : '업로드 실패'}`,
        );
      }
    }
    toast.success(`${files.length}개 이미지 업로드 완료`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleRelease(id: string) {
    if (!confirm('이 이미지의 홈 배너 설정을 해제할까요? 원본 이미지는 라이브러리에 그대로 남아요.')) {
      return;
    }
    try {
      await del.mutateAsync(id);
      toast.success('홈 배너에서 해제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패');
    }
  }

  const images = data?.images ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">홈 배너 배경 이미지</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            공유 라이브러리에서 대표 작품을 선정하거나 배경 이미지를 업로드해
            홈 히어로에 노출합니다. 방문마다 랜덤 하나가 표시돼요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={() => setPickerOpen(true)}
          >
            <ImagePlus className="mr-1 h-3.5 w-3.5" />
            공유 라이브러리에서 선택
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={upload.isPending}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3.5 w-3.5" />
            )}
            이미지 업로드
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-video animate-pulse rounded-md bg-muted"
              />
            ))}
          </div>
        ) : images.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            등록된 배너 이미지가 없어요. 위 두 버튼 중 하나로 첫 이미지를
            등록해주세요.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative overflow-hidden rounded-md border bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.filename ?? '홈 배너 이미지'}
                  className="aspect-video w-full object-cover"
                />
                {img.sourceImageId && (
                  <span
                    className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-md bg-primary/90 px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground"
                    title="공유 라이브러리에서 큐레이션된 배너"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    큐레이션
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRelease(img.id)}
                  disabled={del.isPending}
                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-destructive opacity-0 backdrop-blur transition-opacity hover:bg-background focus:opacity-100 group-hover:opacity-100"
                  aria-label="홈 배너에서 해제"
                  title="홈 배너에서 해제 (원본 이미지는 유지)"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
                {img.filename && (
                  <div className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-2 py-1 text-sm text-muted-foreground backdrop-blur">
                    {img.filename}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CommunityImagePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        alreadyCuratedIds={new Set(
          images
            .filter((i) => i.sourceImageId)
            .map((i) => i.sourceImageId as string),
        )}
      />
    </Card>
  );
}

interface CommunityImagePickerProps {
  open: boolean;
  onClose: () => void;
  alreadyCuratedIds: Set<string>;
}

function CommunityImagePicker({
  open,
  onClose,
  alreadyCuratedIds,
}: CommunityImagePickerProps) {
  const { data, isLoading } = useCommunity(null, 'newest');
  const curate = useCurateHomeHeroImage();

  const images = data?.pages.flatMap((p) => p.images) ?? [];

  async function handleSelect(id: string) {
    try {
      await curate.mutateAsync(id);
      toast.success('배너로 등록했어요');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '등록 실패');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} dismissable className="max-w-4xl">
      <DialogHeader
        title="공유 라이브러리에서 대표 작품 선정"
        description="공유 라이브러리에 공개된 이미지 중 하나를 선택하면 홈 히어로 배너로 노출됩니다."
      />
      <DialogBody>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            공유 라이브러리에 공개된 이미지가 아직 없어요.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((img) => {
              const already = alreadyCuratedIds.has(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => !already && handleSelect(img.id)}
                  disabled={already || curate.isPending}
                  className={cn(
                    'group relative overflow-hidden rounded-md border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    already
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:border-primary',
                  )}
                  title={already ? '이미 배너에 등록됨' : img.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnailUrl}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  {already && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <span className="rounded-md bg-primary/90 px-2 py-1 text-xs font-medium text-primary-foreground">
                        이미 등록됨
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          닫기
        </button>
      </DialogFooter>
    </Dialog>
  );
}
