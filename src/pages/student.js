// ─────────────────────────────────────────────────────────────
// 응시자 화면
//   ① 예비소집 등록 → ② 진입 조건 확인 → ③ 시험 모드(봉인) → ④ 시험 종료
//
// 봉인 상태(seal.status)
//   'ready'  : 등록만 끝난 상태
//   'active' : 시험 모드 진행 중 (봉인 유지)
//   'broken' : 봉인 해제됨 (되돌릴 수 없음)
//   'ended'  : 시험 종료 (해제 기록이 있으면 releasedAt 이 남아 있음)
// ─────────────────────────────────────────────────────────────
import QRCode from 'qrcode';
import { createDeviceKeyPair } from '../lib/crypto.js';
import { issueCredential } from '../lib/issuer-mock.js';
import { buildSignedQr } from '../lib/qr-payload.js';
import { dbGet, dbSet } from '../lib/db.js';
import { roster, findCandidate, assetUrl, formatTime, formatBirth, escapeHtml, $, sleep } from '../lib/util.js';

const QR_INTERVAL = 5; // QR 갱신 주기 (초)
const HOLD_MS = 3000; // 시험 종료 길게 누르기 3초

const app = $('#app');

// 이 기기에 저장된 상태 (IndexedDB에서 불러옴)
let deviceKeys = null; // 기기 키쌍 { privateKey, publicKey }
let issued = null; // 발급받은 신분증 { credentialText, issuerSignature, examNo }
let credential = null; // 신분증 내용 { name, birth, examNo, seat, devicePublicKey }
let seal = null; // 봉인 상태 { status, sealStart, releasedAt, releaseReason, endedAt }

// 시험 모드 화면이 켜져 있는 동안만 쓰는 값
let exam = null;

init().catch(showError);

// ── 시작: 저장된 상태를 보고 알맞은 화면을 연다 ──
async function init() {
  [deviceKeys, issued, seal] = await Promise.all([dbGet('device'), dbGet('credential'), dbGet('seal')]);
  if (!deviceKeys || !issued) return showRegister();
  credential = JSON.parse(issued.credentialText);

  // 시험 모드 도중에 페이지가 다시 열렸다 = 새로고침했거나 앱을 나갔다 들어옴 → 봉인 해제
  if (seal?.status === 'active') await breakSeal('새로고침 또는 화면 재진입');

  if (seal?.status === 'broken') return showExam();
  if (seal?.status === 'ended') return showSummary();
  showChecklist();
}

// ═════════════════════════════════════════════════════════════
// ① 예비소집 등록
// ═════════════════════════════════════════════════════════════
function showRegister() {
  app.innerHTML = `
    <h2>① 예비소집 등록</h2>
    <p class="lead">명단에서 본인을 선택하고 등록하세요. 이 폰에 모의 신분증이 발급됩니다.</p>
    <form id="reg-form">
      ${roster.candidates.map((c) => `
        <label class="pick">
          <input type="radio" name="examNo" value="${c.examNo}" required />
          <img src="${assetUrl(c.photo)}" alt="" />
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="small">수험번호 ${c.examNo} · 좌석 ${c.seat}</span>
            <span class="small">${escapeHtml(c.venue)}</span>
          </div>
        </label>`).join('')}
      <button class="btn" type="submit" id="reg-btn" disabled>등록</button>
    </form>`;

  const form = $('#reg-form');
  form.addEventListener('change', () => ($('#reg-btn').disabled = false));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    register(findCandidate(new FormData(form).get('examNo'))).catch(showError);
  });
}

const REGISTER_STEPS = [
  { title: '기기 무결성 검증 (모의)', desc: '실제 앱에서는 Android Play Integrity / iOS App Attest로 검증합니다.' },
  { title: '기기 키 생성', desc: '이 폰에서만 쓰는 서명 키를 만듭니다. 개인키는 폰 밖으로 꺼낼 수 없습니다.' },
  { title: '모의 신분증 발급', desc: '발급기관 키로 서명합니다. (실제로는 정부 서버가 서명)' },
  { title: '기기에 저장', desc: '기기 키와 신분증을 이 폰의 IndexedDB에 저장합니다.' },
];

