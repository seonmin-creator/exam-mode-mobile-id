// ─────────────────────────────────────────────────────────────
// 응시자 화면
//   (등록은 register.html 에서) → ① 진입 확인 → ② 시험 모드(봉인) → ③ 시험 종료
//
// 봉인 상태(seal.status)
//   'ready'  : 등록만 끝난 상태
//   'active' : 시험 모드 진행 중 (봉인 유지)
//   'broken' : 봉인 해제됨 (되돌릴 수 없음)
//   'ended'  : 시험 종료 (해제 기록이 있으면 releasedAt 이 남아 있음)
// ─────────────────────────────────────────────────────────────
import QRCode from 'qrcode';
import { buildSignedQr } from '../lib/qr-payload.js';
import { dbGet, dbSet } from '../lib/db.js';
import { unlockAlarm, playAlarm } from '../lib/alarm.js';
import { photoHash } from '../lib/photo.js';
import { findCandidate, assetUrl, formatTime, formatBirth, escapeHtml, $ } from '../lib/util.js';

const QR_INTERVAL = 5; // QR 갱신 주기 (초)
const HOLD_MS = 3000; // 시험 종료 길게 누르기 3초

const app = $('#app');

// 이 기기에 저장된 상태 (IndexedDB에서 불러옴)
let deviceKeys = null; // 기기 키쌍 { privateKey, publicKey }
let issued = null; // 발급받은 신분증 { credentialText, issuerSignature, examNo }
let credential = null; // 신분증 내용 { name, birth, examNo, seat, devicePublicKey }
let seal = null; // 봉인 상태 { status, sealStart, releasedAt, releaseReason, endedAt }
let photo = null; // 등록 때 찍은 증명사진 (없으면 명단의 일러스트 아바타)
let photoOk = true; // 사진 지문이 신분증에 서명된 지문과 같은가

// 시험 모드 화면이 켜져 있는 동안만 쓰는 값
let exam = null;

init().catch(showError);

// ── 시작: 저장된 상태를 보고 알맞은 화면을 연다 ──
async function init() {
  [deviceKeys, issued, seal, photo] = await Promise.all([dbGet('device'), dbGet('credential'), dbGet('seal'), dbGet('photo')]);
  if (!deviceKeys || !issued) return showNotRegistered();
  credential = JSON.parse(issued.credentialText);

  // 저장된 사진의 지문을 다시 계산해 신분증(발급기관 서명)에 든 지문과 비교 → 사진 바꿔치기 감지
  if (credential.photoHash) {
    photoOk = Boolean(photo) && (await photoHash(photo)) === credential.photoHash;
  }

  // 시험 모드 도중에 페이지가 다시 열렸다 = 새로고침했거나 앱을 나갔다 들어옴 → 봉인 해제
  if (seal?.status === 'active') await breakSeal('새로고침 또는 화면 재진입');

  if (seal?.status === 'broken') return showExam();
  if (seal?.status === 'ended') return showSummary();
  showChecklist();
}

// 아직 이 폰에 등록된 응시자가 없을 때 → 등록 화면으로 안내
function showNotRegistered() {
  app.innerHTML = `
    <p class="eyebrow">응시자</p>
    <h2>등록된 응시자가 없습니다</h2>
    <p class="lead">먼저 응시자 등록(예비소집)을 해 주세요. 30초면 끝납니다.</p>
    <a class="btn" href="./register.html">응시자 등록하러 가기</a>`;
}

