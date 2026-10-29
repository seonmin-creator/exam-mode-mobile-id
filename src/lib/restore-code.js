// ─────────────────────────────────────────────────────────────
// 잠금 복구 코드 (감독관 승인)
//
// 실수로 잠금이 풀린 응시자를 감독관이 확인하고 되돌려 주기 위한 6자리 숫자.
//   감독관: 빨간 QR(잠금 해제됨)을 스캔 → [복구 코드 만들기] → 6자리 코드를 알려 줌
//   응시자: 빨간 화면에 6자리를 입력 → 폰이 같은 계산을 해서 맞으면 잠금 복구
//
// 코드 = HMAC-SHA256(복구 비밀값, "수험번호|잠금 해제 시각") 의 앞부분을 6자리 숫자로
//   - 수험번호가 들어가므로 다른 응시자에게는 쓸 수 없다.
//   - 해제 시각(ms)이 들어가므로 그 한 번의 해제에만 쓸 수 있다. 다시 풀리면 새 코드가 필요하다.
//   - 감독관은 이 값을 '기기 서명이 확인된 QR'에서 읽으므로, 응시자가 꾸며 낸 값이 아니다.
//   - 통신 없이 양쪽 폰이 각자 계산한다.
//
// ⚠ 데모라서 복구 비밀값이 앱 안에 들어 있다 (모의 발급기관 키와 같은 이유).
//   실제 서비스에서는 감독관 인증서(감독관 기기 개인키)로 서명한 복구 승인 QR을 쓰고,
//   응시자 폰은 발급기관이 서명한 감독관 공개키로 확인한다.
// ─────────────────────────────────────────────────────────────
const RESTORE_SECRET = 'exam-mode-demo-restore-v1';

let keyPromise = null;

function restoreKey() {
  keyPromise ??= crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(RESTORE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return keyPromise;
}

// 수험번호 + 잠금 해제 시각 → "048213" 같은 6자리 코드
export async function makeRestoreCode(examNo, releasedAt) {
  const mac = await crypto.subtle.sign('HMAC', await restoreKey(), new TextEncoder().encode(`${examNo}|${releasedAt}`));
  const n = new DataView(mac).getUint32(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

// 입력한 코드가 맞는지 확인 (띄어쓰기·하이픈은 무시)
export async function checkRestoreCode(examNo, releasedAt, input) {
  const typed = String(input).replace(/\D/g, '');
  return typed.length === 6 && typed === (await makeRestoreCode(examNo, releasedAt));
}
