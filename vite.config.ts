import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { pdfjsAssets } from './build-tools/pdfjs-assets.ts';

// BASE_PATH lets the app live in a subfolder, e.g. BASE_PATH=/tools/pdf/ npm run build.
// The default './' (relative) works from any folder without rebuilding.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [svelte(), pdfjsAssets()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
