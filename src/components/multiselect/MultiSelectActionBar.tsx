'use client';

// 다중 선택된 항목에 대한 액션을 하단 sticky pill 로 노출.
//
// 페이지별 액션 (ZIP 다운로드 / 조직에 공유 / Community 공개 등) 은 컴포넌트에
// 하드코딩하지 않고 외부에서 `actions` prop 으로 주입한다. 이렇게 해야 나중에
// organization/collection scope 가 추가되어도 이 컴포넌트를 그대로 재사용 가능.
//
// "선택 해제" 는 어느 scope 든 공통이라 컴포넌트 자체가 제공.

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface MultiSelectAction {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'ghost';
  disabled?: boolean;
  isPending?: boolean;
  onClick: (selectedIds: string[]) => Promise<void> | void;
}

interface Props {
  count: number;
  selectedIds: string[];
  actions: MultiSelectAction[];
  onClear: () => void;
}

export function MultiSelectActionBar({ count, selectedIds, actions, onClear }: Props) {
  if (count === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 w-full max-w-[calc(100vw-2rem)] -translate-x-1/2 px-2"
      role="region"
      aria-label="선택 액션"
    >
      <div className="pointer-events-auto mx-auto flex flex-wrap items-center justify-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-2xl backdrop-blur sm:max-w-fit">
        <span className="pl-2 pr-1 text-sm font-medium tabular-nums text-foreground">
          {count}개 선택됨
        </span>
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            size="sm"
            variant={action.variant ?? 'default'}
            disabled={action.disabled || action.isPending}
            onClick={() => action.onClick(selectedIds)}
            className={cn(action.isPending && 'cursor-progress')}
          >
            {action.icon ? <action.icon className="mr-1 h-3.5 w-3.5" /> : null}
            {action.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClear}
          aria-label="선택 해제"
          title="선택 해제"
          className="px-2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
