// ─────────────────────────────────────────────────────────────
// 여러 화면에서 함께 쓰는 작은 도구들
// ─────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

// 시각(ms) → "08:05:12"
export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// "2008-03-14" → "2008. 3. 14."
export function formatBirth(birth) {
  const [y, m, d] = String(birth).split('-').map(Number);
  return y && m && d ? `${y}. ${m}. ${d}.` : String(birth ?? '');
}

// HTML에 글자를 넣을 때 특수문자를 안전하게 바꾸기
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export const $ = (selector) => document.querySelector(selector);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
