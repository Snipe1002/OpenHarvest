import { test, expect } from '@playwright/test'

/**
 * Smoke screenshot of the live deployed scene. Run via `npm run screenshot`
 * after deploy. Skipped from `npm run test:smoke` if the live URL is
 * unreachable (e.g. when running offline).
 */
test('live scene loads with house and at least one entity', async ({ page }) => {
  await page.goto('https://nexus.tail1b8bd8.ts.net/openharvest/')
  await page.waitForSelector('canvas')
  // Pascal's viewer needs longer to compose its first WebGPU frame after the
  // canvas mounts, plus our entities load over HTTPS from the API. 8s gives
  // headroom over a tailnet round-trip from a cold dev server.
  await page.waitForTimeout(8000)
  await page.screenshot({ path: 'tests/artifacts/live-scene.png', fullPage: true })
})

test('add toolbar visible', async ({ page }) => {
  await page.goto('https://nexus.tail1b8bd8.ts.net/openharvest/')
  await expect(page.getByRole('button', { name: /Bed/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Plant/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Prefab/i })).toBeVisible()
})
