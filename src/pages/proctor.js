// ─────────────────────────────────────────────────────────────
// 감독관 화면
//   후면 카메라로 응시자 QR을 읽고, 통신 없이 이 기기 안에서 검증한다. (검증 규칙: lib/verify.js)
//   이 파일에는 네트워크 요청(fetch 등)이 없다.
//
// 확인 기록은 감독관 기기의 IndexedDB('proctorLog')에만 남고,
// '시험 종료 · 기록 삭제'를 누르면 지운다 (개인정보 최소 보관).
// ─────────────────────────────────────────────────────────────
import { createScanner } from '../lib/scanner.js';
import { verifyQr, CHECKS } from '../lib/verify.js';
import { dbGet, dbSet } from '../lib/db.js';
import { formatTime, formatBirth, escapeHtml, $ } from '../lib/util.js';
import { registerQuietly } from '../lib/pwa.js';
import { makeRestoreCode } from '../lib/restore-code.js';

// 오프라인용 서비스 워커 등록 (이 화면에서는 업데이트 안내·자동 새로고침을 하지 않음)
registerQuietly();

const RESULT_MS = 3000; // 결과 화면을 보여 주는 시간 (3초)

let scanner = null; // 카메라 스캐너 (lib/scanner.js)
let busy = false; // 결과를 보여 주는 동안에는 새 QR을 읽지 않음
let closeTimer = null;
let log = []; // 확인 기록 [{ at, examNo, name, verdict, level, title }]
let room = null; // 담당 시험실 { examName, venue }

// ── 상단: 시각 · 네트워크 상태 ──
function tickClock() {
  $('#clock').textContent = formatTime(Date.now());
}
tickClock();
setInterval(tickClock, 1000);

// 검증에는 통신을 쓰지 않으므로 온라인이든 오프라인이든 똑같이 작동한다. 상태만 알려 준다.
function updateNet() {
  const chip = $('#net-chip');
  chip.textContent = navigator.onLine ? '온라인 · 검증에는 통신을 쓰지 않음' : '오프라인 검증 모드';
  chip.classList.toggle('offline', !navigator.onLine);
}
updateNet();
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

// ── 카메라 스캔 ──
// 카메라를 고해상도로 열고 원래 해상도 그대로 해독한다 (자세한 이유: lib/scanner.js)
async function startScanner() {
  $('#camera-btn').hidden = true;
  $('#camera-help').hidden = true;
  showReaderMsg('카메라를 켜는 중…');
  try {
    scanner ??= createScanner($('#camera'), onScan);
    await scanner.start();
    showReaderMsg('');
  } catch (err) {
    console.error(err);
    showReaderMsg(cameraErrorText(err));
    $('#camera-help').hidden = err?.name !== 'NotAllowedError'; // 권한이 막혔으면 푸는 방법 보여 주기
    $('#camera-btn').hidden = false;
  }
}

// 카메라 권한 상태: 'granted'(허용) · 'denied'(차단) · 'prompt'(아직 안 물어봄) · 'unknown'
async function cameraPermission() {
  try {
    return (await navigator.permissions.query({ name: 'camera' })).state;
  } catch {
    return 'unknown'; // 권한 상태를 알려 주지 않는 브라우저
  }
}

// 카메라 준비: 이미 허용됐으면 바로 켜고, 아니면 [카메라 켜기] 버튼을 눌렀을 때만 권한을 묻는다.
// (화면을 열 때마다 권한 창을 띄우면, 창을 몇 번 닫았을 때 크롬이 스스로 '차단'으로 바꿔 버린다)
async function prepareCamera() {
  const state = await cameraPermission();
  if (state === 'granted') return startScanner();
  $('#camera-btn').hidden = false;
  if (state === 'denied') {
    showReaderMsg('카메라 권한이 차단되어 있습니다. 아래 방법으로 허용해 주세요.');
    $('#camera-help').hidden = false;
  } else {
    showReaderMsg('[카메라 켜기]를 누르고 카메라 권한을 "허용"해 주세요.');
  }
}

// 카메라를 못 연 이유를 알아보기 쉽게 알려 준다
function cameraErrorText(err) {
  if (!window.isSecureContext) return '카메라는 https 주소에서만 작동합니다.';
  switch (err?.name) {
    case 'NotAllowedError': return '카메라 권한이 차단되어 있습니다. 아래 방법으로 허용해 주세요.';
    case 'NotReadableError': return '다른 앱이나 다른 탭이 카메라를 쓰고 있습니다. 그 앱·탭을 닫고 [카메라 켜기]를 눌러 주세요.';
    case 'NotFoundError': case 'OverconstrainedError': return '이 기기에서 쓸 수 있는 카메라를 찾지 못했습니다.';
    default: return `카메라를 열 수 없습니다 (${err?.name || err}). [카메라 켜기]를 다시 눌러 주세요.`;
  }
}

