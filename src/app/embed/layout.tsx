// Embed layout — 외부 홈페이지 (clipart.schoolp.co.kr) 가 iframe 으로 임베드
// 하기 위한 minimal wrapper. AppHeader / 사이드바 / 인증 hydrator 없음.
// root layout (app/layout.tsx) 이 이미 html/body/QueryProvider/Toaster 를 담당
// 하므로 여기서는 padding 만 있는 부드러운 wrapper 만 둔다.
//
// EmbedHeightReporter 는 iframe 부모에게 postMessage 로 실시간 높이를 전달.

import { EmbedHeightReporter } from '@/app/embed/EmbedHeightReporter';

import type { PropsWithChildren } from 'react';

// 배경을 완전 투명으로 — 마케팅 사이트가 iframe 뒤에 자체 배경(색·이미지)
// 을 갖고 있을 수 있으므로 embed 는 그 위에 자연스럽게 얹히도록 한다.
// root layout body 의 gradient 는 embed 컨텍스트에서만 무효화 (인라인 style).
export default function EmbedLayout({ children }: PropsWithChildren) {
  return (
    <>
      <style>{`
        html, body { background: transparent !important; }
      `}</style>
      <div className="min-h-screen bg-transparent p-4 md:p-6">
        <EmbedHeightReporter />
        {children}
      </div>
    </>
  );
}
