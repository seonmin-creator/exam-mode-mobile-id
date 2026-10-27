// ─────────────────────────────────────────────────────────────
// IndexedDB 저장소 (브라우저 안의 작은 데이터베이스)
//
// 저장하는 것 (키 → 값)
//   'device'     → 기기 키쌍 (CryptoKey 그대로 저장, 개인키는 꺼낼 수 없음)
//   'credential' → 발급받은 모의 신분증 { credentialText, issuerSignature, examNo }
//   'seal'       → 봉인 상태 { status, sealStart, releasedAt, releaseReason, endedAt }
//                  status: 'ready'(대기) | 'active'(봉인 중) | 'broken'(해제됨) | 'ended'(종료)
// ─────────────────────────────────────────────────────────────
const DB_NAME = 'exam-mode-db';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 저장소 하나를 열어 작업(fn)을 하고 끝날 때까지 기다린다.
async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const dbGet = (key) => withStore('readonly', (store) => store.get(key));
export const dbSet = (key, value) => withStore('readwrite', (store) => store.put(value, key));
export const dbClear = () => withStore('readwrite', (store) => store.clear());
