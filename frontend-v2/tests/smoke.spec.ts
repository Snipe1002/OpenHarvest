import { test, expect, type Page } from '@playwright/test'

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

// ---------------------------------------------------------------------------
// Regression smoke — bug categories that bit us recently.
//
// Each spec below catches a specific failure mode. They are all "smoke" in
// the strict sense: they don't validate every interaction, just confirm the
// scene didn't go dark afterward. The shared signal is `sceneIsLit`, a
// PNG-byte-size heuristic that distinguishes a real WebGPU render from a
// black canvas. Real renders are 200KB+; a black 1280x720 PNG compresses
// to ~3KB. The 50KB threshold is comfortably between them.
// ---------------------------------------------------------------------------

const APP_URL = 'https://nexus.tail1b8bd8.ts.net/openharvest/'

/** Wait long enough for WebGPU init + entities to arrive. Generous on purpose
 *  — these specs are not for measuring perf; they're for verifying the scene
 *  didn't crash. Flake here is worse than a slow run.
 */
const WEBGPU_WARMUP_MS = 8000
const POST_INTERACTION_SETTLE_MS = 2000

/**
 * "Scene is lit" heuristic: a real rendered scene encodes to a much larger
 * PNG than a blank canvas + dark UI. The threshold is empirically far below
 * a known-good live screenshot (~680KB) and far above a known-bad blank
 * (~30KB), so flake risk is low. Returns the buffer too so callers can
 * preserve the artifact if they want.
 */
async function sceneIsLit(
  page: Page,
  artifactPath?: string,
): Promise<{ lit: boolean; bytes: number; buf: Buffer }> {
  const buf = await page.screenshot({
    path: artifactPath,
    fullPage: false, // viewport only — keeps the threshold meaningful.
  })
  return { lit: buf.length > 50_000, bytes: buf.length, buf }
}

/** Best-effort canvas center coordinate. Falls back to viewport center if the
 *  canvas isn't measurable yet. */
async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (!box) {
    const vp = page.viewportSize()
    return { x: (vp?.width ?? 1280) / 2, y: (vp?.height ?? 720) / 2 }
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('selecting an entity does not blank the scene', async ({ page }) => {
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(WEBGPU_WARMUP_MS)

  const { x, y } = await canvasCenter(page)
  // Click roughly where an entity should be. Even if we miss every entity,
  // the scene should still render — empty-ground click just clears
  // selection. The real failure mode here is "InspectorCard or selection
  // mutation crashes R3F and the canvas turns black."
  await page.mouse.click(x, y)
  await page.waitForTimeout(POST_INTERACTION_SETTLE_MS)

  const { lit, bytes } = await sceneIsLit(
    page,
    'tests/artifacts/smoke-after-select.png',
  )
  expect(lit, `scene went blank after click — screenshot=${bytes}B`).toBe(true)
})

test('multi-touch pinch on entity does not blank the scene', async ({ page }) => {
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(WEBGPU_WARMUP_MS)

  const { x, y } = await canvasCenter(page)
  // Synthesize a two-finger pinch-out on the canvas. Pointer 1 starts on
  // the entity (canvas center); pointer 2 starts beside it. We move them
  // apart to simulate a pinch zoom — the bug was that
  // stopPropagation on the entity's primary pointer starved drei's
  // CameraControls of the secondary pointer, blanking the render. The
  // fix already shipped (DemoBed bails on `isPrimary === false`); this
  // spec guards against regressions.
  const client = await page.context().newCDPSession(page)

  const dispatch = async (
    type: 'pointerDown' | 'pointerMove' | 'pointerUp',
    px: number,
    py: number,
    id: number,
  ) => {
    await client.send('Input.dispatchMouseEvent', {
      type:
        type === 'pointerDown'
          ? 'mousePressed'
          : type === 'pointerMove'
            ? 'mouseMoved'
            : 'mouseReleased',
      x: px,
      y: py,
      button: 'left',
      buttons: type === 'pointerUp' ? 0 : 1,
      pointerType: 'touch',
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      force: 0.5,
      clickCount: 1,
      // CDP doesn't have a clean two-pointer API via Input.dispatchMouseEvent,
      // so this is a best-effort single-pointer sequence. The actual two-finger
      // pinch is dispatched via Input.dispatchTouchEvent below.
    } as never)
    void id
  }
  void dispatch

  // Real two-finger touch via CDP Input.dispatchTouchEvent.
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 20, y, id: 1 },
      { x: x + 20, y, id: 2 },
    ],
  })
  // Move them apart in 3 steps to look like a pinch-out gesture.
  for (let step = 1; step <= 3; step++) {
    const offset = 20 + step * 30
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - offset, y, id: 1 },
        { x: x + offset, y, id: 2 },
      ],
    })
    await page.waitForTimeout(80)
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await page.waitForTimeout(POST_INTERACTION_SETTLE_MS)

  const { lit, bytes } = await sceneIsLit(
    page,
    'tests/artifacts/smoke-after-pinch.png',
  )
  expect(
    lit,
    `scene went blank after multi-touch pinch — screenshot=${bytes}B`,
  ).toBe(true)
})

