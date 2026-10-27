// ─────────────────────────────────────────────────────────────
// 모의 발급기관 (예비소집 등록 때 신분증에 서명해 주는 역할)
//
// ⚠ 실제 서비스에서는 발급기관 개인키가 정부 서버에만 있고,
//   예비소집 등록 시 서버가 서명한다. 데모라서 브라우저에 넣었다.
// ─────────────────────────────────────────────────────────────
import { importIssuerPrivateKey, signText } from './crypto.js';

// 응시자 정보 + 사진 지문 + 기기 공개키 → 발급기관 서명이 붙은 모의 신분증
// 최소 정보 원칙: 이름·생년월일·수험번호·좌석·사진 지문·기기 공개키만 담는다 (주민등록번호 등은 넣지 않음)
// 사진 자체는 넣지 않고 지문(SHA-256)만 넣는다 → QR이 작게 유지되고, 사진을 바꾸면 지문이 달라진다.
export async function issueCredential(candidate, devicePublicJwk, photoHash = null) {
  const credential = {
    name: candidate.name,
    birth: candidate.birth,
    examNo: candidate.examNo,
    seat: candidate.seat,
    photoHash, // 증명사진 지문 (사진 없이 등록하면 null)
    devicePublicKey: devicePublicJwk, // 이 신분증을 쓸 수 있는 '기기'를 묶어 두는 열쇠
  };

  // 서명은 '글자 그대로'에 대해 하므로, 글자(credentialText) 자체를 보관하고 전달한다.
  const credentialText = JSON.stringify(credential);
  const issuerKey = await importIssuerPrivateKey();
  const issuerSignature = await signText(issuerKey, credentialText);

  return { credentialText, issuerSignature };
}
