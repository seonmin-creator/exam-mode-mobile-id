// ─────────────────────────────────────────────────────────────
// QR 내용 만들기 / 풀기 (응시자 화면 · 감독관 화면 · 테스트 도구가 함께 쓰는 QR 형식)
//
// QR 한 장에 들어가는 것 (15초마다 새로 만듦 · 감독관은 30초 넘은 QR을 시간 초과로 판정)
//   payload = {
//     credential       : 모의 신분증(글자)        ┐ 발급기관이 서명한 부분
//     issuerSignature  : 발급기관 서명            ┘
//     time             : 지금 시각 (ms)
//     sealStart        : 잠금 시작 시각 (ms)
//     sealed           : 잠금 상태 (true/false)
//     releasedAt       : 잠금 해제 시각 (없으면 null)
//     releaseReason    : 잠금 해제 원인 (없으면 null)
//     restoreCount     : 감독관이 잠금을 복구해 준 횟수 (복구한 적이 있을 때만)
//     restoredAt       : 마지막 복구 시각 (복구한 적이 있을 때만)
//   }
//   → payload 전체를 '기기 키'로 서명 → { payload, deviceSignature }
//   → JSON을 '사전 압축' → base45 글자로 바꿔서 QR로 그림  (머리말 "EXM2.")
//
// QR을 작게(칸을 크게) 만드는 두 가지 방법 — 서명이 걸린 글자 자체는 전혀 바꾸지 않는다.
//   ① 사전 압축: 매번 똑같이 들어가는 항목 이름("credential", "devicePublicKey" 등)을
//      압축할 때와 풀 때 양쪽이 미리 알고 있게 해서, 그 부분을 거의 0바이트로 줄인다.
//   ② base45: QR의 '영숫자 모드'(대문자·숫자·일부 기호)는 글자 하나를 5.5비트로 담아
//      일반 글자(8비트)보다 촘촘하다. 유럽 코로나 백신 증명서 QR이 쓰는 방식과 같다.
//   → 97×97칸(EXM1) → 약 69×69칸. 칸 하나가 커져 카메라가 훨씬 잘 읽는다.
//
// 사진은 QR에 넣지 않는다 (사진 지문만 신분증에 서명). 감독관은 응시자 화면의 사진과 얼굴을 대조한다.
// ─────────────────────────────────────────────────────────────
import { deflateRaw, inflateRaw } from 'pako';
import { signText, base64urlToBytes } from './crypto.js';

// 이 시스템의 QR임을 알아보기 위한 머리말
const PREFIX = 'EXM2.'; // 현재 형식: 사전 압축 + base45
const PREFIX_V1 = 'EXM1.'; // 예전 형식: 일반 압축 + base64url (읽기만 지원)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 압축 사전: QR에 늘 들어가는 글자 모양을 미리 적어 둔 것.
// ⚠ 한 글자라도 바꾸면 예전에 만든 QR을 풀 수 없으므로 고치지 말 것.
const DICTIONARY = encoder.encode(JSON.stringify({
  payload: JSON.stringify({
    credential: JSON.stringify({
      name: '', birth: '20', examName: '학년도 학기 고사', examNo: '', venue: '고등학교 학년 반 교실', seat: '번',
      photoHash: '', devicePublicKey: { kty: 'EC', crv: 'P-256', x: '', y: '' },
    }),
    issuerSignature: '', time: 17, sealStart: 17, sealed: true, releasedAt: null, releaseReason: null,
  }),
  deviceSignature: '',
}));

// 서명된 QR 글자를 만든다.
//   issued    : { credentialText, issuerSignature }  (예비소집 때 받은 신분증)
//   deviceKey : 기기 개인키
//   seal      : { sealStart, sealed, releasedAt, releaseReason, restoreCount?, restoredAt? }
//   now       : QR에 넣을 시각 (기본값: 지금) — 테스트 도구에서 '오래된 QR'을 만들 때 바꿔 씀
export async function buildSignedQr({ issued, deviceKey, seal, now = Date.now() }) {
  const payloadText = JSON.stringify({
    credential: issued.credentialText,
    issuerSignature: issued.issuerSignature,
    time: now,
    sealStart: seal.sealStart,
    sealed: seal.sealed,
    releasedAt: seal.releasedAt ?? null,
    releaseReason: seal.releaseReason ?? null,
    // 감독관이 잠금을 복구해 준 적이 있으면 그 횟수와 마지막 시각 (기기 서명 안에 들어가 숨길 수 없음)
    ...(seal.restoreCount ? { restoreCount: seal.restoreCount, restoredAt: seal.restoredAt } : {}),
  });

  // 기기 키로 payload 전체에 서명 → 시각·잠금 상태를 몰래 바꾸면 검증 실패
  const deviceSignature = await signText(deviceKey, payloadText);
  return encodeQr({ payloadText, deviceSignature });
}

// { payloadText, deviceSignature } → QR 글자 (서명은 하지 않고 포장만 한다)
// 테스트 도구에서 '내용 변조 QR'(서명은 그대로 두고 내용만 바꾼 QR)을 만들 때도 쓴다.
export function encodeQr({ payloadText, deviceSignature }) {
  const outerText = JSON.stringify({ payload: payloadText, deviceSignature });
  const compressed = deflateRaw(encoder.encode(outerText), { level: 9, dictionary: DICTIONARY });
  return PREFIX + toBase45(compressed);
}

// QR 글자를 풀어서 { payloadText, deviceSignature } 를 돌려준다.
// 형식이 맞지 않으면 오류를 던진다 → 감독관 화면에서 "읽을 수 없는 QR"로 표시.
export function decodeQr(qrText) {
  let bytes;
  if (qrText.startsWith(PREFIX)) {
    bytes = inflateRaw(fromBase45(qrText.slice(PREFIX.length)), { dictionary: DICTIONARY });
  } else if (qrText.startsWith(PREFIX_V1)) {
    bytes = inflateRaw(base64urlToBytes(qrText.slice(PREFIX_V1.length)));
  } else {
    throw new Error('이 시스템의 QR이 아닙니다');
  }
  if (!bytes) throw new Error('QR을 풀 수 없습니다');
  const outer = JSON.parse(decoder.decode(bytes));
  if (typeof outer.payload !== 'string' || typeof outer.deviceSignature !== 'string') {
    throw new Error('QR 구조가 올바르지 않습니다');
  }
  return { payloadText: outer.payload, deviceSignature: outer.deviceSignature };
}

// ── base45 (RFC 9285): 2바이트를 45진수 3글자로 ──
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function toBase45(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
    } else {
      out += B45[bytes[i] % 45] + B45[Math.floor(bytes[i] / 45)];
    }
  }
  return out;
}

function fromBase45(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 3) {
    const digits = [...text.slice(i, i + 3)].map((ch) => {
      const v = B45.indexOf(ch);
      if (v < 0) throw new Error('base45 글자가 아닙니다');
      return v;
    });
    if (digits.length === 3) {
      const n = digits[0] + digits[1] * 45 + digits[2] * 2025;
      if (n > 0xffff) throw new Error('base45 값이 올바르지 않습니다');
      out.push(n >> 8, n & 0xff);
    } else if (digits.length === 2) {
      const n = digits[0] + digits[1] * 45;
      if (n > 0xff) throw new Error('base45 값이 올바르지 않습니다');
      out.push(n);
    } else {
      throw new Error('base45 길이가 올바르지 않습니다');
    }
  }
  return new Uint8Array(out);
}
