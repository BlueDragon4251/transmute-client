import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', timeout: 120000, workers: 1, fullyParallel: false,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  projects: [{ name: 'chromium' },{name:'firefox',use:{...devices['Desktop Firefox']}}],
  reporter: [['list'],['html',{open:'never'}]],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173/e2e/harness.html', reuseExistingServer: !process.env.CI },
    ...(!process.env.PRODUCTION_URL ? [{ command: 'PYTHONPATH=../backend DATA_DIR=/tmp/transmute-e2e WEB_DIR=dist python -m uvicorn main:create_app --factory --host 127.0.0.1 --port 9040 --no-access-log', url: 'http://127.0.0.1:9040/api/health/ready', reuseExistingServer: !process.env.CI }] : []),
  ],
})
