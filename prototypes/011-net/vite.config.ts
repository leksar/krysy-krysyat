import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// ПРОТОТИП 011 — выбрасываемый. Публикуется на Pages по пути /krysy-krysyat/proto/011/
export default defineConfig({
  base: '/krysy-krysyat/proto/011/',
  server: { port: 5011 },
  build: { target: 'es2022' },
  // sim берём из исходников напрямую — без сборки пакета
  resolve: { alias: { '@krysy/sim': fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)) } },
});