// 설정에서 권한을 허용하고 돌아오면 자동으로 카메라를 켠다
navigator.permissions?.query({ name: 'camera' }).then((status) => {
  status.addEventListener('change', () => {
    if (status.state === 'granted' && room && !scanner?.active) startScanner();
  });
}).catch(() => {});

// 다른 앱에 갔다 오면 폰이 카메라를 꺼 버리는 경우가 있어, 돌아왔을 때 다시 켠다
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !room || !scanner || scanner.active) return;
  if ((await cameraPermission()) !== 'denied') startScanner();
});

function showReaderMsg(text) {
  $('#reader-msg').hidden = !text;
  $('#reader-msg').textContent = text;
}

// QR을 읽었을 때
async function onScan(qrText) {
  if (busy) return;
  busy = true;
  scanner.pause();

  const result = await verifyQr(qrText, { room }); // ★ 이 기기 안에서만 검증
  showResult(result);
  addLog(result);
  navigator.vibrate?.(result.verdict === 'valid' ? [80] : [200, 100, 200]);
}

// ── 결과 화면 ──
function showResult(r) {
  const screen = $('#result');
  screen.className = `result-screen level-${r.level}`;
  screen.hidden = false;

  $('#result-title').textContent = r.title;
  $('#result-detail').textContent = r.detail;

  // 판정 단계별 ✓ / ✕ / – (확인 전에 멈춘 단계)
  $('#check-list').innerHTML = CHECKS.map(({ key, label }) => {
    const v = r.checks[key];
    const mark = v === true ? '✓' : v === false ? '✕' : '–';
    const cls = v === true ? 'pass' : v === false ? 'fail' : 'skip';
    return `<li class="${cls}"><span>${mark}</span>${label}</li>`;
  }).join('');

  $('#result-body').innerHTML = r.verdict === 'valid' ? validHtml(r) : personLine(r) + restoreHtml(r);
  $('#restore-btn')?.addEventListener('click', () => showRestoreCode(r));

  // 3초 뒤 자동으로 스캔 대기로 (화면을 누르면 멈춤 → 얼굴 대조할 시간 확보)
  const bar = $('#auto-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${RESULT_MS}ms linear`;
    bar.style.width = '0%';
  }));
  $('#auto-hint').textContent = '3초 뒤 스캔 대기로 돌아갑니다 · 화면을 누르면 멈춤';
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closeResult, RESULT_MS);
}

// 유효할 때: 응시자 정보 + 얼굴 대조 안내
// (사진은 QR에 넣지 않으므로 감독관은 응시자 화면의 사진과 실제 얼굴을 대조한다)
function validHtml({ credential, payload }) {
  return `
    <div class="face-check">응시자 화면의 사진과 얼굴을 대조하세요</div>
    <div class="person">
      <dl>
        <dt>성명</dt><dd class="name">${escapeHtml(credential.name)}</dd>
        <dt>생년월일</dt><dd>${formatBirth(credential.birth)}</dd>
        <dt>시험</dt><dd>${escapeHtml(credential.examName)}</dd>
        <dt>수험번호</dt><dd>${escapeHtml(credential.examNo)}</dd>
        <dt>시험장소</dt><dd>${escapeHtml(credential.venue)}</dd>
        <dt>좌석</dt><dd>${escapeHtml(credential.seat)}</dd>
        <dt>잠금 시작</dt><dd>${formatTime(payload.sealStart)}</dd>
        <dt>잠금 유지</dt><dd>${formatDuration(payload.time - payload.sealStart)}</dd>
        ${payload.restoreCount ? `<dt>잠금 복구</dt><dd>${payload.restoreCount}회 · 감독관 승인 (마지막 ${formatTime(payload.restoredAt)})</dd>` : ''}
      </dl>
    </div>
    ${credential.photoHash ? '<p class="result-note">사진 지문 포함 · 발급 후 바뀐 사진은 응시자 화면에 경고 표시</p>' : ''}`;
}

// 실패했어도 신분증을 읽었으면 누구의 QR인지 한 줄로 보여 준다
function personLine({ credential }) {
  if (!credential?.name) return '';
  return `<p class="result-person">${escapeHtml(credential.name)} · ${escapeHtml(credential.examNo ?? '')}</p>`;
}

// ── 잠금 복구 (감독관 승인) ──
// '잠금 해제됨' 판정은 서명·시각이 모두 진짜인 QR에서만 나온다 → 이 QR의 해제 시각은 믿을 수 있다.
// 감독관이 사정을 확인하고 실수라고 판단하면 6자리 복구 코드를 만들어 응시자에게 알려 준다. (lib/restore-code.js)
function restoreHtml(r) {
  if (r.verdict !== 'unsealed' || !r.payload?.releasedAt) return '';
  return `
    <div class="restore-box" id="restore-box">
      <p>실수로 풀린 경우(알림창을 잘못 내림 등), 응시자 사정을 확인한 뒤 복구 코드를 알려 주세요.</p>
      <button class="btn restore-btn" id="restore-btn" type="button">잠금 복구 코드 만들기</button>
    </div>`;
}

