'use client';

// 홈 히어로 배너 이미지 관리 (관리자 전용). 여러 이미지를 등록해두면
// 홈 페이지 상단 배너 배경으로 랜덤 하나가 매 방문마다 표시된다.

import { Loader2, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useDeleteHomeHeroImage,
  useHomeHeroImages,
  useUploadHomeHeroImage,
} from '@/features/knowledge/hooks/useHomeHeroImages';

export function HomeHeroImagesManager() {
  const { data, isLoading } = useHomeHeroImages();
  const upload = useUploadHomeHeroImage();
  const del = useDeleteHomeHeroImage();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleDelete(id: string) {
    if (!confirm('이 이미지를 홈 배너 카탈로그에서 삭제할까요?')) return;
    try {
      await del.mutateAsync(id);
      toast.success('삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }

  const images = data?.images ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">홈 배너 배경 이미지</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            여러 장 등록하면 방문마다 랜덤 하나가 홈 상단 배너 배경으로 표시돼요.
          </p>
        </div>
        <div>
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
            등록된 배너 이미지가 없어요. 위 버튼으로 첫 이미지를 업로드해주세요.
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
                <button
                  type="button"
                  onClick={() => handleDelete(img.id)}
                  disabled={del.isPending}
                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-destructive opacity-0 backdrop-blur transition-opacity hover:bg-background focus:opacity-100 group-hover:opacity-100"
                  aria-label="삭제"
                  title="삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
    </Card>
  );
}
