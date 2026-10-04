import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { licenses } from './build-tools/licenses.ts';
import { pdfjsAssets } from './build-tools/pdfjs-assets.ts';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// BASE_PATH lets the app live in a subfolder, e.g. BASE_PATH=/tools/pdf/ npm run build.
// The default './' (relative) works from any folder without rebuilding.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [svelte(), pdfjsAssets(), licenses()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: Number(process.env.PORT) || 5173 },
  // Pre-bundle the worker's dependencies up front: otherwise the dev server
  // discovers them on first save and reloads the page, losing unsaved work.
  optimizeDeps: { include: ['@cantoo/pdf-lib', '@cantoo/fontkit', 'fflate'] },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
