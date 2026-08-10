'use client';

// Admin 정책 카드 — 신규 가입 초기 크레딧을 웹에서 수정.
//
// 저장 시 handle_new_user() 트리거가 app_settings 를 실시간 조회하므로 다음
// signup 부터 즉시 반영. 기존 유저 잔액은 영향받지 않음.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useAppSettings,
  useUpdateAppSettings,
} from '@/features/admin/hooks/useAppSettings';

export function SignupCreditsSetting() {
  const { data, isLoading, isError, refetch } = useAppSettings();
  const update = useUpdateAppSettings();
  const current = data?.settings.initialSignupCredits ?? null;

  const [value, setValue] = useState<string>('');
  useEffect(() => {
    if (current != null) setValue(String(current));
  }, [current]);

  const parsed = Number(value);
  const isValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000;
  const dirty = current != null && parsed !== current;

  async function handleSave() {
    if (!isValid) {
      toast.error('0 이상의 정수여야 해요');
      return;
    }
    if (!dirty) return;
    try {
      const next = await update.mutateAsync({ initialSignupCredits: parsed });
      toast.success(`신규 가입 크레딧을 ${next.initialSignupCredits.toLocaleString('ko-KR')} 로 저장했어요`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">신규 가입 초기 크레딧</h3>
        <span className="text-xs text-muted-foreground">
          다음 signup 부터 즉시 반영 · 기존 유저 잔액 영향 없음
        </span>
      </div>
      {isLoading ? (
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          설정을 불러오지 못했어요.
          <button
            type="button"
            onClick={() => refetch()}
            className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-32 rounded-md border border-input bg-background px-3 text-right text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring"
            disabled={update.isPending}
          />
          <span className="text-xs text-muted-foreground">크레딧</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || !isValid || update.isPending}
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {update.isPending ? '저장 중…' : '저장'}
          </button>
          {current != null && (
            <span className="ml-1 text-xs text-muted-foreground">
              현재 <span className="tabular-nums font-medium text-foreground">{current}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