async function register(candidate) {
  app.innerHTML = `
    <h2>① 예비소집 등록</h2>
    <p class="lead">${escapeHtml(candidate.name)} 님의 모의 신분증을 발급하고 있습니다.</p>
    <div class="card">
      <ul class="steps">
        ${REGISTER_STEPS.map((s, i) => `
          <li>
            <span class="mark" id="step-${i}"></span>
            <div><div class="title">${s.title}</div><div class="desc">${s.desc}</div></div>
          </li>`).join('')}
      </ul>
    </div>
    <div id="reg-next"></div>`;

  let keyPair;
  let publicJwk;

  // 단계별로 실제로 하는 일
  const actions = [
    // 1. 기기 무결성 검증: 웹에서는 할 수 없어 모의로 통과 처리
    async () => {},
    // 2. 기기 키쌍 생성
    async () => {
      const created = await createDeviceKeyPair();
      keyPair = created.keyPair;
      publicJwk = created.publicJwk;
    },
    // 3. 응시자 정보 + 기기 공개키에 발급기관이 서명
    async () => {
      const signed = await issueCredential(candidate, publicJwk);
      issued = { ...signed, examNo: candidate.examNo };
    },
    // 4. 저장
    async () => {
      await dbSet('device', keyPair);
      await dbSet('credential', issued);
      await dbSet('seal', { status: 'ready' });
    },
  ];

  for (let i = 0; i < actions.length; i++) {
    const mark = $(`#step-${i}`);
    mark.className = 'mark wait';
    await sleep(500); // 단계가 눈에 보이도록 잠깐 쉼
    await actions[i]();
    mark.className = 'mark ok';
    mark.textContent = '✓';
  }

  deviceKeys = keyPair;
  credential = JSON.parse(issued.credentialText);
  seal = { status: 'ready' };

  $('#reg-next').innerHTML = '<button class="btn" id="go-check">다음: 진입 조건 확인</button>';
  $('#go-check').addEventListener('click', showChecklist);
}

// ═════════════════════════════════════════════════════════════
// ② 진입 조건 확인
// ═════════════════════════════════════════════════════════════
function showChecklist() {
  app.innerHTML = `
    <h2>② 진입 조건 확인</h2>
    <p class="lead">아래 조건을 모두 통과해야 시험 모드를 시작할 수 있습니다.</p>
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

  const passed = { network: false };
  const listeners = new AbortController(); // 화면을 떠날 때 감시를 한꺼번에 끄기 위함
  const { signal } = listeners;

  function update() {
    $('#start-btn').disabled = !passed.network;
  }

  // 네트워크: navigator.onLine 이 false 여야 통과 (비행기 모드 + 와이파이 꺼짐)
  function checkNetwork() {
    passed.network = !navigator.onLine;
    setCheck('chk-net', passed.network, passed.network ? '연결 없음 (통과)' : '비행기 모드를 켜고 와이파이를 꺼 주세요');
    update();
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
// ③ 시험 모드
// ═════════════════════════════════════════════════════════════
async function startExam() {
  // 전체화면은 '버튼을 누른 그 순간'에만 요청할 수 있어서 가장 먼저 부른다.
  requestFullscreen();

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
    showBlocker();
  }, { signal });

  // 닫기·새로고침: 브라우저가 "페이지를 나가시겠습니까?" 확인창을 띄우게 한다.
  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
  }, { signal });
}

// 가림막: 나가려는 시도를 막았다고 알려 주고 시험 화면으로 돌려보낸다.
function showBlocker() {
  let blocker = $('#blocker');
  if (!blocker) {
    blocker = document.createElement('div');
    blocker.id = 'blocker';
    blocker.className = 'blocker';
    blocker.innerHTML = `
      <div class="blocker-box">
        <strong>시험 모드 진행 중</strong>
        <p>시험이 끝날 때까지 이 화면을 나갈 수 없습니다.<br>
        다른 앱으로 나가면 봉인이 해제되고, 감독관 확인 때 해제 기록이 표시됩니다.</p>
        <button class="btn" id="blocker-close">시험 화면으로 돌아가기</button>
      </div>`;
    document.body.append(blocker);
    $('#blocker-close').addEventListener('click', () => blocker.remove());
  }
  clearTimeout(blocker.timer);
  blocker.timer = setTimeout(() => blocker.remove(), 4000); // 4초 뒤 자동으로 닫힘
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

  // 다른 앱이나 탭으로 이동
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) breakSeal('다른 앱 또는 탭으로 이동');
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
// ④ 시험 종료 (3초 길게 누르기)
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
    <h2>④ 시험 종료 · 봉인 기록</h2>
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

// 신분증 카드 (사진은 명단의 아바타)
function idCardHtml() {
  const photo = findCandidate(credential.examNo)?.photo;
  return `
    <div class="id-card">
      <div class="watermark" id="watermark"></div>
      <span class="tag">모의 신분증</span>
      ${photo ? `<img src="${assetUrl(photo)}" alt="" />` : ''}
      <dl>
        <dt>성명</dt><dd class="name">${escapeHtml(credential.name)}</dd>
        <dt>생년월일</dt><dd>${formatBirth(credential.birth)}</dd>
        <dt>수험번호</dt><dd>${credential.examNo}</dd>
        <dt>좌석</dt><dd>${escapeHtml(credential.seat)}</dd>
      </dl>
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
