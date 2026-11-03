import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
