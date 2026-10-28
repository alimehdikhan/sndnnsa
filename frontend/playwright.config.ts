import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against the production build served by the API (`make serve`, or the
// webServer below). Locally they drive the installed Chrome; CI installs Chromium.
const PYTHON = process.env.PYTHON ?? 'python'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:8000',
    viewport: { width: 1460, height: 900 },
    trace: 'retain-on-failure',
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1460, height: 900 } } }],
  webServer: process.env.E2E_URL
    ? undefined
    : {
        // Serves frontend/dist, so build first (npm run build).
        command: `${PYTHON} -m uvicorn app.main:app --port 8000`,
        cwd: '../backend',
        url: 'http://127.0.0.1:8000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
