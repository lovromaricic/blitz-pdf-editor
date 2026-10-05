// End-to-end tests in a real browser (the installed Google Chrome, so no browser download).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5199', channel: 'chrome', viewport: { width: 1280, height: 800 } },
  webServer: { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: true },
});
