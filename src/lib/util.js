// ─────────────────────────────────────────────────────────────
// 여러 화면에서 함께 쓰는 작은 도구들
// ─────────────────────────────────────────────────────────────
import roster from '../data/roster.json';

export { roster };

// 수험번호로 명단에서 응시자 찾기 (없으면 undefined)
export function findCandidate(examNo) {
  return roster.candidates.find((c) => c.examNo === examNo);
}

// public 폴더 파일 주소 (GitHub Pages처럼 하위 경로에 배포해도 맞게)
export function assetUrl(path) {
  return import.meta.env.BASE_URL + path;
}

const pad = (n) => String(n).padStart(2, '0');

// 시각(ms) → "08:05:12"
export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// "2008-03-14" → "2008. 3. 14."
export function formatBirth(birth) {
  const [y, m, d] = birth.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
}

// HTML에 글자를 넣을 때 특수문자를 안전하게 바꾸기
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export const $ = (selector) => document.querySelector(selector);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
