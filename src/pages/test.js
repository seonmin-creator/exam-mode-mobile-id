// ─────────────────────────────────────────────────────────────
// 테스트 도구 (시연용 · 실제 공격 도구가 아님)
//   테스트 QR 7가지를 보여 주고, 감독관 화면이 각각을 제대로 판정하는지 확인한다.
//   QR 만들기: lib/test-qr.js · 검증: lib/verify.js (감독관 화면과 같은 코드)
//   이 파일에는 네트워크 요청(fetch 등)이 없다.
// ─────────────────────────────────────────────────────────────
import QRCode from 'qrcode';
import { TEST_CASES, makeTestQr } from '../lib/test-qr.js';
import { verifyQr, CHECKS, VERDICTS } from '../lib/verify.js';
import { dbClear, dbGet, dbSet } from '../lib/db.js';
import { formatTime, escapeHtml, $ } from '../lib/util.js';
import { registerQuietly } from '../lib/pwa.js';

// 오프라인용 서비스 워커 등록 (이 화면에서는 업데이트 안내·자동 새로고침을 하지 않음)
registerQuietly();

const REFRESH_SEC = 15; // 응시자 화면과 같은 15초 갱신
// QR 그리기 설정: 응시자 화면과 같음 (오류정정 L · 표준 여백 4칸 · 칸당 6px)
const QR_DRAW = { errorCorrectionLevel: 'L', margin: 4, scale: 6 };

let current = null; // 지금 보여 주는 테스트 { testCase, qrText }
let countdown = REFRESH_SEC;
let drawId = 0; // 늦게 끝난 이전 QR이 새 QR을 덮어쓰지 않게 하는 번호

// ── 카드 7개 ──
$('#case-list').innerHTML = TEST_CASES.map((t, i) => `
  <li>
    <button class="case-card" data-id="${t.id}">
      <span class="case-no">${i + 1}</span>
      <span class="case-body">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="case-line">흉내: ${escapeHtml(t.mimics)}</span>
        <span class="case-line">기대: <em class="chip level-${VERDICTS[t.expect].level}">${escapeHtml(t.expectText)}</em></span>
      </span>
    </button>
  </li>`).join('');

$('#case-list').addEventListener('click', (e) => {
  const card = e.target.closest('.case-card');
  if (card) selectCase(TEST_CASES.find((t) => t.id === card.dataset.id));
});

// ── 시험명·시험장소 (감독관 폰에 입력한 담당 시험실과 같게) ──
// 처음에는 이 폰에 저장된 값(테스트 도구 → 감독관 → 응시자 등록 순)으로 채워 둔다.
let room = null;

async function loadRoom() {
  const [saved, proctorRoom, issued] = await Promise.all([dbGet('testRoom'), dbGet('proctorRoom'), dbGet('credential')]);
  const cred = issued ? JSON.parse(issued.credentialText) : null;
  room = saved ?? proctorRoom ?? (cred?.venue ? { examName: cred.examName, venue: cred.venue } : null);
  const form = $('#room-form');
  form.examName.value = room?.examName ?? '';
  form.venue.value = room?.venue ?? '';
}

$('#room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  room = { examName: form.examName.value.trim(), venue: form.venue.value.trim() };
  if (!room.examName || !room.venue) return;
  await dbSet('testRoom', room);
  $('#room-msg').hidden = false;
  if (current) selectCase(current.testCase); // 보고 있던 QR을 새 시험실로 다시 만든다
});

// 테스트를 고르면 QR을 크게 보여 주고 기대 결과를 적는다
function selectCase(testCase) {
  if (!room?.examName || !room?.venue) {
    alert('위에 시험명과 시험장소를 먼저 입력하고 [적용]을 눌러 주세요.');
    $('#room-form').examName.focus();
    return;
  }
  document.querySelectorAll('.case-card').forEach((el) => el.classList.toggle('active', el.dataset.id === testCase.id));
  current = { testCase, qrText: null };

  const panel = $('#qr-panel');
  panel.hidden = false;
  $('#panel-no').textContent = `테스트 ${TEST_CASES.indexOf(testCase) + 1}`;
  $('#panel-name').textContent = testCase.name;
  $('#expect-box').className = `expect-box level-${VERDICTS[testCase.expect].level}`;
  $('#expect-text').textContent = testCase.expectText;
  $('#self-result').hidden = true;

  countdown = REFRESH_SEC;
  drawQr();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function drawQr() {
  const id = ++drawId;
  const { testCase } = current;
  const qrText = await makeTestQr(testCase, room);
  if (id !== drawId) return; // 그사이 다른 테스트를 골랐음
  current.qrText = qrText;
  await QRCode.toCanvas($('#test-qr'), qrText, QR_DRAW);
  updateRefreshNote();
}

function updateRefreshNote() {
  $('#refresh-note').textContent = current.testCase.refresh
    ? `${REFRESH_SEC}초마다 지금 시각으로 다시 만듭니다 · ${countdown}초 뒤 갱신`
    : '일부러 갱신하지 않습니다 · QR 속 시각이 2분 전으로 고정';
}

// 1초마다: 갱신하는 테스트는 갱신 주기가 되면 QR을 새로 만든다 (2번 오래된 QR은 제외)
setInterval(() => {
  if (!current?.testCase.refresh) return;
  countdown -= 1;
  if (countdown <= 0) {
    countdown = REFRESH_SEC;
    drawQr();
  }
  updateRefreshNote();
}, 1000);

// ── 이 기기에서 직접 검증 (폰이 한 대뿐일 때) ──
// 감독관 화면과 똑같은 verifyQr()에 지금 화면의 QR 글자를 넣어 본다.
$('#self-verify-btn').addEventListener('click', async () => {
  if (!current?.qrText) return;
  const r = await verifyQr(current.qrText, { room });
  const match = r.verdict === current.testCase.expect;

  const steps = CHECKS.map(({ key, label }) => {
    const v = r.checks[key];
    const mark = v === true ? '✓' : v === false ? '✕' : '–';
    const cls = v === true ? 'pass' : v === false ? 'fail' : 'skip';
    return `<li class="${cls}"><span>${mark}</span>${label}</li>`;
  }).join('');

  const box = $('#self-result');
  box.className = `self-result level-${r.level}`;
  box.hidden = false;
  box.innerHTML = `
    <span class="small">${formatTime(Date.now())} 이 기기에서 판정</span>
    <strong class="self-title">${escapeHtml(r.title)}</strong>
    ${r.detail ? `<p class="self-detail">${escapeHtml(r.detail)}</p>` : ''}
    <ul class="check-list">${steps}</ul>
    <p class="self-match">${match ? '✓ 기대 결과와 같습니다' : '✕ 기대 결과와 다릅니다'}</p>`;
});

// ── 응시자 데이터 초기화 ──
// IndexedDB를 비워 '응시자 등록'부터 다시 할 수 있게 한다. (테스트 QR과는 상관없음)
$('#reset-btn').addEventListener('click', async () => {
  if (!confirm('이 기기의 응시자 데이터(기기 키, 신분증, 봉인 기록)를 모두 지울까요?')) return;
  await dbClear();
  const msg = $('#reset-msg');
  msg.hidden = false;
  msg.textContent = '초기화했습니다. 처음 화면의 [응시자 등록]부터 다시 할 수 있습니다.';
});

loadRoom();
