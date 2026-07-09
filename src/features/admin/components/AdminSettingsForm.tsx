'use client';

// Admin panel — edit the global system prompt applied to every generation.
// Server-side ADMIN_EMAIL gate guards both the page and the API.

import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface AdminSettingsFormProps {
  initialPrompt: string;
  initialUpdatedAt: string | null;
}

export function AdminSettingsForm({
  initialPrompt,
  initialUpdatedAt,
}: AdminSettingsFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: prompt }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '저장 실패');
      }
      setUpdatedAt(new Date().toISOString());
      toast.success('시스템 프롬프트를 저장했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
          시스템 프롬프트 (모든 생성에 자동 적용)
        </CardTitle>
        <CardDescription>
          아래 텍스트가 사용자의 프롬프트 앞에 자동으로 병합되어 이미지 생성에 사용됩니다.
          한국 특정 스타일, 태극기, 한국식 학교 인테리어 등을 지시할 때 사용하세요.
          <br />
          사용자가 [이 이미지로 생성 (i2i)]으로 chaining하는 경우에도 이 프롬프트는 함께 적용됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={12}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 항상 한국인 얼굴/체형으로 그리고..."
          className="font-mono text-sm"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{prompt.length.toLocaleString()}자</span>
          {updatedAt && (
            <span>마지막 저장: {new Date(updatedAt).toLocaleString('ko-KR')}</span>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="min-w-[8rem]">
            {saving ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                저장 중…
              </>
            ) : (
              '저장'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
