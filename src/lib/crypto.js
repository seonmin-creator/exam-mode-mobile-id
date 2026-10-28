// ─────────────────────────────────────────────────────────────
// 전자서명 도구 모음 (Web Crypto API · ECDSA P-256 · SHA-256)
//
// 전자서명의 원리 (한 줄 요약)
//   개인키로 '서명'을 만들고, 공개키로 그 서명이 맞는지 '검증'한다.
//   내용이 한 글자라도 바뀌면 검증이 실패하고,
//   개인키가 없으면 올바른 서명을 만들 수 없다.
// ─────────────────────────────────────────────────────────────
// 공개키만 불러온다. 개인키는 issuer-mock.js(등록 화면 전용)에서만 다룬다.
// → 감독관 화면 번들에는 발급기관 개인키가 들어가지 않는다.
import { ISSUER_PUBLIC_JWK } from './issuer-public-key.js';

// 키 종류: 타원곡선 P-256
const KEY_ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
// 서명 방식: ECDSA + SHA-256 해시
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' };

const encoder = new TextEncoder();

// Web Crypto는 HTTPS(또는 localhost)에서만 쓸 수 있다.
function subtle() {
  if (!window.isSecureContext || !crypto.subtle) {
    throw new Error('보안 연결(HTTPS)에서만 전자서명을 사용할 수 있습니다. https:// 주소로 접속해 주세요.');
  }
  return crypto.subtle;
}

// ── base64url: 바이트를 QR에 넣기 좋은 글자(A-Z a-z 0-9 - _)로 바꾸기 ──
export function bytesToBase64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ── 서명 / 검증 ──

// 글자(text)에 개인키로 서명하고, 서명값을 base64url 글자로 돌려준다.
export async function signText(privateKey, text) {
  const signature = await subtle().sign(SIGN_ALGO, privateKey, encoder.encode(text));
  return bytesToBase64url(new Uint8Array(signature));
}

// 공개키로 서명이 맞는지 확인한다. 맞으면 true, 틀리거나 형식이 이상하면 false.
export async function verifyText(publicKey, text, signatureB64) {
  try {
    return await subtle().verify(SIGN_ALGO, publicKey, base64urlToBytes(signatureB64), encoder.encode(text));
  } catch {
    return false;
  }
}

// 글자(text)를 SHA-256으로 요약(지문)해서 base64url 글자로 돌려준다.
export async function sha256Text(text) {
  const digest = await subtle().digest('SHA-256', encoder.encode(text));
  return bytesToBase64url(new Uint8Array(digest));
}

// ── 키 불러오기 / 만들기 ──

// JWK(JSON 형태) 공개키를 검증용 키로 불러온다.
export function importPublicKey(jwk) {
  return subtle().importKey('jwk', jwk, KEY_ALGO, false, ['verify']);
}

export function importIssuerPublicKey() {
  return importPublicKey(ISSUER_PUBLIC_JWK);
}

// JWK 개인키를 서명용 키로 불러온다. (모의 발급기관이 등록 때만 사용)
export function importSigningKey(jwk) {
  return subtle().importKey('jwk', jwk, KEY_ALGO, false, ['sign']);
}

// 응시자 기기 키쌍을 새로 만든다.
// extractable = false → 개인키는 기기 밖으로 꺼낼 수 없다(복사 불가).
// 공개키는 신분증에 넣어야 하므로 JWK로 내보낸다.
export async function createDeviceKeyPair() {
  const keyPair = await subtle().generateKey(KEY_ALGO, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await subtle().exportKey('jwk', keyPair.publicKey);
  return { keyPair, publicJwk: { kty, crv, x, y } };
}