async function showRestoreCode(r) {
  stopAutoClose(); // 코드를 알려 주는 동안 결과 화면이 닫히지 않게
  const code = await makeRestoreCode(r.credential.examNo, r.payload.releasedAt);
  $('#restore-box').innerHTML = `
    <span class="small">잠금 복구 코드 · ${escapeHtml(r.credential.name)}</span>
    <strong class="restore-code">${code.slice(0, 3)} ${code.slice(3)}</strong>
    <p>응시자 화면의 빨간 상자에 이 6자리를 입력하면 잠금이 복구됩니다.<br>
    해제 기록은 지워지지 않고, 다음 스캔 때 '잠금 복구 1회'로 표시됩니다.</p>`;
  addLog({ ...r, level: 'orange', title: '잠금 복구 코드 발급' });
}

function closeResult() {
  clearTimeout(closeTimer);
  $('#result').hidden = true;
  busy = false;
  scanner?.resume();
}

$('#rescan-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeResult();
});

// 결과 화면을 누르면 자동 닫힘을 멈춘다
$('#result').addEventListener('pointerdown', (e) => {
  if (e.target.closest('#rescan-btn')) return;
  stopAutoClose();
});

function stopAutoClose() {
  clearTimeout(closeTimer);
  const bar = $('#auto-bar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  $('#auto-hint').textContent = '자동 닫힘을 멈췄습니다 · [다시 스캔]을 누르세요';
}

// ── 확인 기록 ──
async function addLog(r) {
  log.unshift({
    at: Date.now(),
    examNo: r.credential?.examNo ?? '-',
    name: r.credential?.name ?? '-',
    verdict: r.verdict,
    level: r.level,
    title: r.title,
  });
  renderLog();
  await dbSet('proctorLog', log);
}

function renderLog() {
  $('#log-count').textContent = `${log.length}건`;
  $('#log-list').innerHTML = log.length
    ? log.map((e) => `
        <li>
          <span class="log-time">${formatTime(e.at)}</span>
          <span class="log-who">${escapeHtml(e.name)}<small>${escapeHtml(e.examNo)}</small></span>
          <span class="log-result level-${e.level}">${escapeHtml(e.title)}</span>
        </li>`).join('')
    : '<li class="log-empty">아직 확인한 응시자가 없습니다.</li>';
}

// 시험 종료 · 기록 삭제
$('#clear-btn').addEventListener('click', async () => {
  if (!confirm('이 감독관 기기의 확인 기록을 모두 삭제할까요?')) return;
  log = [];
  await dbSet('proctorLog', log);
  renderLog();
  const msg = $('#clear-msg');
  msg.hidden = false;
  msg.textContent = '감독관 기기의 확인 기록이 삭제되었습니다.';
});

$('#camera-btn').addEventListener('click', startScanner);

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}시간 ${m}분 ${s}초` : `${m}분 ${s}초`;
}

// ── 담당 시험실 ──
// 감독관이 맡은 시험명·시험장소. 신분증에 서명된 시험명·시험장소와 같아야 '유효함'이 된다.
// 이 감독관 기기의 IndexedDB('proctorRoom')에만 저장한다.
function showRoom() {
  const set = Boolean(room);
  $('#room-view').hidden = !set;
  $('#room-form').hidden = set;
  if (set) {
    $('#room-text').textContent = `${room.examName} · ${room.venue}`;
  } else {
    const form = $('#room-form');
    form.examName.value = '';
    form.venue.value = '';
  }
}

$('#room-edit').addEventListener('click', () => {
  const form = $('#room-form');
  form.examName.value = room?.examName ?? '';
  form.venue.value = room?.venue ?? '';
  $('#room-view').hidden = true;
  form.hidden = false;
});

$('#room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const examName = form.examName.value.trim();
  const venue = form.venue.value.trim();
  if (!examName || !venue) return;
  room = { examName, venue };
  await dbSet('proctorRoom', room);
  showRoom();
  if (!scanner?.active) prepareCamera(); // 처음 입력했을 때 카메라 준비
});

// ── 시작 ──
[log, room] = await Promise.all([dbGet('proctorLog'), dbGet('proctorRoom')]);
log ??= [];
renderLog();
showRoom();
// 담당 시험실을 입력해야 스캔을 시작한다 (시험실 확인에 필요)
if (room) prepareCamera();
else showReaderMsg('먼저 위에 담당 시험명과 시험장소를 입력해 주세요.');
