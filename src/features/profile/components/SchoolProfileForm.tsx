'use client';

// Design Ref: §5.4 School Profile Form checklist
// Plan SC: FR-03 School Profile registration (Optional)

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SCHOOL_LEVEL_LABELS } from '@/types/domain';
import { schoolProfileSchema } from '@/types/schemas';

import type { SchoolProfile } from '@/types/domain';
import type { SchoolProfileInput } from '@/types/schemas';

const SCHOOL_LEVELS: Array<SchoolProfile['schoolLevel']> = ['elementary', 'middle', 'high'];

function toFormValues(profile: SchoolProfile | null): SchoolProfileInput {
  return {
    schoolName: profile?.schoolName ?? '',
    homepageUrl: profile?.homepageUrl ?? '',
    logoUrl: profile?.logoUrl ?? null,
    primaryColor: profile?.primaryColor ?? null,
    mascotDesc: profile?.mascotDesc ?? '',
    mascotRefUrl: profile?.mascotRefUrl ?? null,
    buildingRefUrl: profile?.buildingRefUrl ?? null,
    styleDesc: profile?.styleDesc ?? '',
    basePrompt: profile?.basePrompt ?? '',
    schoolLevel: profile?.schoolLevel ?? null,
  };
}

export function SchoolProfileForm({
  initial,
  onSaved,
}: {
  initial: SchoolProfile | null;
  onSaved?: (profile: SchoolProfile) => void;
}) {
  const isEdit = !!initial;
  const form = useForm<SchoolProfileInput>({
    resolver: zodResolver(schoolProfileSchema),
    defaultValues: toFormValues(initial),
  });

  const { register, handleSubmit, watch, setValue, formState } = form;
  const currentLevel = watch('schoolLevel');

  async function onSubmit(values: SchoolProfileInput) {
    const res = await fetch('/api/school-profile', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      toast.error('저장 실패');
      return;
    }
    const { data } = (await res.json()) as { data: SchoolProfile };
    toast.success('학교설정을 저장했습니다');
    onSaved?.(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? '학교설정 수정' : '학교설정 등록'}</CardTitle>
        <CardDescription>
          입력한 정보는 이미지 생성 시 <span className="font-medium">🏫 학교 스타일 적용</span>{' '}
          토글을 켜면 자동으로 프롬프트에 병합됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="학교명 *" error={formState.errors.schoolName?.message}>
            <Input {...register('schoolName')} placeholder="OO초등학교" />
          </Field>

          <Field label="홈페이지 URL" error={formState.errors.homepageUrl?.message}>
            <Input {...register('homepageUrl')} placeholder="https://..." />
          </Field>

          <Field label="교급">
            <div className="grid grid-cols-3 gap-2">
              {SCHOOL_LEVELS.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={currentLevel === level ? 'default' : 'outline'}
                  onClick={() => setValue('schoolLevel', level, { shouldDirty: true })}
                >
                  {level ? SCHOOL_LEVEL_LABELS[level] : ''}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="기본 프롬프트">
            <Textarea
              {...register('basePrompt')}
              placeholder="school illustration, flat design, friendly"
              rows={3}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
