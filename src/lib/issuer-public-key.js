// ─────────────────────────────────────────────────────────────
// 모의 발급기관 '공개키' (공개해도 안전한 키)
//
// 감독관 기기는 이 공개키만 가지고 있으면 통신 없이 신분증 진위를 확인할 수 있다.
// 개인키(d)는 여기에 절대 넣지 않는다. 감독관 화면 코드에는 개인키가 포함되지 않는다.
// (scripts/generate-issuer-key.mjs 가 issuer-key.js 와 함께 만든다)
// ─────────────────────────────────────────────────────────────

export const ISSUER_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'FEjXcuGl2z3Hx16LR_IQ8rvdnxP23R7E2IdI3gfCSPI',
  y: 'vVtgZ2yzq0meQF8az8WgHiucTDQoX4DNMCkwWUtIig8',
};
