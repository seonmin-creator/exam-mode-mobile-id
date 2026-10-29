// ─────────────────────────────────────────────────────────────
// 감독관 카메라 QR 스캐너
//
// 왜 직접 만들었나?
//   응시자 QR에는 서명 2개·기기 공개키가 들어 있어 칸이 촘촘하다 (89×89칸).
//   html5-qrcode의 기본 스캐너는 카메라 화면을 '화면에 보이는 크기(약 280px)'로
//   줄인 뒤 해독해서, 칸 하나가 2px도 안 되어 잘 읽히지 않았다.
//   → 카메라를 고해상도로 열고, 가운데 정사각형을 '원래 해상도 그대로' 잘라 해독한다.
//
// 해독기는 html5-qrcode 안에 들어 있는 것을 그대로 쓴다 (npm 번들, 통신 없음).
//   - 안드로이드 크롬: 폰에 내장된 인식기(BarcodeDetector) → 빠르고 정확
//   - 아이폰 등 내장 인식기가 없으면: ZXing (자바스크립트 해독기)
// ─────────────────────────────────────────────────────────────
import { Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Html5QrcodeShim } from 'html5-qrcode/esm/code-decoder.js';
import { BaseLoggger } from 'html5-qrcode/esm/core.js';

const SCAN_GAP_MS = 120; // 해독 사이 쉬는 시간
const CROP = 0.9; // 화면 가운데 정사각형(짧은 변의 90%)만 해독 → 안내 테두리와 같은 영역
const MAX_SIDE = 1200; // 해독할 그림의 최대 크기 (너무 크면 느려짐)

// video: 카메라를 보여 줄 <video>, onText: QR 글자를 읽었을 때 부를 함수
export function createScanner(video, onText) {
  const decoder = new Html5QrcodeShim([Html5QrcodeSupportedFormats.QR_CODE], true, false, new BaseLoggger(false));
  const canvas = document.createElement('canvas');
  // willReadFrequently: 매번 픽셀을 읽어 가므로 CPU 캔버스로 (시험해 보니 이 설정에서 인식률이 안정적)
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let timer = null;
  let paused = false;

  async function start() {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' }, // 후면 카메라
        width: { ideal: 1920 }, // 가능한 한 높은 해상도
        height: { ideal: 1080 },
      },
    });
    video.srcObject = stream;
    // 재생 시작이 잠깐 늦거나 중단돼도 카메라는 이미 열렸으므로 오류로 보지 않는다 (autoplay가 이어서 재생)
    await video.play().catch(() => {});
    // 가까이 댔을 때 초점을 계속 맞추게 한다 (지원하는 폰만)
    const [track] = stream.getVideoTracks();
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    loop();
  }

  async function loop() {
    if (!stream) return;
    if (!paused && video.readyState >= 2) {
      const text = await scanFrame();
      if (text && !paused && stream) onText(text);
    }
    timer = setTimeout(loop, SCAN_GAP_MS);
  }

  // 지금 화면 한 장을 해독한다. 못 찾으면 null (한 장에서 못 찾는 것은 정상)
  async function scanFrame() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const side = Math.floor(Math.min(vw, vh) * CROP);
    const out = Math.min(side, MAX_SIDE);
    if (canvas.width !== out) canvas.width = canvas.height = out;
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
    try {
      return (await decoder.decodeAsync(canvas)).text;
    } catch {
      return null;
    }
  }

  function stop() {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  return {
    start,
    stop,
    pause: () => { paused = true; }, // 결과를 보여 주는 동안 새 QR을 읽지 않음
    resume: () => { paused = false; },
    get resolution() { return video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : ''; },
  };
}
