// ─────────────────────────────────────────────────────────────
// 테스트 도구 (3단계에서 위조 QR 생성 기능을 추가할 예정)
// ─────────────────────────────────────────────────────────────
import { dbClear } from '../lib/db.js';
import { $ } from '../lib/util.js';

// 응시자 데이터 초기화: IndexedDB를 비워 '예비소집 등록'부터 다시 할 수 있게 한다.
$('#reset-btn').addEventListener('click', async () => {
  if (!confirm('이 기기의 응시자 데이터(기기 키, 신분증, 봉인 기록)를 모두 지울까요?')) return;
  await dbClear();
  const msg = $('#reset-msg');
  msg.hidden = false;
  msg.textContent = '초기화했습니다. 응시자 화면에서 예비소집 등록부터 다시 할 수 있습니다.';
});