// ═════════════════════════════════════════════════════════════
// ① 진입 확인
// ═════════════════════════════════════════════════════════════
function showChecklist() {
  app.innerHTML = `
    <p class="eyebrow">진입 조건 확인</p>
    <h2>시험 모드 준비</h2>
    <p class="lead">아래 조건을 통과하면 시험 모드를 시작할 수 있습니다.</p>
    ${idCardHtml()}
    <div class="card" style="margin-top:12px">
      <ul class="steps">
        <li>
          <span class="mark" id="chk-net"></span>
          <div><div class="title">네트워크 연결 없음</div><div class="desc" id="chk-net-desc"></div></div>
        </li>
        <li>
          <span class="mark info">i</span>
          <div><div class="title">블루투스</div><div class="desc">웹에서는 감지할 수 없습니다. 실제 앱에서 감지합니다.</div></div>
        </li>
        <li>
          <span class="mark info">i</span>
          <div>
            <div class="title">앱 고정 켜기 (권장)</div>
            <div class="desc">웹은 다른 앱으로 나가는 것을 막을 수 없어서, 휴대폰의 '앱 고정' 기능으로 이 화면에 묶어 둡니다. 실제 앱에서는 자동으로 켭니다.</div>
            <details class="howto">
              <summary>켜는 방법</summary>
              <p><b>안드로이드(삼성)</b> 설정 → 보안 및 개인정보 보호 → 기타 보안 설정 → <b>앱 고정</b> 켜기 → 최근 앱 화면에서 브라우저 아이콘 → <b>이 앱 고정</b></p>
              <p><b>아이폰</b> 설정 → 손쉬운 사용 → <b>사용법 유도된 접근</b> 켜기 → 이 화면에서 측면 버튼 세 번 누르기 → 시작</p>
            </details>
          </div>
        </li>
      </ul>
    </div>
    <button class="btn" id="start-btn" disabled>시험 모드 시작</button>
    <p class="small">시험 모드를 시작한 뒤 다른 앱으로 이동하거나 통신이 연결되면 즉시 봉인이 해제되며, 되돌릴 수 없습니다.</p>`;
  setWatermark();

  const listeners = new AbortController(); // 화면을 떠날 때 감시를 한꺼번에 끄기 위함
  const { signal } = listeners;

  // 네트워크: navigator.onLine 이 false 여야 통과 (비행기 모드 + 와이파이 꺼짐)
  function checkNetwork() {
    const passed = !navigator.onLine;
    setCheck('chk-net', passed, passed ? '연결 없음 (통과)' : '비행기 모드를 켜고 와이파이를 꺼 주세요');
    $('#start-btn').disabled = !passed;
  }
  checkNetwork();
  window.addEventListener('online', checkNetwork, { signal });
  window.addEventListener('offline', checkNetwork, { signal });

  $('#start-btn').addEventListener('click', () => {
    listeners.abort();
    startExam().catch(showError);
  });
}

// 체크리스트 한 줄의 표시(✓ / ✕)와 설명 바꾸기
function setCheck(id, ok, text) {
  const mark = $(`#${id}`);
  mark.className = `mark ${ok ? 'ok' : 'bad'}`;
  mark.textContent = ok ? '✓' : '✕';
  const desc = $(`#${id}-desc`);
  desc.textContent = text;
  desc.className = `desc ${ok ? '' : 'bad'}`;
}

// ═════════════════════════════════════════════════════════════
// ② 시험 모드
// ═════════════════════════════════════════════════════════════
async function startExam() {
  // 전체화면과 소리는 '버튼을 누른 그 순간'에만 허락되므로 가장 먼저 부른다.
  requestFullscreen();
  unlockAlarm();

  seal = { status: 'active', sealStart: Date.now(), releasedAt: null, releaseReason: null, endedAt: null };
  await dbSet('seal', seal); // 저장해 두면, 새로고침해도 '시험 중이었음'을 알 수 있다

  showExam();
  startWatchers();
  requestWakeLock();
}

function showExam() {
  document.body.classList.add('exam');
  app.innerHTML = `
    <div class="seal-status" id="seal-status"></div>
    ${idCardHtml()}
    <div class="qr-box">
      <canvas id="qr" width="460" height="460"></canvas>
      <div class="qr-meta">다음 갱신까지 <b id="qr-count">${QR_INTERVAL}</b>초</div>
      <div class="qr-bar"><i id="qr-bar"></i></div>
    </div>
    <div class="clock-row">
      <div>현재 시각<strong id="clock">--:--:--</strong></div>
      <div>봉인 시작<strong>${formatTime(seal.sealStart)}</strong></div>
    </div>
    <div class="broken-info" id="broken-info" hidden></div>
    <button class="hold-button" id="end-btn"><i class="hold-fill"></i><span>3초간 길게 눌러 시험 종료</span></button>`;
  setWatermark();

  exam = { countdown: 0, timer: null, watchers: null, guards: null, wakeLock: null, fullscreenEntered: false, busy: false, again: false };
  applySealUi();
  tick();
  exam.timer = setInterval(tick, 1000);
  setupHoldToEnd();
  startLeaveGuards();
}

