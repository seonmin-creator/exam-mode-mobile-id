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
import { assetUrl, formatTime, formatBirth, escapeHtml, $ } from '../lib/util.js';
import { registerQuietly } from '../lib/pwa.js';

// 오프라인용 서비스 워커 등록 (이 화면에서는 업데이트 안내·자동 새로고침을 하지 않음)
registerQuietly();

const RESULT_MS = 3000; // 결과 화면을 보여 주는 시간 (3초)

let scanner = null; // 카메라 스캐너 (lib/scanner.js)
let busy = false; // 결과를 보여 주는 동안에는 새 QR을 읽지 않음
let closeTimer = null;
let log = []; // 확인 기록 [{ at, examNo, name, verdict, level, title }]

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
  showReaderMsg('');
  try {
    scanner ??= createScanner($('#camera'), onScan);
    await scanner.start();
  } catch (err) {
    console.error(err);
    showReaderMsg(cameraErrorText(err));
    $('#camera-btn').hidden = false;
  }
}

// 카메라를 못 연 이유를 알아보기 쉽게 알려 준다
function cameraErrorText(err) {
  if (!window.isSecureContext) return '카메라는 https 주소에서만 작동합니다.';
  switch (err?.name) {
    case 'NotAllowedError': return '카메라 권한이 막혀 있습니다. 주소창 왼쪽 자물쇠 → 카메라 → 허용 후 [카메라 시작]을 눌러 주세요.';
    case 'NotReadableError': return '다른 앱이나 다른 탭이 카메라를 쓰고 있습니다. 그 앱·탭을 닫고 [카메라 시작]을 눌러 주세요.';
    case 'NotFoundError': case 'OverconstrainedError': return '이 기기에서 쓸 수 있는 카메라를 찾지 못했습니다.';
    default: return `카메라를 열 수 없습니다 (${err?.name || err}). [카메라 시작]을 다시 눌러 주세요.`;
  }
}

function showReaderMsg(text) {
  $('#reader-msg').hidden = !text;
  $('#reader-msg').textContent = text;
}

// QR을 읽었을 때
async function onScan(qrText) {
  if (busy) return;
  busy = true;
  scanner.pause();

  const result = await verifyQr(qrText); // ★ 이 기기 안에서만 검증
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

  $('#result-body').innerHTML = r.verdict === 'valid' ? validHtml(r) : personLine(r);

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
function validHtml({ credential, payload, candidate }) {
  return `
    <div class="face-check">응시자 화면의 사진과 얼굴을 대조하세요</div>
    <div class="person">
      ${candidate.photo ? `<img src="${assetUrl(candidate.photo)}" alt="" title="명단 참고 이미지" />` : ''}
      <dl>
        <dt>성명</dt><dd class="name">${escapeHtml(credential.name)}</dd>
        <dt>생년월일</dt><dd>${formatBirth(credential.birth)}</dd>
        <dt>수험번호</dt><dd>${escapeHtml(credential.examNo)}</dd>
        <dt>좌석</dt><dd>${escapeHtml(credential.seat)}</dd>
        <dt>시험실</dt><dd>${escapeHtml(candidate.venue)}</dd>
        <dt>봉인 시작</dt><dd>${formatTime(payload.sealStart)}</dd>
        <dt>봉인 유지</dt><dd>${formatDuration(payload.time - payload.sealStart)}</dd>
      </dl>
    </div>
    ${credential.photoHash ? '<p class="result-note">사진 지문 포함 · 발급 후 바뀐 사진은 응시자 화면에 경고 표시</p>' : ''}
    ${candidate.photo ? '<p class="result-note">왼쪽 그림은 명단 참고 이미지입니다 (실제 사진 아님)</p>' : ''}`;
}

// 실패했어도 신분증을 읽었으면 누구의 QR인지 한 줄로 보여 준다
function personLine({ credential }) {
  if (!credential?.name) return '';
  return `<p class="result-person">${escapeHtml(credential.name)} · ${escapeHtml(credential.examNo ?? '')}</p>`;
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
  clearTimeout(closeTimer);
  const bar = $('#auto-bar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  $('#auto-hint').textContent = '자동 닫힘을 멈췄습니다 · [다시 스캔]을 누르세요';
});

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

// ── 시작 ──
log = (await dbGet('proctorLog')) ?? [];
renderLog();
startScanner();
