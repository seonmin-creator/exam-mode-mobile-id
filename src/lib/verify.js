// ─────────────────────────────────────────────────────────────
// QR 검증 (감독관 화면 · 테스트 도구에서 함께 사용)
//
// ★ 모든 검증은 이 기기 안에서만 한다. 네트워크 요청(fetch 등)을 쓰지 않는다.
//   감독관 기기가 미리 가진 것: ① 발급기관 공개키  ② 응시자 명단
//   이 두 가지만 있으면 통신 없이 진위·시각·봉인·명단을 모두 확인할 수 있다.
//
// 판정 순서 (하나라도 실패하면 거기서 멈추고 그 결과를 돌려준다)
//   1. QR 해독        → 이 시스템의 QR인가?
//   2. 발급기관 서명  → 신분증이 진짜인가? (위조 신분증 차단)
//   3. 기기 서명      → 등록된 그 폰이 만든 QR인가? (위조·조작 QR 차단)
//   4. 시각           → 30초 이내에 만든 QR인가? (캡처·재사용 차단)
//   5. 봉인           → 시험 모드가 풀린 적 없는가? (화면 이탈·통신 연결 적발)
//   6. 명단           → 이 시험실 응시자인가? (다른 시험실·명단 외 인원 차단)
// ─────────────────────────────────────────────────────────────
import { decodeQr } from './qr-format.js';
import { importIssuerPublicKey, importPublicKey, verifyText } from './crypto.js';
import { roster, formatTime } from './util.js';

// QR 시각과 감독관 기기 시각의 허용 차이 (30초)
export const MAX_SKEW_MS = 30_000;

// 화면에 보여 줄 확인 단계 (순서 = 판정 순서)
export const CHECKS = [
  { key: 'issuer', label: '발급기관 서명' },
  { key: 'device', label: '기기 서명' },
  { key: 'time', label: '시각' },
  { key: 'seal', label: '봉인' },
  { key: 'roster', label: '명단' },
];

// 판정 결과 종류 — level: 화면 색 (gray 회색 · red 빨강 · orange 주황 · green 초록)
export const VERDICTS = {
  unreadable: { level: 'gray', title: '읽을 수 없는 QR' },
  forgedCredential: { level: 'red', title: '서명 불일치 · 위조 신분증' },
  forgedQr: { level: 'red', title: '서명 불일치 · 위조 QR' },
  expired: { level: 'orange', title: '시간 초과 · 캡처 의심' },
  unsealed: { level: 'red', title: '봉인 해제됨' },
  notInRoster: { level: 'red', title: '명단에 없는 응시자' },
  valid: { level: 'green', title: '유효함' },
};

