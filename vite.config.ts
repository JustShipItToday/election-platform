import { defineConfig } from 'vitest/config';

/** Production-only Content-Security-Policy (the dev server needs inline scripts for hot reload). */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://upload.wikimedia.org https://unitedstates.github.io",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  plugins: [
    {
      name: 'csp-meta',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<meta name="robots"', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="robots"`),
    },
  ],
  base: './',
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
