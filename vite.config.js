import { defineConfig } from 'vite';
import { injectIWER } from '@iwsdk/vite-plugin-iwer';

export default defineConfig({
  base: './',
  plugins: [injectIWER({ device: 'metaQuest3', activation: /^localhost$/, verbose: false })],
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', outDir: 'dist' },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
