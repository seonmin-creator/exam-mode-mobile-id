// ─────────────────────────────────────────────────────────────
// QR 내용 만들기 / 풀기 (응시자 화면 · 감독관 화면 · 테스트 도구가 함께 쓰는 QR 형식)
//
// QR 한 장에 들어가는 것 (5초마다 새로 만듦)
//   payload = {
//     credential       : 모의 신분증(글자)        ┐ 발급기관이 서명한 부분
//     issuerSignature  : 발급기관 서명            ┘
//     time             : 지금 시각 (ms)
//     sealStart        : 봉인 시작 시각 (ms)
//     sealed           : 봉인 상태 (true/false)
//     releasedAt       : 봉인 해제 시각 (없으면 null)
//     releaseReason    : 봉인 해제 원인 (없으면 null)
//   }
//   → payload 전체를 '기기 키'로 서명 → { payload, deviceSignature }
//   → JSON을 압축(deflate) → base64url 글자로 바꿔서 QR로 그림
//
// 사진은 QR에 넣지 않는다. 감독관은 수험번호로 명단에서 사진을 불러온다.
// ─────────────────────────────────────────────────────────────
import { deflateRaw, inflateRaw } from 'pako';
import { signText, bytesToBase64url, base64urlToBytes } from './crypto.js';

// 이 시스템의 QR임을 알아보기 위한 머리말 (버전 1)
const PREFIX = 'EXM1.';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 서명된 QR 글자를 만든다.
//   issued    : { credentialText, issuerSignature }  (예비소집 때 받은 신분증)
//   deviceKey : 기기 개인키
//   seal      : { sealStart, sealed, releasedAt, releaseReason }
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
  });

  // 기기 키로 payload 전체에 서명 → 시각·봉인 상태를 몰래 바꾸면 검증 실패
  const deviceSignature = await signText(deviceKey, payloadText);
  return encodeQr({ payloadText, deviceSignature });
}

// { payloadText, deviceSignature } → QR 글자 (서명은 하지 않고 포장만 한다)
// 테스트 도구에서 '내용 변조 QR'(서명은 그대로 두고 내용만 바꾼 QR)을 만들 때도 쓴다.
export function encodeQr({ payloadText, deviceSignature }) {
  const outerText = JSON.stringify({ payload: payloadText, deviceSignature });
  const compressed = deflateRaw(encoder.encode(outerText));
  return PREFIX + bytesToBase64url(compressed);
}

// QR 글자를 풀어서 { payloadText, deviceSignature } 를 돌려준다.
// 형식이 맞지 않으면 오류를 던진다 → 감독관 화면에서 "읽을 수 없는 QR"로 표시.
export function decodeQr(qrText) {
  if (!qrText.startsWith(PREFIX)) throw new Error('이 시스템의 QR이 아닙니다');
  const bytes = inflateRaw(base64urlToBytes(qrText.slice(PREFIX.length)));
  const outer = JSON.parse(decoder.decode(bytes));
  if (typeof outer.payload !== 'string' || typeof outer.deviceSignature !== 'string') {
    throw new Error('QR 구조가 올바르지 않습니다');
  }
  return { payloadText: outer.payload, deviceSignature: outer.deviceSignature };
}
