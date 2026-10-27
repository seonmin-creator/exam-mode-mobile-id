// ─────────────────────────────────────────────────────────────
// 증명사진 처리
//   카메라로 찍거나 앨범에서 고른 사진을 증명사진 비율(3:4)로 가운데를 잘라
//   작은 JPEG(300×400)로 만든다.
//   사진은 이 폰의 IndexedDB에만 저장되며 인터넷으로 전송하지 않는다.
// ─────────────────────────────────────────────────────────────
import { sha256Text } from './crypto.js';

const WIDTH = 300;
const HEIGHT = 400;

// 파일 → 3:4로 자른 JPEG 데이터(dataURL 글자)
export async function makeIdPhoto(file) {
  const image = await loadImage(file);
  const srcW = image.width;
  const srcH = image.height;

  // 가운데를 기준으로 3:4 영역 잘라내기
  const targetRatio = WIDTH / HEIGHT;
  let cropW = srcW;
  let cropH = srcW / targetRatio;
  if (cropH > srcH) {
    cropH = srcH;
    cropW = srcH * targetRatio;
  }
  const sx = (srcW - cropW) / 2;
  const sy = (srcH - cropH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext('2d').drawImage(image, sx, sy, cropW, cropH, 0, 0, WIDTH, HEIGHT);
  image.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// 사진 지문: 사진 데이터를 SHA-256으로 요약한 값.
// 신분증에 이 값을 넣고 발급기관이 서명하므로, 나중에 사진을 바꿔 끼우면 지문이 달라져 들통난다.
export function photoHash(dataUrl) {
  return sha256Text(dataUrl);
}

// 사진 파일 읽기 (휴대폰 사진의 회전 정보도 반영)
async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* 아래 방법으로 다시 시도 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
