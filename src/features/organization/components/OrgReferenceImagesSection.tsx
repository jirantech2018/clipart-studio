'use client';

// 조직 참조 이미지 슬롯 (P5-D-B).
// Owner: 업로드 + 삭제. 멤버: 조회만.

import { Loader2, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useDeleteOrgReferenceImage,
  useOrganizationReferenceImages,
  useUploadOrgReferenceImage,
} from '@/features/organization/hooks/useOrganizationReferenceImages';

const LIMIT = 5;

export function OrgReferenceImagesSection({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const { data, isLoading } = useOrganizationReferenceImages(slug);
  const upload = useUploadOrgReferenceImage(slug);
  const remove = useDeleteOrgReferenceImage(slug);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const items = data?.references ?? [];
  const remaining = Math.max(0, LIMIT - items.length);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await upload.mutateAsync(file);
      toast.success('참조 이미지를 추가했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 참조 이미지를 삭제할까요?')) return;
    try {
      await remove.mutateAsync(id);
      toast.success('삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">조직용 참조 이미지</CardTitle>
            <p className="text-xs text-muted-foreground">
              이 조직 컨텍스트에서 생성 시 자동으로 함께 참조돼요. 최대 {LIMIT}개.
            </p>
          </div>
          {canEdit && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={onPick}
                className="hidden"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploading || remaining === 0}
                title={remaining === 0 ? `최대 ${LIMIT}개까지만` : '이미지 추가'}
              >
                {uploading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                업로드 ({items.length}/{LIMIT})
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {canEdit ? '아직 등록된 참조 이미지가 없어요.' : '이 조직에 등록된 참조 이미지가 없어요.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((ref) => (
              <div
                key={ref.id}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.url}
                  alt={ref.filename ?? '조직 참조 이미지'}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDelete(ref.id)}
                    disabled={remove.isPending}
                    className="absolute right-1 top-1 rounded-md bg-background/90 p-1 text-destructive opacity-0 shadow-md transition-opacity hover:bg-destructive/10 group-hover:opacity-100 focus:opacity-100"
                    aria-label="삭제"
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
