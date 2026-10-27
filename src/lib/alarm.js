// ─────────────────────────────────────────────────────────────
// 경고음 (Web Audio API로 소리를 직접 만들어서 소리 파일·인터넷이 필요 없음)
//
// 브라우저는 '사용자가 화면을 누른 뒤'에만 소리를 허락하므로,
// 시험 모드 시작 버튼을 누를 때 unlockAlarm()을 불러 미리 소리를 켜 둔다.
// ─────────────────────────────────────────────────────────────
let audio = null;

export function unlockAlarm() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch { /* 소리 미지원 */ }
}

// 삐-뽀-삐-뽀 경고음 (약 1.2초) + 진동(지원하는 폰만)
export function playAlarm() {
  navigator.vibrate?.([200, 100, 200, 100, 200]);
  if (!audio) return;
  audio.resume();
  const start = audio.currentTime;
  for (let i = 0; i < 6; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = i % 2 ? 660 : 990; // 높은 음·낮은 음 번갈아
    gain.gain.value = 0.25;
    osc.connect(gain).connect(audio.destination);
    osc.start(start + i * 0.2);
    osc.stop(start + i * 0.2 + 0.18);
  }
}
