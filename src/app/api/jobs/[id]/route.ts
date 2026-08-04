// Design Ref: §4.1 GET /api/jobs/:id — job status polling fallback
//
// Phase 3 — kind='package' 인 Job 은 응답에 slots 배열을 함께 내려준다.
// 클라이언트가 재진입 시 한 번의 요청으로 Job 상태 + 각 Slot 상태를 복원할
// 수 있게 한다. Single Job 응답은 raw shape 그대로 유지 (useJobStream 등이
// snake_case 를 직접 읽고 있어 하위호환 최우선).

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

interface PackageSlotResponse {
  id: string;
  order: number;
  categoryOrder: number;
  category: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled';
  aspectRatio: 'square' | 'landscape' | 'portrait';
  imageId: string | null;
  /** imageId 존재 시 서버가 조립한 공개 URL. status='done' 이 아니어도
   *  이미지가 저장된 순간부터 존재 가능. */
  thumbnailUrl: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return apiError('NOT_FOUND', '해당 Job을 찾을 수 없습니다');

  // kind='package' 인 경우에만 slots 배열을 추가로 조회. Single job 응답은
  // 필드 하나도 바꾸지 않는다 (하위호환).
  if ((data as { kind?: string }).kind === 'package') {
    const service = createSupabaseServiceClient();
    const { data: slotRows, error: slotErr } = await service
      .from('generation_job_slots')
      .select(
        'id, order, category_order, category, name, prompt_hint, aspect_ratio, status, image_id, error, started_at, completed_at',
      )
      .eq('job_id', params.id)
      .order('order', { ascending: true });

    if (slotErr) {
      console.error('[GET /api/jobs/:id] slot fetch failed', params.id, slotErr);
      // Slot 조회 실패해도 job 정보는 반환 — 재진입 UI 가 기본 복원은 할 수 있게.
      return apiOk({ ...data, slots: [] as PackageSlotResponse[] });
    }

    // slot → image_id 로 실제 저장된 이미지의 r2_key 를 batch 로 조회해
    // thumbnailUrl 을 조립. image_id 가 없는 slot 은 thumbnailUrl=null.
    const imageIds = (slotRows ?? [])
      .map((r) => (r as { image_id: string | null }).image_id)
      .filter((v): v is string => !!v);
    const r2KeyById = new Map<string, string>();
    if (imageIds.length > 0) {
      const { data: imgRows } = await service
        .from('images')
        .select('id, r2_key')
        .in('id', imageIds);
      for (const row of (imgRows ?? []) as { id: string; r2_key: string }[]) {
        r2KeyById.set(row.id, row.r2_key);
      }
    }

    const slots: PackageSlotResponse[] = (slotRows ?? []).map((row) => {
      const r = row as {
        id: string;
        order: number;
        category_order: number | null;
        category: string;
        name: string;
        aspect_ratio: 'square' | 'landscape' | 'portrait';
        status: PackageSlotResponse['status'];
        image_id: string | null;
        error: string | null;
        started_at: string | null;
        completed_at: string | null;
      };
      const r2Key = r.image_id ? r2KeyById.get(r.image_id) ?? null : null;
      return {
        id: r.id,
        order: r.order,
        // Migration 055 이전 legacy 값은 null 로 올 수 있음 → 0 fallback.
        categoryOrder: r.category_order ?? 0,
        category: r.category,
        name: r.name,
        status: r.status,
        aspectRatio: r.aspect_ratio,
        imageId: r.image_id,
        thumbnailUrl: r2Key ? publicUrl(r2Key) : null,
        error: r.error,
        startedAt: r.started_at,
        completedAt: r.completed_at,
      };
    });

    return apiOk({ ...data, slots });
  }

  return apiOk(data);
}
