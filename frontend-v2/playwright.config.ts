/**
 * Minimal Playwright config for OpenHarvest v2 smoke tests.
 *
 * Only chromium — we just need a screenshot and a couple of DOM assertions
 * against the deployed `https://nexus.tail1b8bd8.ts.net/openharvest/` URL.
 *
 * `ignoreHTTPSErrors: true` because nexus uses Caddy's local CA. Playwright's
 * bundled chromium doesn't trust it by default (same reason the user's
 * regular browsers need the CA installed).
 */
import { defineConfig, devices } from '@playwright/test'

// Headed Chromium with WebGPU flags so Pascal's viewer can actually
// render during smoke tests. Default headless chromium does not enable
// WebGPU, leaving the canvas black.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ignoreHTTPSErrors: true,
    trace: 'off',
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
        '--disable-vulkan-surface',
        '--use-vulkan=swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
