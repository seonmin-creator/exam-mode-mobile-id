// ─────────────────────────────────────────────────────────────
// 시연용 테스트 QR 만들기 (테스트 도구 전용)
//
// 감독관 화면이 가짜 QR을 제대로 잡아내는지 보여 주기 위한 것이다.
// 모든 QR은 이 페이지에서 새로 만든 '임시 기기 키'와 '데모 발급기관 키'로 만든다.
//   → 응시자 등록을 하지 않은 폰에서도 작동한다.
// 응시자는 명단의 첫 번째 사람(김하늘)으로 고정한다.
//
// QR 형식은 응시자 화면과 똑같다 (qr-format.js를 그대로 사용).
// ─────────────────────────────────────────────────────────────
import { createDeviceKeyPair, signText } from './crypto.js';
import { issueCredential } from './issuer-mock.js';
import { buildSignedQr, decodeQr, encodeQr } from './qr-format.js';
import { roster } from './util.js';

const OLD_QR_MS = 2 * 60 * 1000; // 오래된 QR: 2분 전
const RELEASE_REASON = '다른 앱 또는 탭으로 이동';

let ready = null; // 키와 신분증은 처음 한 번만 만든다

// 테스트에 쓸 키와 신분증을 준비한다.
function prepare() {
  ready ??= (async () => {
    const candidate = roster.candidates[0]; // 김하늘
    const device = await createDeviceKeyPair(); // 임시 기기 키 (신분증에 묶이는 키)
    const otherDevice = await createDeviceKeyPair(); // 신분증과 상관없는 다른 기기 키
    const fakeIssuer = await createDeviceKeyPair(); // 가짜 발급기관 키

    // 정상 신분증: 데모 발급기관 키로 서명
    const issued = await issueCredential(candidate, device.publicJwk);

    // 위조 신분증: 내용은 같지만 가짜 발급기관 키로 서명
    const forgedIssued = {
      credentialText: issued.credentialText,
      issuerSignature: await signText(fakeIssuer.keyPair.privateKey, issued.credentialText),
    };

    // 명단에 없는 수험번호: 발급기관 서명은 정상
    const outsiderIssued = await issueCredential({ ...candidate, examNo: '27-319999' }, device.publicJwk);

    const now = Date.now();
    return {
      candidate,
      deviceKey: device.keyPair.privateKey,
      otherDeviceKey: otherDevice.keyPair.privateKey,
      issued,
      forgedIssued,
      outsiderIssued,
      sealStart: now - 10 * 60 * 1000, // 10분 전에 시험 모드를 시작한 것으로
      releasedAt: now - 60 * 1000, // 봉인 해제 QR: 1분 전에 해제된 것으로
    };
  })();
  return ready;
}

// 봉인 유지 상태
const sealed = (k) => ({ sealStart: k.sealStart, sealed: true });

