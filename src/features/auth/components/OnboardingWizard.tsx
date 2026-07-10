'use client';

// Design Ref: §5.4 Onboarding Wizard checklist
// Plan SC: FR-03 (Optional School Profile branch) + account_type selection

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SchoolProfileForm } from '@/features/profile/components/SchoolProfileForm';
import { cn } from '@/lib/utils';
import { ACCOUNT_TYPE_LABELS } from '@/types/domain';

import type { AccountType } from '@/types/domain';

function BackButton({ onClick, label = '이전' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

const ACCOUNT_ORDER: AccountType[] = ['teacher', 'student', 'school', 'school_staff', 'general'];
const DESCRIPTIONS: Record<AccountType, string> = {
  teacher: '수업 자료·통신문·학급 활동 자료를 만듭니다',
  student: '발표 자료·수행평가·동아리 활동에 활용합니다',
  school: '행정 명의의 공식 자산을 관리합니다',
  school_staff: '학부모회·교육청·학원 등 학교 주변에서 활동합니다',
  general: '학교 컨텍스트 없이 클립아트가 필요합니다',
};

type Step = 'account' | 'ask-school' | 'school-form' | 'done';

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('account');
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveAccountType(next: Step) {
    if (!accountType) return;
    setSaving(true);
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountType }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('계정 유형 저장 실패');
      return;
    }
    setStep(next);
  }

  if (step === 'account') {
    return (
      <div className="space-y-3">
        <BackButton onClick={() => router.push('/')} label="홈으로" />
        <Card>
          <CardHeader>
            <CardTitle>당신은 어떤 사용자인가요?</CardTitle>
            <CardDescription>선택은 언제든 프로필에서 변경할 수 있습니다</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ACCOUNT_ORDER.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAccountType(type)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent',
                  accountType === type && 'border-primary bg-accent',
                )}
              >
                <div className="flex-1">
                  <p className="font-medium">{ACCOUNT_TYPE_LABELS[type]}</p>
                  <p className="text-sm text-muted-foreground">{DESCRIPTIONS[type]}</p>
                </div>
              </button>
            ))}
            <Button
              className="w-full"
              disabled={!accountType || saving}
              onClick={() => saveAccountType('ask-school')}
            >
              다음
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'ask-school') {
    return (
      <div className="space-y-3">
        <BackButton onClick={() => setStep('account')} />
        <Card>
          <CardHeader>
            <CardTitle>학교 컨텍스트가 있으신가요?</CardTitle>
            <CardDescription>
              학교 스타일을 프롬프트에 자동 주입하는 기능을 사용할지 결정합니다.
              나중에 추가할 수도 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => router.push('/')}>
              나중에 설정
            </Button>
            <Button onClick={() => setStep('school-form')}>지금 등록</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'school-form') {
    return (
      <div className="space-y-3">
        <BackButton onClick={() => setStep('ask-school')} />
        <SchoolProfileForm
          initial={null}
          onSaved={() => {
            toast.success('학교설정이 등록되었습니다');
            router.push('/');
          }}
        />
      </div>
    );
  }

  return null;
}
