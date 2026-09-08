// GET /api/learning/documents/[id]/render?format=pdf&variant=student
//
// M1 은 PDF + student variant 만. DOCX/PPTX 는 M3, teacher/answerKey/combined 는 M4.
//
// 응답:
//   Content-Type: application/pdf
//   Content-Disposition: attachment; filename="..."
//   본문: PDF Buffer

export const runtime = 'nodejs';
export const maxDuration = 60;

import { apiError } from '@/lib/api-error';
import { renderPdf, type AnswerVariant } from '@/services/learning-renderer/pdf';
import type { LearningDocument } from '@/services/learning-renderer/schema';
import { createSupabaseServerClient } from '@/services/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'pdf';
  const variantRaw = url.searchParams.get('variant') ?? 'student';

  // M1 은 PDF 만.
  if (format !== 'pdf') {
    return apiError('VALIDATION_ERROR', '현재는 PDF 다운로드만 지원해요 (Word/PPT 는 곧 추가)');
  }
  const variant: AnswerVariant =
    variantRaw === 'teacher' || variantRaw === 'combined' || variantRaw === 'student'
      ? variantRaw
      : 'student';

  // 문서 조회 — RLS 로 조직 멤버 여부 자동 검증.
  const { data: docRow } = await supabase
    .from('learning_documents')
    .select('id, title, document_json')
    .eq('id', params.id)
    .maybeSingle();
  if (!docRow) {
    return apiError('NOT_FOUND', '요청한 문서를 찾을 수 없어요');
  }

  const document = (docRow as { document_json: LearningDocument }).document_json;
  const title = (docRow as { title: string }).title || 'learning-document';

  // 로컬 개발 시 Chrome 자동 감지. Railway 배포 시엔 @sparticuz/chromium 로드.
  const localChromePath = pickLocalChromePath();

  let buffer: Buffer;
  try {
    buffer = await renderPdf(document, {
      useLocalChrome: Boolean(localChromePath),
      localChromePath: localChromePath ?? undefined,
      answerVariant: variant,
    });
  } catch (err) {
    console.error('[learning/documents/render] pdf render failed', err);
    // Phase 1 M1 진단 임시: 원인 파악을 위해 err.message 를 응답에 포함.
    // 서비스 안정화 후 이 상세는 제거하고 일반 메시지만 유지 (M2 이후).
    const detail =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    return apiError('INTERNAL_ERROR', `PDF 생성 중 오류: ${detail}`);
  }

  const safeTitle = sanitizeFilename(title);
  const filename = `${safeTitle}-${variant}.pdf`;
  // HTTP 헤더 값은 ByteString (US-ASCII) 이어야 하므로 filename= 파라미터에는
  // 한글이 그대로 들어갈 수 없다. RFC 5987 에 따라 raw filename 은 ASCII
  // fallback 을 넣고, 실제 UTF-8 문자열은 filename* 로 percent-encoded 전달.
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buffer.length),
      // 다운로드 캐싱 방지 (같은 문서라도 매번 fresh)
      'Cache-Control': 'no-store',
    },
  });
}

function pickLocalChromePath(): string | null {
  const env = process.env.PPTR_LOCAL_CHROME_PATH;
  if (env) return env;
  // Windows/macOS 로컬 개발 편의. Railway (linux) 에서는 파일 없어 null 반환 →
  // @sparticuz/chromium 경로가 사용된다.
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
      try {
        // dynamic require to keep bundler happy.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs') as typeof import('fs');
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function sanitizeFilename(s: string): string {
  return s
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'learning-document';
}