// QR 글자 하나를 검증한다.
//   now        : 감독관 기기의 현재 시각 (테스트할 때 바꿔 넣을 수 있음)
//   candidates : 응시자 명단 (기본값: 미리 내려받아 둔 roster)
// 돌려주는 값: { verdict, level, title, detail, checks, credential, payload, candidate, skewSeconds }
export async function verifyQr(qrText, { now = Date.now(), candidates = roster.candidates } = {}) {
  // 확인 단계별 결과: true(✓) / false(✕) / null(그 전에 멈춰서 확인 안 함)
  const checks = Object.fromEntries(CHECKS.map((c) => [c.key, null]));
  const result = (verdict, extra = {}) => ({ verdict, ...VERDICTS[verdict], detail: '', checks, ...extra });

  // ── 1. QR 해독 ──
  // 머리말 "EXM1."이 없거나, 압축·JSON 형식이 깨졌으면 이 시스템의 QR이 아니다.
  let payloadText;
  let deviceSignature;
  let payload;
  let credential;
  try {
    ({ payloadText, deviceSignature } = decodeQr(qrText));
    payload = JSON.parse(payloadText);
    credential = JSON.parse(payload.credential);
  } catch {
    return result('unreadable', { detail: '이 시스템에서 만든 QR이 아니거나 손상되었습니다.' });
  }

  // ── 2. 발급기관 서명 ──
  // 막는 것: 위조 신분증.
  // 신분증(이름·생년월일·수험번호·좌석·사진 지문·기기 공개키)에 발급기관이 서명했다.
  // 발급기관 개인키가 없으면 올바른 서명을 만들 수 없으므로,
  // 이름·수험번호를 고치거나 신분증을 새로 지어내면 여기서 걸린다.
  const issuerKey = await importIssuerPublicKey();
  checks.issuer = await verifyText(issuerKey, payload.credential, payload.issuerSignature);
  if (!checks.issuer) {
    return result('forgedCredential', { credential, detail: '발급기관이 서명한 신분증이 아닙니다.' });
  }

  // ── 3. 기기 서명 ──
  // 막는 것: 위조·조작된 QR, 다른 폰으로 옮긴 신분증.
  // QR 전체(시각·봉인 상태 포함)는 '신분증에 적힌 기기 공개키'의 짝인 기기 개인키로 서명된다.
  // 기기 개인키는 등록한 폰 밖으로 꺼낼 수 없으므로,
  // 시각·봉인 상태를 몰래 고치거나 다른 폰에서 QR을 만들면 여기서 걸린다.
  try {
    const deviceKey = await importPublicKey(credential.devicePublicKey);
    checks.device = await verifyText(deviceKey, payloadText, deviceSignature);
  } catch {
    checks.device = false;
  }
  if (!checks.device) {
    return result('forgedQr', { credential, payload, detail: '등록된 기기에서 만든 QR이 아닙니다.' });
  }

  // ── 4. 시각 ──
  // 막는 것: 화면 캡처·사진으로 찍어 둔 QR 재사용.
  // 응시자 폰은 5초마다 '지금 시각'을 넣어 새로 서명한다. 시각은 서명 안에 있어 고칠 수 없다.
  // 감독관 기기 시각과 30초 넘게 차이 나면 예전에 찍어 둔 QR로 본다.
  const skewMs = now - payload.time;
  const skewSeconds = Math.round(skewMs / 1000);
  checks.time = Math.abs(skewMs) <= MAX_SKEW_MS;
  if (!checks.time) {
    const how = skewMs > 0 ? `${skewSeconds}초 전에 만든 QR` : `${-skewSeconds}초 뒤 시각의 QR (기기 시계 확인)`;
    return result('expired', { credential, payload, skewSeconds, detail: `${how} · 허용 ${MAX_SKEW_MS / 1000}초` });
  }

  // ── 5. 봉인 ──
  // 막는 것: 시험 중 다른 앱 사용·통신 연결.
  // 응시자 폰은 화면 이탈·통신 연결·새로고침을 감지하면 봉인을 풀고, 그 사실을 QR에 넣어 서명한다.
  // 봉인 상태도 서명 안에 있으므로 숨길 수 없다.
  checks.seal = payload.sealed === true;
  if (!checks.seal) {
    return result('unsealed', {
      credential, payload, skewSeconds,
      detail: payload.releasedAt
        ? `해제 시각 ${formatTime(payload.releasedAt)} · 원인: ${payload.releaseReason ?? '알 수 없음'}`
        : '',
    });
  }

  // ── 6. 명단 ──
  // 막는 것: 진짜 신분증이지만 이 시험실 응시자가 아닌 경우(다른 시험실·명단 외 인원).
  // 감독관 기기에 미리 내려받아 둔 명단에서 수험번호를 찾는다.
  const candidate = candidates.find((c) => c.examNo === credential.examNo);
  checks.roster = Boolean(candidate);
  if (!checks.roster) {
    return result('notInRoster', {
      credential, payload, skewSeconds,
      detail: `수험번호 ${credential.examNo}는 이 시험실 명단에 없습니다.`,
    });
  }

  // ── 모두 통과 ──
  return result('valid', { credential, payload, candidate, skewSeconds });
}
