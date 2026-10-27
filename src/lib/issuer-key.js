// ─────────────────────────────────────────────────────────────
// 모의 발급기관 키 (scripts/generate-issuer-key.mjs 로 생성)
//
// ⚠ 실제 서비스에서는 발급기관 개인키가 정부 서버에만 있고,
//   예비소집 등록 시 서버가 서명한다. 데모라서 브라우저에 넣었다.
//
// - ISSUER_PUBLIC_JWK  : 감독관 화면이 신분증 진위를 확인할 때 사용 (공개해도 안전)
// - ISSUER_PRIVATE_JWK : 응시자 화면의 '예비소집 등록'에서만 사용 (실제로는 절대 공개 금지)
// ─────────────────────────────────────────────────────────────

export const ISSUER_PUBLIC_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "FEjXcuGl2z3Hx16LR_IQ8rvdnxP23R7E2IdI3gfCSPI",
  "y": "vVtgZ2yzq0meQF8az8WgHiucTDQoX4DNMCkwWUtIig8"
};

export const ISSUER_PRIVATE_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "FEjXcuGl2z3Hx16LR_IQ8rvdnxP23R7E2IdI3gfCSPI",
  "y": "vVtgZ2yzq0meQF8az8WgHiucTDQoX4DNMCkwWUtIig8",
  "d": "DYNfvKbtIDSOxaGKZ4iWEowohDvxDUNloo4DYlp0Dek"
};
