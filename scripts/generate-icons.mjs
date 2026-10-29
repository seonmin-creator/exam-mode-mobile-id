// ─────────────────────────────────────────────────────────────
// 앱 아이콘 만들기 (검정 배경 + 흰 방패 + 검정 체크 표시)
//   실행: node scripts/generate-icons.mjs  →  public/icons/ 에 PNG 3개 생성
//   그림 라이브러리 없이 점을 하나씩 찍어 PNG로 저장한다. (정부 로고 아님)
// ─────────────────────────────────────────────────────────────
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NAVY = [0x0b, 0x0b, 0x0b]; // 배경색 (사이트와 같은 검정)
const WHITE = [0xff, 0xff, 0xff];
const SAMPLES = 4; // 가장자리를 부드럽게: 한 점을 4×4로 나눠 평균

// 방패 크기 (아이콘 크기에 대한 비율). 안드로이드가 둥글게 잘라도 안 잘리게 가운데 80% 안에 둔다.
const SHIELD_W = 0.23;
const SHIELD_H = 0.28;

// (x, y)가 방패 안인가? x, y는 방패 기준 -1~1
function inShield(x, y) {
  const top = -1 + 0.12 * (1 - x * x); // 윗변: 가운데가 살짝 들어감
  if (y < top || y > 1) return false;
  const half = y <= 0 ? 1 : 1 - y ** 1.7; // 아래로 갈수록 좁아져 끝이 뾰족
  return Math.abs(x) <= half;
}

// 점 p와 선분 ab 사이 거리
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// 체크 표시 (방패 안쪽)
const CHECK = [[-0.45, 0.0], [-0.12, 0.33], [0.5, -0.35]];
const inCheck = (x, y) =>
  distToSegment(x, y, CHECK[0], CHECK[1]) < 0.13 || distToSegment(x, y, CHECK[1], CHECK[2]) < 0.13;

// 아이콘 한 장의 RGBA 픽셀
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let white = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // 아이콘 가운데를 (0,0)으로, 한 변을 1로 본 좌표 → 방패 좌표
          const u = (px + (sx + 0.5) / SAMPLES) / size - 0.5;
          const v = (py + (sy + 0.5) / SAMPLES) / size - 0.5;
          const x = u / SHIELD_W;
          const y = (v - 0.01) / SHIELD_H;
          if (inShield(x, y) && !inCheck(x, y)) white++;
        }
      }
      const a = white / (SAMPLES * SAMPLES);
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(NAVY[c] * (1 - a) + WHITE[c] * a);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// ── PNG 파일 형식으로 저장 ──
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 색 깊이 8비트
  header[9] = 6; // RGBA
  // 줄마다 맨 앞에 필터 0(없음)을 붙인다
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = resolve(import.meta.dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(resolve(outDir, name), encodePng(size, draw(size)));
  console.log(`public/icons/${name} (${size}px)`);
}
