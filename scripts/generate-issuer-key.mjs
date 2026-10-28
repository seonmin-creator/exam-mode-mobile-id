// ─────────────────────────────────────────────────────────────
// 모의 발급기관 키쌍 생성 스크립트 (한 번만 실행)
//   실행: npm run make-issuer-key
//   결과: src/lib/issuer-key.js 파일이 새로 만들어짐
//
// ※ 실제 서비스에서는 발급기관 개인키가 정부 서버(보안 장비)에만 있고,
//   예비소집 등록 시 서버가 서명한다. 데모라서 브라우저 코드에 넣었다.
// ─────────────────────────────────────────────────────────────
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { subtle } = webcrypto;

// ECDSA P-256 키쌍 만들기 (내보낼 수 있게 extractable = true)
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

// JWK(JSON 형태의 키)로 내보내기
const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
const privateJwk = await subtle.exportKey('jwk', pair.privateKey);

// 필요한 항목만 남기기
const pick = (jwk, fields) => Object.fromEntries(fields.map((f) => [f, jwk[f]]));
const pub = pick(publicJwk, ['kty', 'crv', 'x', 'y']);
const priv = pick(privateJwk, ['kty', 'crv', 'x', 'y', 'd']);

const file = `// ─────────────────────────────────────────────────────────────
// 모의 발급기관 키 (scripts/generate-issuer-key.mjs 로 생성)
//
// ⚠ 실제 서비스에서는 발급기관 개인키가 정부 서버에만 있고,
//   예비소집 등록 시 서버가 서명한다. 데모라서 브라우저에 넣었다.
//
// - ISSUER_PUBLIC_JWK  : 감독관 화면이 신분증 진위를 확인할 때 사용 (공개해도 안전)
// - ISSUER_PRIVATE_JWK : 응시자 화면의 '예비소집 등록'에서만 사용 (실제로는 절대 공개 금지)
// ─────────────────────────────────────────────────────────────

export const ISSUER_PUBLIC_JWK = ${JSON.stringify(pub, null, 2)};

export const ISSUER_PRIVATE_JWK = ${JSON.stringify(priv, null, 2)};
`;

writeFileSync(new URL('../src/lib/issuer-key.js', import.meta.url), file);

// 감독관 화면용: 공개키만 담은 파일 (개인키 d 없음)
const publicFile = `// ─────────────────────────────────────────────────────────────
// 모의 발급기관 '공개키' (공개해도 안전한 키)
//
// 감독관 기기는 이 공개키만 가지고 있으면 통신 없이 신분증 진위를 확인할 수 있다.
// 개인키(d)는 여기에 절대 넣지 않는다. 감독관 화면 코드에는 개인키가 포함되지 않는다.
// (scripts/generate-issuer-key.mjs 가 issuer-key.js 와 함께 만든다)
// ─────────────────────────────────────────────────────────────

export const ISSUER_PUBLIC_JWK = ${JSON.stringify(pub, null, 2)};
`;
writeFileSync(new URL('../src/lib/issuer-public-key.js', import.meta.url), publicFile);
console.log('src/lib/issuer-key.js, src/lib/issuer-public-key.js 생성 완료');