// 나가기 방지: 웹이 막을 수 있는 것(뒤로가기·닫기·새로고침)은 막는다.
// 홈 버튼·앱 전환은 웹에서 막을 수 없으므로 '감지해서 기록'한다 (startWatchers).
function startLeaveGuards() {
  exam.guards = new AbortController();
  const { signal } = exam.guards;

  // 뒤로가기: 가짜 기록을 하나 쌓아 두고, 뒤로가기를 누르면 다시 쌓으며 가림막을 띄운다.
  history.pushState({ exam: true }, '');
  window.addEventListener('popstate', () => {
    history.pushState({ exam: true }, '');
    showBlocker('warn');
  }, { signal });

  // 닫기·새로고침: 브라우저가 "페이지를 나가시겠습니까?" 확인창을 띄우게 한다.
  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
  }, { signal });
}

// 가림막 + 경고음
//   'warn'   : 나가려는 시도를 막음 (봉인 유지) → 남색
//   'broken' : 나갔다가 돌아옴 (봉인 해제됨) → 빨간색
const BLOCKER_TEXT = {
  warn: {
    title: '시험 모드 진행 중',
    body: '시험이 끝날 때까지 이 화면을 나갈 수 없습니다.<br>다른 앱으로 나가면 봉인이 해제되고, 감독관 확인 때 해제 기록이 표시됩니다.',
  },
  broken: {
    title: '봉인이 해제되었습니다',
    body: '시험 중 화면을 벗어난 기록이 남았습니다.<br>감독관이 QR을 스캔하면 해제 시각이 표시됩니다.',
  },
};

function showBlocker(kind) {
  playAlarm();
  $('#blocker')?.remove();
  const blocker = document.createElement('div');
  blocker.id = 'blocker';
  blocker.className = `blocker ${kind}`;
  blocker.innerHTML = `
    <div class="blocker-box">
      <strong>${BLOCKER_TEXT[kind].title}</strong>
      <p>${BLOCKER_TEXT[kind].body}</p>
      <button class="btn">시험 화면으로 돌아가기</button>
    </div>`;
  document.body.append(blocker);
  blocker.querySelector('button').addEventListener('click', () => blocker.remove());
  setTimeout(() => blocker.remove(), 4000); // 4초 뒤 자동으로 닫힘
}

// 1초마다: 시계 갱신, 남은 시간 표시, 5초가 지나면 QR 새로 만들기
function tick() {
  $('#clock').textContent = formatTime(Date.now());
  exam.countdown -= 1;
  if (exam.countdown <= 0) {
    refreshQr();
    exam.countdown = QR_INTERVAL;
  }
  $('#qr-count').textContent = exam.countdown;
  $('#qr-bar').style.width = `${(exam.countdown / QR_INTERVAL) * 100}%`;
}

// 지금 시각과 봉인 상태를 담아 기기 키로 서명한 QR을 새로 그린다.
async function refreshQr() {
  if (exam.busy) { exam.again = true; return; } // 그리는 중이면 끝난 뒤 한 번 더
  exam.busy = true;
  try {
    const qrText = await buildSignedQr({
      issued,
      deviceKey: deviceKeys.privateKey,
      seal: {
        sealStart: seal.sealStart,
        sealed: seal.status === 'active',
        releasedAt: seal.releasedAt,
        releaseReason: seal.releaseReason,
      },
    });
    if (!exam) return; // 그사이 시험이 끝났으면 그리지 않음
    await QRCode.toCanvas($('#qr'), qrText, { errorCorrectionLevel: 'M', margin: 2, width: 460 });
  } finally {
    if (exam) {
      exam.busy = false;
      if (exam.again) { exam.again = false; refreshQr(); }
    }
  }
}

