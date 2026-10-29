// ─────────────────────────────────────────────────────────────
// Vite 설정
//   - 페이지 5개(index, register, student, proctor, test)를 각각 만든다.
//   - basicSsl: 개발 서버를 https로 띄운다.
//     (전자서명 Web Crypto, 카메라, 화면 꺼짐 방지는 https에서만 작동하기 때문)
//   - VitePWA: 서비스 워커가 모든 페이지·파일을 미리 저장해 두어,
//     한 번 열어 두면 비행기 모드에서도 모든 페이지가 열린다.
// ─────────────────────────────────────────────────────────────
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

const page = (name) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  // 배포 주소가 https://exam.3smk.uk/ (도메인 맨 앞)이라 base는 '/'.
  // 도메인 없이 https://아이디.github.io/저장소이름/ 으로 배포한다면 '/저장소이름/' 으로 바꿔야 한다.
  base: '/',
  plugins: [
    basicSsl(),
    VitePWA({
      strategies: 'generateSW',
      // 'prompt': 새 버전이 와도 저절로 바꾸지 않고, 사용자가 [업데이트]를 눌러야 바꾼다.
      // (응시자 화면은 새로고침 = 봉인 해제이므로, 시험 중 자동 새로고침이 절대 일어나면 안 된다)
      registerType: 'prompt',
      // 등록 코드는 src/lib/pwa.js 에서 페이지마다 직접 부른다 (자동 삽입하지 않음)
      injectRegister: false,
      includeManifestIcons: false, // 아이콘은 아래 globPatterns(png)로 이미 저장됨 (중복 방지)
      manifest: {
        name: '모바일신분증 시험 모드 (모의)',
        short_name: '시험 모드',
        description: '스마트폰 반입 제한 시험장을 위한 모바일신분증 시험 모드 모의 시스템',
        lang: 'ko',
        start_url: '/index.html',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b0b0b',
        background_color: '#0b0b0b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 미리 저장할 파일: 모든 HTML·JS·CSS, 아이콘 PNG, 글꼴(woff2) (매니페스트는 자동 포함)
        globPatterns: ['**/*.{html,js,css,svg,png,woff2}'],
        // 여러 페이지 사이트이므로 모르는 주소를 index.html로 돌리지 않는다.
        // student.html은 student.html 그대로, proctor.html은 proctor.html 그대로 캐시에서 연다.
        navigateFallback: null,
        // 새 버전이 활성화되면 예전 버전 파일은 지운다
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { host: true },
  preview: { host: true },
  build: {
    rollupOptions: {
      input: {
        index: page('index'),
        register: page('register'),
        student: page('student'),
        proctor: page('proctor'),
        test: page('test'),
      },
    },
  },
});
