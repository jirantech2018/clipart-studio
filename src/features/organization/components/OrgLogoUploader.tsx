'use client';

// 조직 로고 업로드 UI (P5-D-B).
// FormData 로 파일 업로드 → 서버가 R2 put + organizations.avatar_url 갱신.

import { Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useUploadOrgLogo } from '@/features/organization/hooks/useOrganizationReferenceImages';

export function OrgLogoUploader({
  slug,
  currentUrl,
}: {
  slug: string;
  currentUrl: string | null;
}) {
  const upload = useUploadOrgLogo(slug);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await upload.mutateAsync(file);
      toast.success('로고를 업데이트했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt="조직 로고" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            로고 없음
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
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
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3.5 w-3.5" />
          )}
          로고 이미지 업로드
        </Button>
        <p className="text-[11px] text-muted-foreground">PNG · JPG · WebP, 5MB 이하</p>
      </div>
    </div>
  );
}
