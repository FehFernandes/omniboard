import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// End-to-end tests in a real browser.
//
// What can only be verified here: a real canvas (pointer events at
// coordinates), localStorage across reloads and the full cycle
// draw → reload → content still there. jsdom neither draws nor persists canvas.
//
// They run against the dev server, which Playwright itself starts (webServer).
// Only the ANONYMOUS path is covered: the logged-in flow depends on Google's
// real consent screen, which does not fit into an automated test.

/**
 * Chromium: uses whatever already exists in the Playwright cache instead of
 * requiring `npx playwright install`.
 *
 * The cache may hold revisions from other Playwright versions installed by
 * other projects; any complete binary works for these tests, which only use
 * stable APIs (click, drag, reload).
 */
function chromiumDoCache(): string | undefined {
  const base = join(homedir(), '.cache', 'ms-playwright');
  const candidatos = [
    'chromium-1148/chrome-linux/chrome',
    'chromium-1187/chrome-linux/chrome',
    'chromium-1228/chrome-linux64/chrome',
    'chromium-1228/chrome-linux/chrome',
  ];
  for (const rel of candidatos) {
    const p = join(base, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const executablePath = chromiumDoCache();

export default defineConfig({
  testDir: './e2e',
  // Canvas + persistence: one test at a time avoids contention over the
  // localStorage of the same profile and keeps failures readable.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  retries: process.env.CI ? 1 : 0,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Fixed viewport: the coordinates of the canvas drags depend on it.
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The API is not needed: the anonymous path saves to localStorage.
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
