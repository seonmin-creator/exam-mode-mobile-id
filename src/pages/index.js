// ─────────────────────────────────────────────────────────────
// 처음 화면
//   - 오프라인 준비 배지: 서비스 워커가 모든 페이지를 저장했는지 보여 준다.
//   - 업데이트 안내: 새 버전이 기다리고 있을 때 [업데이트] 버튼을 보여 준다.
//     (업데이트 안내는 이 화면에서만 한다. 응시자·감독관 화면은 시험 중이라 띄우지 않음)
// ─────────────────────────────────────────────────────────────
import { registerWithUpdatePrompt, isOfflineReady, pwaEnabled } from '../lib/pwa.js';
import { $ } from '../lib/util.js';

const badge = $('#offline-badge');

function setBadge(state, text) {
  badge.className = `offline-badge ${state}`;
  badge.textContent = text;
}

// 준비가 끝날 때까지 1초마다 확인한다 (처음 열 때 파일을 내려받는 데 몇 초 걸림)
async function watchOfflineReady() {
  if (!pwaEnabled) {
    setBadge('off', import.meta.env.DEV ? '개발 서버 · 오프라인 저장 안 함' : '이 브라우저는 오프라인 사용을 지원하지 않음');
    return;
  }
  setBadge('wait', '오프라인 준비 중…');
  while (!(await isOfflineReady())) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  setBadge('ready', '오프라인 준비 완료');
}

watchOfflineReady();

const updateSW = await registerWithUpdatePrompt({
  // 새 버전이 설치되어 기다리는 중 → 버튼 보이기
  onNeedRefresh() {
    $('#update-bar').hidden = false;
  },
});

// [업데이트]: 기다리던 새 버전을 적용하고 이 화면(index)만 새로고침한다
$('#update-btn').addEventListener('click', () => {
  $('#update-btn').disabled = true;
  $('#update-btn').textContent = '업데이트 중…';
  updateSW(true);
});
