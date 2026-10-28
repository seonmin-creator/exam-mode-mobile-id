// ─────────────────────────────────────────────────────────────
// 서비스 워커 등록 (오프라인 사용)
//
// 서비스 워커(sw.js)가 모든 페이지·파일을 폰에 미리 저장해 두므로,
// 한 번 열어 둔 뒤에는 비행기 모드에서도 모든 페이지가 열린다.
//
// ★ 업데이트 규칙 (중요)
//   새 버전이 배포되어도 저절로 새로고침하지 않는다.
//   응시자 화면은 새로고침을 '봉인 해제'로 처리하기 때문이다.
//   - 처음 화면(index)  : registerWithUpdatePrompt → "새 버전이 있습니다 · 업데이트" 버튼
//   - 나머지 화면        : registerQuietly → 등록만 하고 업데이트 안내·새로고침을 하지 않음
//     (vite-plugin-pwa의 등록 함수는 새 버전이 적용될 때 페이지를 새로고침하는 코드를 붙이므로
//      응시자·감독관 화면에서는 쓰지 않고 브라우저 기본 등록만 한다)
// ─────────────────────────────────────────────────────────────
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

// 개발 서버(npm run dev)에서는 서비스 워커를 쓰지 않는다 (수정한 코드가 바로 보이도록)
const enabled = !import.meta.env.DEV && 'serviceWorker' in navigator;

// 등록만 한다. 새 버전이 오면 기다리게 둘 뿐, 이 화면은 절대 새로고침하지 않는다.
export function registerQuietly() {
  if (!enabled) return;
  navigator.serviceWorker.register(SW_URL, { scope: import.meta.env.BASE_URL }).catch(() => {
    // 등록 실패해도 온라인에서는 정상 작동하므로 조용히 넘어간다
  });
}

// 처음 화면 전용: 새 버전이 기다리고 있으면 onNeedRefresh()를 부른다.
// 돌려주는 함수 update()를 부르면 새 버전으로 바꾸고 이 화면(index)만 새로고침한다.
export async function registerWithUpdatePrompt({ onNeedRefresh, onOfflineReady }) {
  if (!enabled) return () => {};
  const { registerSW } = await import('virtual:pwa-register');
  return registerSW({ immediate: true, onNeedRefresh, onOfflineReady });
}

// 오프라인 준비가 끝났는지 확인: 서비스 워커가 활성화되고, 다섯 페이지가 모두 저장되어 있는가?
const PAGES = ['index', 'register', 'student', 'proctor', 'test'];
export async function isOfflineReady() {
  if (!enabled || !('caches' in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active) return false;
  // 미리 저장된 파일 주소에는 버전 표시(?__WB_REVISION__=…)가 붙어 있어 ignoreSearch로 찾는다
  const found = await Promise.all(
    PAGES.map((p) => caches.match(`${import.meta.env.BASE_URL}${p}.html`, { ignoreSearch: true })),
  );
  return found.every(Boolean);
}

export const pwaEnabled = enabled;
