'use client';

// 조직 활동 로그 섹션 (P5-D-C).
// 최근 활동 상위 50개만 시간 역순으로 나열. owner/admin 만 API 및 RLS 를
// 통과할 수 있으며, 그 외 role 에서는 이 섹션을 렌더링하지 않는다.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useOrganizationActivityLogs,
  type ActivityLogEntry,
} from '@/features/organization/hooks/useOrganizations';

interface Props {
  slug: string;
  canView: boolean;
}

const ACTIVITY_LABELS: Record<string, string> = {
  organization_created: '조직 생성',
  organization_updated: '조직 정보 수정',
  member_invited: '멤버 초대',
  member_joined: '멤버 참여',
  member_removed: '멤버 강퇴',
  member_role_changed: '멤버 역할 변경',
  invite_revoked: '초대 취소',
  image_shared: '이미지 조직 공유',
  image_unshared: '이미지 조직 공유 해제',
  image_visibility_changed: '이미지 공개 범위 변경',
  community_published: '공유 라이브러리 게시',
  community_unpublished: '공유 라이브러리 회수',
};

function displayActor(entry: ActivityLogEntry): string {
  return entry.actorEmail ?? '(알 수 없음)';
}

function describe(entry: ActivityLogEntry): string {
  const label = ACTIVITY_LABELS[entry.activityType] ?? entry.activityType;
  const actor = displayActor(entry);
  const target = entry.targetEmail;
  const meta = entry.metadata ?? {};

  switch (entry.activityType) {
    case 'organization_created':
      return `${actor} 님이 조직을 만들었어요`;
    case 'organization_updated': {
      const fields = (meta.updated_fields as string[] | undefined) ?? [];
      const summary = fields.length > 0 ? ` (${fields.join(', ')})` : '';
      return `${actor} 님이 조직 정보를 수정했어요${summary}`;
    }
    case 'member_invited':
      return `${actor} 님이 ${(meta.email as string | undefined) ?? target ?? '누군가'} 를 초대했어요`;
    case 'member_joined':
      return `${target ?? actor} 님이 조직에 참여했어요`;
    case 'member_removed':
      return `${actor} 님이 ${target ?? '멤버'} 를 강퇴했어요`;
    case 'member_role_changed': {
      const from = meta.from as string | undefined;
      const to = meta.to as string | undefined;
      const change = from && to ? ` (${from} → ${to})` : '';
      return `${actor} 님이 ${target ?? '멤버'} 의 역할을 바꿨어요${change}`;
    }
    case 'invite_revoked':
      return `${actor} 님이 초대를 취소했어요`;
    case 'image_shared': {
      const count = (meta.count as number | undefined) ?? 1;
      return `${actor} 님이 이미지 ${count}개를 조직 라이브러리에 얹었어요`;
    }
    case 'image_unshared':
      return `${actor} 님이 이미지를 조직 라이브러리에서 내렸어요`;
    case 'community_published': {
      const count = (meta.count as number | undefined) ?? 1;
      return `${actor} 님이 이미지 ${count}개를 공유 라이브러리에 올렸어요`;
    }
    case 'community_unpublished':
      return `${actor} 님이 이미지를 공유 라이브러리에서 내렸어요`;
    case 'image_visibility_changed':
      return `${actor} 님이 이미지 공개 범위를 바꿨어요`;
    default:
      return `${actor} · ${label}`;
  }
}

function formatTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function OrganizationActivityLogSection({ slug, canView }: Props) {
  const { data, isLoading, error } = useOrganizationActivityLogs(slug, canView);

  if (!canView) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">활동 로그</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : '활동 로그를 불러오지 못했어요'}
          </p>
        ) : !data || data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 기록된 활동이 없어요.</p>
        ) : (
          <ul className="divide-y">
            {data.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 py-2.5 text-sm"
              >
                <span className="leading-relaxed">{describe(entry)}</span>
                <time
                  className="shrink-0 text-xs text-muted-foreground"
                  dateTime={entry.createdAt}
                  title={new Date(entry.createdAt).toLocaleString('ko-KR')}
                >
                  {formatTime(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
