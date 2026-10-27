// ─────────────────────────────────────────────────────────────
// Vite 설정
//   - 페이지 4개(index, student, proctor, test)를 각각 만든다.
//   - basicSsl: 개발 서버를 https로 띄운다.
//     (전자서명 Web Crypto, 카메라, 화면 꺼짐 방지는 https에서만 작동하기 때문)
// ─────────────────────────────────────────────────────────────
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

const page = (name) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  // 배포 주소가 https://exam.3smk.uk/ (도메인 맨 앞)이라 base는 '/'.
  // 도메인 없이 https://아이디.github.io/저장소이름/ 으로 배포한다면 '/저장소이름/' 으로 바꿔야 한다.
  base: '/',
  plugins: [basicSsl()],
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
