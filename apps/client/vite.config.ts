import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/krysy-krysyat/',
  server: { port: 5173 },
  build: { target: 'es2022' },
  // sim из исходников, без сборки пакета (та же физика, что на сервере)
  resolve: { alias: { '@krysy/sim': fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)) } },
});
