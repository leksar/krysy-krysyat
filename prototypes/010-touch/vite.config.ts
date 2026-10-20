import { defineConfig } from 'vite';

// ПРОТОТИП 010 — выбрасываемый. Публикуется на Pages по пути /krysy-krysyat/proto/010/
export default defineConfig({
  base: '/krysy-krysyat/proto/010/',
  server: { port: 5010 },
  build: { target: 'es2022' },
});