// 봉인 감시: 아래 일이 하나라도 생기면 즉시 '봉인 해제'
function startWatchers() {
  exam.watchers = new AbortController();
  const { signal } = exam.watchers;

  // 다른 앱이나 탭으로 이동 → 봉인 해제 + 경고음
  // 다시 돌아오면 → 빨간 경고 가림막 + 경고음으로 해제 사실을 알림
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      breakSeal('다른 앱 또는 탭으로 이동');
    } else if (seal.status === 'broken') {
      showBlocker('broken');
    }
  }, { signal });

  // 화면 포커스를 잃음 (최근 앱 버튼·알림창을 내리는 순간 등, 나가기 직전 신호)
  // → 아직 나간 것은 아니므로 봉인은 유지하고, 경고음 + 가림막으로 막는다.
  window.addEventListener('blur', () => {
    if (seal.status === 'active') showBlocker('warn');
  }, { signal });

  // 페이지를 닫거나 벗어남
  window.addEventListener('pagehide', () => breakSeal('페이지를 벗어남'), { signal });

  // 네트워크 연결
  window.addEventListener('online', () => breakSeal('네트워크 연결 감지'), { signal });

  // 전체화면 해제 (전체화면을 지원해서 실제로 들어갔던 기기에서만)
  exam.fullscreenEntered = Boolean(fullscreenElement());
  const onFullscreenChange = () => {
    if (fullscreenElement()) exam.fullscreenEntered = true;
    else if (exam.fullscreenEntered) breakSeal('전체화면 해제');
  };
  document.addEventListener('fullscreenchange', onFullscreenChange, { signal });
  document.addEventListener('webkitfullscreenchange', onFullscreenChange, { signal });
}

// 봉인 해제: 시각과 원인을 기록하고 화면을 빨갛게 바꾼다. 되돌릴 수 없다.
async function breakSeal(reason) {
  if (seal?.status !== 'active') return; // 이미 해제됐거나 시험 중이 아니면 무시
  seal = { ...seal, status: 'broken', releasedAt: Date.now(), releaseReason: reason };
  playAlarm();
  if (exam) {
    applySealUi();
    refreshQr(); // 해제 사실을 담은 QR로 바로 바꿈
    exam.countdown = QR_INTERVAL;
  }
  await dbSet('seal', seal);
}

// 봉인 상태에 맞게 화면 색과 안내 문구 바꾸기
function applySealUi() {
  const broken = seal.status === 'broken';
  document.body.classList.toggle('broken', broken);
  $('#seal-status').textContent = broken ? '봉인 해제됨' : '시험 모드 · 봉인 유지 중';
  const info = $('#broken-info');
  info.hidden = !broken;
  if (broken) {
    info.innerHTML = `<strong>봉인 해제됨</strong>해제 시각 ${formatTime(seal.releasedAt)}<br>원인: ${escapeHtml(seal.releaseReason)}`;
  }
}

