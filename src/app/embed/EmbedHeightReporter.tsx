'use client';

// 교차 도메인 iframe 높이 자동 반영.
//
// clipart.schoolp.co.kr 같은 부모 페이지가 이 embed 를 iframe 으로 삽입할 때,
// 브라우저는 크로스 오리진 iframe 의 실제 contentHeight 를 알 수 없다. 그래서
// embed 제공측이 postMessage 로 높이를 부모에 알려주고, 부모가 그 값으로
// iframe.style.height 를 갱신하는 방식이 표준.
//
// 이 컴포넌트는 mount + ResizeObserver + 이미지 로드 + 라우트 변경마다
// 현재 document 높이를 부모에 전송한다.
//
// 부모(마케팅 사이트) 쪽에는 별도 스크립트가 필요하다 — 예시:
//
//   window.addEventListener('message', (event) => {
//     if (event.origin !== 'https://clipartstudio.schoolp.co.kr') return;
//     if (event.data?.type !== 'clipart-embed:height') return;
//     const iframe = document.getElementById('clipart-embed');
//     if (iframe) iframe.style.height = event.data.height + 'px';
//   });

import { useEffect } from 'react';

const MESSAGE_TYPE = 'clipart-embed:height';

export function EmbedHeightReporter() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.parent === window) return; // iframe 내부가 아니면 no-op

    let lastHeight = 0;

    function send(): void {
      // scrollHeight 가 실제 컨텐츠 높이를 가장 정확히 반영. 여러 접근을
      // max 로 병합해 스타일에 따라 축소되는 케이스도 커버.
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
        document.documentElement.offsetHeight,
      );
      if (height === lastHeight) return;
      lastHeight = height;
      // targetOrigin '*' — 부모 origin 을 embed 시점에 알 수 없으므로.
      // 페이로드에는 민감 데이터를 담지 않는다 (height 값만).
      window.parent.postMessage({ type: MESSAGE_TYPE, height }, '*');
    }

    // 초기 1회.
    send();

    // ResizeObserver 로 body 크기 변화 감지 (라우트 이동·이미지 로드·폰트 로드 등).
    const target = document.body;
    const ro = new ResizeObserver(() => send());
    ro.observe(target);

    // 이미지 로드 완료 시에도 다시 보고 (스크롤 높이가 이미지 로드 후 확정).
    const imageLoadHandler = () => send();
    window.addEventListener('load', imageLoadHandler);

    // 안전망: 500ms 뒤 한 번 더.
    const t = window.setTimeout(send, 500);

    return () => {
      ro.disconnect();
      window.removeEventListener('load', imageLoadHandler);
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
