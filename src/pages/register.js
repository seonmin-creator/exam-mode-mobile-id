// ─────────────────────────────────────────────────────────────
// 응시자 등록 (예비소집)
//   명단에서 응시자를 고르면 이 폰에 기기 키를 만들고,
//   발급기관 서명이 붙은 모의 신분증을 발급해 저장한다.
//   다른 응시자로 다시 등록하면 이전 등록은 덮어쓴다 (시험 중에는 불가).
// ─────────────────────────────────────────────────────────────
import { createDeviceKeyPair } from '../lib/crypto.js';
import { issueCredential } from '../lib/issuer-mock.js';
import { dbGet, dbSet } from '../lib/db.js';
import { roster, findCandidate, assetUrl, escapeHtml, $, sleep } from '../lib/util.js';

const app = $('#app');

init().catch(showError);

async function init() {
  const [issued, seal] = await Promise.all([dbGet('credential'), dbGet('seal')]);

  // 시험 모드 중(봉인 유지·해제)에는 다시 등록할 수 없다 → 기록을 지워 버리는 것을 막기 위함
  if (seal?.status === 'active' || seal?.status === 'broken') {
    app.innerHTML = `
      <h2>시험 진행 중</h2>
      <p class="lead">시험 모드가 진행 중이라 다시 등록할 수 없습니다. 응시자 화면에서 시험을 먼저 종료하세요.</p>
      <a class="btn" href="./student.html">응시자 화면으로</a>`;
    return;
  }
  showPicker(issued?.examNo);
}

function showPicker(currentExamNo) {
  const current = currentExamNo && findCandidate(currentExamNo);
  app.innerHTML = `
    <h2>예비소집 등록</h2>
    <p class="lead">명단에서 본인을 선택하고 등록하세요. 이 폰에 모의 신분증이 발급됩니다.</p>
    ${current ? `<p class="notice">현재 이 폰에는 <b>${escapeHtml(current.name)}</b>(${current.examNo}) 님이 등록되어 있습니다. 다른 응시자를 고르면 새로 등록됩니다.</p>` : ''}
    <form id="reg-form" style="margin-top:12px">
      ${roster.candidates.map((c) => `
        <label class="pick">
          <input type="radio" name="examNo" value="${c.examNo}" ${c.examNo === currentExamNo ? 'checked' : ''} required />
          <img src="${assetUrl(c.photo)}" alt="" />
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <span class="small">수험번호 ${c.examNo} · 좌석 ${c.seat}</span>
            <span class="small">${escapeHtml(c.venue)}</span>
          </div>
        </label>`).join('')}
      <button class="btn" type="submit" id="reg-btn" ${currentExamNo ? '' : 'disabled'}>등록</button>
    </form>
    ${current ? '<a class="btn secondary" href="./student.html">등록 그대로 응시자 화면으로</a>' : ''}`;

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
    <h2>예비소집 등록</h2>
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
  let issued;

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
    // 4. 저장 (봉인 상태도 '대기'로 새로 시작)
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

  $('#reg-next').innerHTML = `
    <p class="notice">등록 완료! 이제 이 폰은 <b>${escapeHtml(candidate.name)}</b> 님의 응시자 폰입니다.</p>
    <a class="btn" href="./student.html">응시자 화면으로 (시험 모드)</a>`;
}

function showError(err) {
  console.error(err);
  app.innerHTML = `<p class="notice">오류가 발생했습니다: ${escapeHtml(err?.message ?? err)}</p>`;
}