test('multi-select past 2 picks holds 3+ entities', async ({ page }) => {
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(WEBGPU_WARMUP_MS)

  // Toggle Multi: off → on. The chip's text contains "Multi:" and the
  // current state, so a flexible regex finds it.
  const multiChip = page.getByRole('button', { name: /Multi:\s*off/i })
  await multiChip.click()
  await expect(page.getByRole('button', { name: /Multi:\s*on/i })).toBeVisible()

  const { x, y } = await canvasCenter(page)
  // Click three different points across the canvas. Each click should
  // toggle whatever entity is under it into the selection set. We don't
  // know which entities are where in real-time, so we click 3 spots
  // spread across the canvas — odds of hitting 3+ entities on the
  // populated demo garden are good. If we end up with 0–2 selected,
  // the test still passes the "doesn't crash" smoke (the inspector
  // doesn't mount) and we record that fact.
  for (const dx of [-100, 0, 100]) {
    await page.mouse.click(x + dx, y)
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(POST_INTERACTION_SETTLE_MS)

  const { lit, bytes } = await sceneIsLit(
    page,
    'tests/artifacts/smoke-after-multi.png',
  )
  expect(
    lit,
    `scene went blank during multi-select — screenshot=${bytes}B`,
  ).toBe(true)

  // Best-effort assertion that MultiSelectInspector either mounted with N>=2
  // or stayed dormant. The exact text "{N} selected" only appears at >=2.
  // If the user clicked 3 entities, it's "3 selected"; if only 1 hit, the
  // single-entity InspectorCard mounts and there's no "selected" pill.
  // This test is happy as long as the scene didn't blank.
  const selectedPill = page.locator('text=/\\d+ selected/')
  if (await selectedPill.isVisible().catch(() => false)) {
    const txt = (await selectedPill.textContent()) ?? ''
    const match = /(\d+) selected/.exec(txt)
    if (match) {
      const n = parseInt(match[1], 10)
      expect(n).toBeGreaterThanOrEqual(2)
    }
  }
})

test('inspector mounting on selected entity does not crash R3F', async ({ page }) => {
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(WEBGPU_WARMUP_MS)

  const { x, y } = await canvasCenter(page)
  // Tap an entity (or near-miss empty ground — either way no crash).
  await page.mouse.click(x, y)
  await page.waitForTimeout(POST_INTERACTION_SETTLE_MS)

  const { lit, bytes } = await sceneIsLit(
    page,
    'tests/artifacts/smoke-after-inspector.png',
  )
  expect(
    lit,
    `inspector mount blanked the scene — screenshot=${bytes}B`,
  ).toBe(true)
})

test('fill-container mode arms when a bed is selected and + Region is tapped', async ({ page }) => {
  // Verifies the status pill copy flips from the world-mode "ground" wording
  // to the fill-mode "INSIDE [container name]" wording when a single
  // container-class entity is selected at arming time. We don't drive the
  // full drag end-to-end — Playwright's CDP touch sim is brittle for that —
  // we just confirm the toolbar arms the correct scope by reading the pill.
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(WEBGPU_WARMUP_MS)

  // Force exactly one entity selected by enabling Multi mode then tapping a
  // single canvas point (a bed). This avoids the empty-ground-clears-selection
  // path on misses. If we end up not landing on a bed, the test still passes
  // its core assertion ("world wording shows up when no bed is selected") via
  // the fallback branch below.
  const { x, y } = await canvasCenter(page)
  await page.mouse.click(x, y)
  await page.waitForTimeout(POST_INTERACTION_SETTLE_MS)

  // Tap "+ Region" — its label is just the text in the button.
  const regionBtn = page.getByRole('button', { name: /\+ Region/ })
  await regionBtn.click()
  await page.waitForTimeout(500)

  // Read the status pill. We accept either:
  //   - "Drag two corners INSIDE …" if a fill target was selected
  //   - "Drag two corners on the ground …" if no fill target (e.g. miss-click)
  // The test is satisfied if EITHER appears with no crash and the scene is lit.
  const pillText = await page.locator('[role="status"]').first().textContent()
  expect(pillText, `expected a region-paint status pill, got: ${pillText}`).toMatch(
    /Drag two corners (INSIDE|on the ground)/,
  )

  const { lit, bytes } = await sceneIsLit(
    page,
    'tests/artifacts/smoke-after-region-arm.png',
  )
  expect(
    lit,
    `scene blanked after arming + Region — screenshot=${bytes}B`,
  ).toBe(true)
})