// ═════════════════════════════════════════════════════════════
// ③ 시험 종료 (3초 길게 누르기)
// ═════════════════════════════════════════════════════════════
function setupHoldToEnd() {
  const button = $('#end-btn');
  let timer = null;

  const start = (e) => {
    e.preventDefault();
    button.classList.add('holding'); // 채워지는 막대 애니메이션 (3초)
    timer = setTimeout(endExam, HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer);
    button.classList.remove('holding');
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('contextmenu', (e) => e.preventDefault()); // 길게 누를 때 메뉴가 뜨지 않게
}

async function endExam() {
  // 감시를 먼저 끈 뒤 전체화면을 나간다 → '종료'가 '봉인 해제'로 기록되지 않게
  exam.watchers?.abort();
  exam.guards?.abort();
  $('#blocker')?.remove();
  clearInterval(exam.timer);
  exam.wakeLock?.release().catch(() => {});
  exam = null;
  exitFullscreen();

  seal = { ...seal, status: 'ended', endedAt: Date.now() };
  await dbSet('seal', seal);
  showSummary();
}

function showSummary() {
  document.body.classList.remove('exam', 'broken');
  const clean = !seal.releasedAt; // 해제 기록이 없으면 '이상 없음'
  const sealEnd = seal.releasedAt ?? seal.endedAt;

  app.innerHTML = `
    <p class="eyebrow">시험 종료</p>
    <h2>봉인 기록</h2>
    <div class="result ${clean ? 'ok' : 'bad'}">
      ${clean ? '봉인 이상 없음' : '봉인 해제 기록 있음'}
      <div class="small">${clean
        ? '시험 시간 동안 봉인이 한 번도 풀리지 않았습니다.'
        : `${formatTime(seal.releasedAt)} · ${escapeHtml(seal.releaseReason)}`}</div>
    </div>
    <div class="card" style="margin-top:12px">
      <dl class="summary">
        <dt>응시자</dt><dd>${escapeHtml(credential.name)} (${credential.examNo})</dd>
        <dt>봉인 시작</dt><dd>${formatTime(seal.sealStart)}</dd>
        ${clean ? '' : `
          <dt>봉인 해제</dt><dd>${formatTime(seal.releasedAt)}</dd>
          <dt>해제 원인</dt><dd>${escapeHtml(seal.releaseReason)}</dd>`}
        <dt>시험 종료</dt><dd>${formatTime(seal.endedAt)}</dd>
        <dt>봉인 유지</dt><dd>${formatDuration(sealEnd - seal.sealStart)}</dd>
      </dl>
    </div>
    <a class="btn secondary" href="./test.html">데모 다시 하기 (테스트 도구에서 초기화)</a>`;
}

// ═════════════════════════════════════════════════════════════
// 화면 조각 · 보조 기능
// ═════════════════════════════════════════════════════════════

// 신분증 카드 (등록 때 찍은 사진, 없으면 명단의 일러스트 아바타)
function idCardHtml() {
  const avatar = findCandidate(credential.examNo)?.photo;
  const src = photo ?? (avatar && assetUrl(avatar));
  return `
    <div class="id-card">
      <div class="id-card-head"><span>모의 수험 신분증</span><span>${credential.examNo}</span></div>
      <div class="id-card-body">
        <div class="watermark" id="watermark"></div>
        ${src ? `<img class="id-photo" src="${src}" alt="증명사진" />` : ''}
        <dl>
          <dt>성명</dt><dd class="name">${escapeHtml(credential.name)}</dd>
          <dt>생년월일</dt><dd>${formatBirth(credential.birth)}</dd>
          <dt>좌석</dt><dd>${escapeHtml(credential.seat)}</dd>
        </dl>
      </div>
      ${photoOk ? '' : '<div class="id-card-alert">사진 지문 불일치 · 사진이 바뀐 것으로 의심됩니다</div>'}
    </div>`;
}

// 움직이는 워터마크 무늬 (수험번호가 들어간 글자 무늬를 SVG로 만들어 배경으로 깔기)
function setWatermark() {
  const text = `시험 모드 · ${credential.examNo} · 실시간`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70">
    <text x="6" y="44" font-size="14" font-weight="700" font-family="sans-serif" fill="#1b3a6b"
      transform="rotate(-12 110 35)">${text}</text></svg>`;
  $('#watermark').style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}시간 ${m}분 ${s}초` : `${m}분 ${s}초`;
}

// 전체화면: 지원하지 않으면(아이폰 사파리 등) 조용히 넘어간다.
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return;
  try { request.call(el)?.catch?.(() => {}); } catch { /* 미지원 */ }
}

function exitFullscreen() {
  if (!fullscreenElement()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  try { exit.call(document)?.catch?.(() => {}); } catch { /* 무시 */ }
}

// 화면 꺼짐 방지: 지원하지 않으면 조용히 넘어간다.
async function requestWakeLock() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (exam) exam.wakeLock = lock;
  } catch { /* 미지원 또는 거부 */ }
}

function showError(err) {
  console.error(err);
  document.body.classList.remove('exam', 'broken');
  app.innerHTML = `
    <div class="result bad">오류가 발생했습니다
      <div class="small">${escapeHtml(err?.message ?? err)}</div>
    </div>`;
}
