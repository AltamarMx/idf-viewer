import { defineConfig } from '@playwright/test';

// Browser tests against the built site. Locally, PW_CHANNEL=chrome uses the
// installed Chrome instead of downloading Playwright's Chromium.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/idf-viewer/',
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/idf-viewer/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
