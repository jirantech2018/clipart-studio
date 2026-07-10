'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SchoolProfileForm } from '@/features/profile/components/SchoolProfileForm';

import type { SchoolProfile } from '@/types/domain';

// snake_case DB row → domain shape
function fromDb(row: Record<string, unknown> | null): SchoolProfile | null {
  if (!row) return null;
  return {
    userId: row.user_id as string,
    schoolName: row.school_name as string,
    homepageUrl: (row.homepage_url as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    primaryColor: (row.primary_color as string) ?? null,
    mascotDesc: (row.mascot_desc as string) ?? null,
    mascotRefUrl: (row.mascot_ref_url as string) ?? null,
    buildingRefUrl: (row.building_ref_url as string) ?? null,
    styleDesc: (row.style_desc as string) ?? null,
    basePrompt: (row.base_prompt as string) ?? null,
    schoolLevel: (row.school_level as SchoolProfile['schoolLevel']) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function SchoolProfileSection({
  initialProfile,
}: {
  initialProfile: Record<string, unknown> | null;
}) {
  const [profile, setProfile] = useState<SchoolProfile | null>(fromDb(initialProfile));
  const [editing, setEditing] = useState(false);

  async function handleDelete() {
    if (!confirm('학교설정을 삭제하시겠습니까?')) return;
    const res = await fetch('/api/school-profile', { method: 'DELETE' });
    if (!res.ok) {
      toast.error('삭제 실패');
      return;
    }
    toast.success('삭제되었습니다');
    setProfile(null);
    setEditing(false);
  }

  if (!profile && !editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>학교설정</CardTitle>
          <CardDescription>
            학교 컨텍스트가 있으신가요? 등록하면 이미지 생성 시 학교 스타일을 자동 주입할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setEditing(true)}>학교설정 추가하기</Button>
        </CardContent>
      </Card>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <SchoolProfileForm
          initial={profile}
          onSaved={(saved) => {
            setProfile(saved);
            setEditing(false);
          }}
        />
        {profile && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            취소
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>{profile?.schoolName}</CardTitle>
          <CardDescription>
            {profile?.schoolLevel ?? ''} · 마지막 수정: {new Date(profile!.updatedAt).toLocaleDateString('ko-KR')}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            수정
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            삭제
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {profile?.basePrompt && <p>기본 프롬프트: {profile.basePrompt}</p>}
        {profile?.styleDesc && <p>스타일: {profile.styleDesc}</p>}
        {profile?.mascotDesc && <p>캐릭터: {profile.mascotDesc}</p>}
      </CardContent>
    </Card>
  );
}
