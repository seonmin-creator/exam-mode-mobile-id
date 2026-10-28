// ─────────────────────────────────────────────────────────────
// 응시자 등록 (예비소집)
//   1. 명단에서 응시자 선택
//   2. 증명사진 촬영 (카메라 또는 앨범, 건너뛰면 일러스트 아바타)
//   3. 기기 키 생성 → 발급기관 서명으로 모의 신분증 발급 → 이 폰에 저장
//   다른 응시자로 다시 등록하면 이전 등록은 덮어쓴다 (시험 중에는 불가).
// ─────────────────────────────────────────────────────────────
import { createDeviceKeyPair } from '../lib/crypto.js';
import { issueCredential } from '../lib/issuer-mock.js';
import { makeIdPhoto, photoHash } from '../lib/photo.js';
import { dbGet, dbSet } from '../lib/db.js';
import { roster, findCandidate, assetUrl, escapeHtml, $, sleep } from '../lib/util.js';
import { registerQuietly } from '../lib/pwa.js';

// 오프라인용 서비스 워커 등록 (이 화면에서는 업데이트 안내·자동 새로고침을 하지 않음)
registerQuietly();

const app = $('#app');

init().catch(showError);

async function init() {
  const [issued, seal] = await Promise.all([dbGet('credential'), dbGet('seal')]);

  // 시험 모드 중(봉인 유지·해제)에는 다시 등록할 수 없다 → 기록을 지워 버리는 것을 막기 위함
  if (seal?.status === 'active' || seal?.status === 'broken') {
    app.innerHTML = `
      <p class="eyebrow">응시자 등록</p>
      <h2>시험 진행 중</h2>
      <p class="lead">시험 모드가 진행 중이라 다시 등록할 수 없습니다. 응시자 화면에서 시험을 먼저 종료하세요.</p>
      <a class="btn" href="./student.html">응시자 화면으로</a>`;
    return;
  }
  showPicker(issued?.examNo);
}

// ── 1단계: 응시자 선택 ──
function showPicker(currentExamNo) {
  const current = currentExamNo && findCandidate(currentExamNo);
  app.innerHTML = `
    <p class="eyebrow">1 / 3 · 응시자 선택</p>
    <h2>예비소집 등록</h2>
    <p class="lead">명단에서 본인을 선택하세요. 이 폰에 모의 신분증이 발급됩니다.</p>
    ${current ? `<p class="notice">현재 이 폰에는 <b>${escapeHtml(current.name)}</b>(${current.examNo}) 님이 등록되어 있습니다. 다시 등록하면 새로 발급됩니다.</p>` : ''}
    <form id="reg-form">
      <div class="list">
        ${roster.candidates.map((c) => `
          <label class="pick">
            <input type="radio" name="examNo" value="${c.examNo}" required />
            <span class="radio"></span>
            <div>
              <strong>${escapeHtml(c.name)}</strong>
              <span class="small">수험번호 ${c.examNo} · 좌석 ${c.seat}</span>
              <span class="small">${escapeHtml(c.venue)}</span>
            </div>
          </label>`).join('')}
      </div>
      <button class="btn" type="submit" id="reg-btn" disabled>다음 · 증명사진</button>
    </form>
    ${current ? '<a class="btn secondary" href="./student.html">등록 그대로 응시자 화면으로</a>' : ''}`;

  const form = $('#reg-form');
  form.addEventListener('change', () => ($('#reg-btn').disabled = false));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showPhotoStep(findCandidate(new FormData(form).get('examNo')));
  });
}

// ── 2단계: 증명사진 ──
function showPhotoStep(candidate) {
  let photo = null; // 3:4로 잘라 둔 JPEG (dataURL)

  app.innerHTML = `
    <p class="eyebrow">2 / 3 · 증명사진</p>
    <h2>${escapeHtml(candidate.name)} 님 증명사진</h2>
    <p class="lead">밝은 곳에서 얼굴 정면이 잘 보이게 찍어 주세요.</p>
    <div class="photo-frame" id="photo-frame">
      <img id="photo-preview" alt="증명사진 미리보기" hidden />
      <div class="photo-empty" id="photo-empty">사진 없음</div>
    </div>
    <div class="btn-row">
      <label class="btn secondary">카메라로 촬영<input type="file" accept="image/*" capture="user" hidden /></label>
      <label class="btn secondary">앨범에서 선택<input type="file" accept="image/*" hidden /></label>
    </div>
    <p class="small center">사진은 이 폰에만 저장되며 인터넷으로 전송되지 않습니다.<br>
    신분증에는 사진 대신 사진의 지문(SHA-256)이 들어가 바꿔치기를 막습니다.</p>
    <button class="btn" id="photo-next" disabled>이 사진으로 등록</button>
    <button class="link-btn" id="photo-skip">사진 없이 일러스트로 등록</button>`;

  // 카메라·앨범 중 어느 쪽에서 사진을 고르든 같은 처리
  app.querySelectorAll('input[type=file]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = ''; // 같은 사진을 다시 골라도 반응하도록
      if (!file) return;
      try {
        photo = await makeIdPhoto(file);
      } catch {
        alert('사진을 읽을 수 없습니다. 다른 사진을 선택해 주세요.');
        return;
      }
      $('#photo-preview').src = photo;
      $('#photo-preview').hidden = false;
      $('#photo-empty').hidden = true;
      $('#photo-next').disabled = false;
    });
  });

  $('#photo-next').addEventListener('click', () => register(candidate, photo).catch(showError));
  $('#photo-skip').addEventListener('click', () => register(candidate, null).catch(showError));
}

// ── 3단계: 발급 ──
const REGISTER_STEPS = [
  { title: '기기 무결성 검증 (모의)', desc: '실제 앱에서는 Android Play Integrity / iOS App Attest로 검증합니다.' },
  { title: '기기 키 생성', desc: '이 폰에서만 쓰는 서명 키를 만듭니다. 개인키는 폰 밖으로 꺼낼 수 없습니다.' },
  { title: '모의 신분증 발급', desc: '응시자 정보·사진 지문·기기 공개키에 발급기관이 서명합니다. (실제로는 정부 서버가 서명)' },
  { title: '기기에 저장', desc: '기기 키·신분증·사진을 이 폰의 IndexedDB에 저장합니다.' },
];

async function register(candidate, photo) {
  app.innerHTML = `
    <p class="eyebrow">3 / 3 · 발급</p>
    <h2>모의 신분증 발급</h2>
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
    // 3. 응시자 정보 + 사진 지문 + 기기 공개키에 발급기관이 서명
    async () => {
      const hash = photo ? await photoHash(photo) : null;
      const signed = await issueCredential(candidate, publicJwk, hash);
      issued = { ...signed, examNo: candidate.examNo };
    },
    // 4. 저장 (봉인 상태도 '대기'로 새로 시작)
    async () => {
      await dbSet('device', keyPair);
      await dbSet('credential', issued);
      await dbSet('photo', photo);
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
    <div class="done">
      <img src="${photo ?? assetUrl(candidate.photo)}" alt="" />
      <div><strong>등록 완료</strong><span class="small">이 폰은 이제 ${escapeHtml(candidate.name)} 님의 응시자 폰입니다.</span></div>
    </div>
    <a class="btn" href="./student.html">응시자 화면으로</a>`;
}

function showError(err) {
  console.error(err);
  app.innerHTML = `<p class="notice error">오류가 발생했습니다: ${escapeHtml(err?.message ?? err)}</p>`;
}