// 테스트 QR 7가지
//   refresh : true면 5초마다 지금 시각으로 다시 만든다 (감독관이 시간 초과로 오판하지 않게)
//   expect  : 감독관 화면에 나와야 하는 판정 (verify.js의 verdict)
export const TEST_CASES = [
  {
    // 기획서 시나리오: 정상 응시자 (대조군)
    id: 'normal',
    name: '정상 QR',
    mimics: '시험 모드를 지키고 있는 정상 응시자 (대조군)',
    expect: 'valid',
    expectText: '유효함',
    refresh: true,
    make: (k) => buildSignedQr({ issued: k.issued, deviceKey: k.deviceKey, seal: sealed(k) }),
  },
  {
    // 기획서 시나리오: 화면 캡처·사진으로 QR을 찍어 두었다가 나중에 다시 보여 주기
    // 서명은 모두 진짜라서, '시각' 검사만이 이것을 잡아낸다.
    id: 'old',
    name: '오래된 QR',
    mimics: '2분 전에 캡처해 둔 QR을 다시 보여 주기',
    expect: 'expired',
    expectText: '시간 초과 · 캡처 의심',
    refresh: false, // 일부러 갱신하지 않음
    make: (k) => buildSignedQr({ issued: k.issued, deviceKey: k.deviceKey, seal: sealed(k), now: Date.now() - OLD_QR_MS }),
  },
  {
    // 기획서 시나리오: 신분증 자체를 위조 (발급기관이 아닌 사람이 서명)
    // 감독관 기기에는 진짜 발급기관 '공개키'만 있으므로, 다른 키로 한 서명은 통과할 수 없다.
    id: 'forged-credential',
    name: '위조 신분증 QR',
    mimics: '가짜 발급기관 키로 서명한 신분증',
    expect: 'forgedCredential',
    expectText: '서명 불일치 · 위조 신분증',
    refresh: true,
    make: (k) => buildSignedQr({ issued: k.forgedIssued, deviceKey: k.deviceKey, seal: sealed(k) }),
  },
  {
    // 기획서 시나리오: 남의 진짜 신분증을 복사해 다른 폰에서 QR 만들기
    // 신분증 안에 적힌 기기 공개키와 맞는 개인키는 등록한 폰에만 있다 (밖으로 꺼낼 수 없음).
    id: 'forged-device',
    name: '위조 기기 서명 QR',
    mimics: '진짜 신분증을 복사해 다른 폰(다른 키)에서 만든 QR',
    expect: 'forgedQr',
    expectText: '서명 불일치 · 위조 QR',
    refresh: true,
    make: (k) => buildSignedQr({ issued: k.issued, deviceKey: k.otherDeviceKey, seal: sealed(k) }),
  },
  {
    // 기획서 시나리오: QR 속 글자를 고쳐 이름·좌석을 바꾸기 (대리 응시·자리 바꾸기)
    // 좌석은 발급기관이 서명한 신분증 안에 있으므로 '발급기관 서명' 단계에서 걸린다.
    // (payload 전체에 기기 서명도 걸려 있어서, 신분증 밖의 시각·봉인을 바꾸면 '기기 서명' 단계에서 걸린다.)
    id: 'tampered',
    name: '내용 변조 QR',
    mimics: '정상 QR의 좌석을 01번 → 07번으로 고침 (서명은 그대로)',
    expect: 'forgedCredential',
    expectText: '서명 불일치 · 위조 신분증 (발급기관 서명 단계에서 걸림)',
    refresh: true,
    make: async (k) => {
      const real = await buildSignedQr({ issued: k.issued, deviceKey: k.deviceKey, seal: sealed(k) });
      const { payloadText, deviceSignature } = decodeQr(real);
      const payload = JSON.parse(payloadText);
      const credential = JSON.parse(payload.credential);
      credential.seat = '07번'; // ← 내용만 바꾸고 서명은 손대지 않음
      payload.credential = JSON.stringify(credential);
      return encodeQr({ payloadText: JSON.stringify(payload), deviceSignature });
    },
  },
  {
    // 기획서 시나리오: 시험 중 다른 앱으로 나갔다 돌아온 응시자
    // 봉인 해제 기록도 기기 서명 안에 들어 있어서 숨기거나 지울 수 없다.
    id: 'unsealed',
    name: '봉인 해제 QR',
    mimics: '시험 중 다른 앱으로 나갔다 돌아온 응시자',
    expect: 'unsealed',
    expectText: '봉인 해제됨',
    refresh: true,
    make: (k) => buildSignedQr({
      issued: k.issued,
      deviceKey: k.deviceKey,
      seal: { sealStart: k.sealStart, sealed: false, releasedAt: k.releasedAt, releaseReason: RELEASE_REASON },
    }),
  },
  {
    // 기획서 시나리오: 진짜 신분증이지만 이 시험실 응시자가 아님 (다른 시험실·명단 외 인원)
    id: 'outsider',
    name: '명단에 없는 응시자 QR',
    mimics: '서명은 진짜지만 이 시험실 명단에 없는 수험번호 (27-319999)',
    expect: 'notInRoster',
    expectText: '명단에 없는 응시자',
    refresh: true,
    make: (k) => buildSignedQr({ issued: k.outsiderIssued, deviceKey: k.deviceKey, seal: sealed(k) }),
  },
];

// 테스트 QR 글자를 만든다.
export async function makeTestQr(testCase) {
  return testCase.make(await prepare());
}
