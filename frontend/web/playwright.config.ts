import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../testing/e2e',
  outputDir: '../../testing/reports/playwright-artifacts',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: '../../testing/reports/playwright-results.json' }]],
});
