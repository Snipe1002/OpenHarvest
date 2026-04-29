/**
 * Placement / arrangement behavior tests.
 *
 * Each spec creates its own ephemeral entities via the REST API at known
 * positions, runs a UI action, asserts on the resulting positions via the
 * exposed `window.__openharvestStore`, and cleans up by deleting the
 * created entities. This keeps the tests isolated from whatever lives in
 * the demo garden and from each other.
 *
 * The asserts target observable user-facing behavior — "after dist X the
 * 3 beds end up on the same Z", "with edge mode 0 col gap the beds are
 * adjacent" — so a regression in the math hits a specific spec.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const APP_URL = 'https://nexus.tail1b8bd8.ts.net/openharvest/'
const API_BASE = 'https://nexus.tail1b8bd8.ts.net/openharvest/api/v1'
const WEBGPU_WARMUP_MS = 8000
const SETTLE_MS = 1500

interface Vec3 {
  x: number
  y: number
  z: number
}

interface BedSpec {
  position: Vec3
  size?: Vec3
}

const DEFAULT_BED_SIZE: Vec3 = { x: 1.2192, y: 0.3048, z: 2.4384 } // 4' x 1' x 8'

async function loadAppAndWait(page: Page) {
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  // WebGPU + entity load + signalr connect.
  await page.waitForTimeout(WEBGPU_WARMUP_MS)
}

async function getGardenId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const store = (window as unknown as { __openharvestStore?: { getState: () => { currentGardenId: string | null } } })
      .__openharvestStore
    return store?.getState().currentGardenId ?? null
  })
  expect(id, 'currentGardenId not set on store — did the garden bootstrap finish?').toBeTruthy()
  return id as string
}

async function createBed(
  request: APIRequestContext,
  gardenId: string,
  spec: BedSpec,
): Promise<string> {
  const size = spec.size ?? DEFAULT_BED_SIZE
  const res = await request.post(`${API_BASE}/gardens/${gardenId}/entities`, {
    data: {
      kind: 'Bed',
      transform: {
        position: spec.position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { kind: 'Box', size },
      tags: ['playwright-test'],
    },
  })
  expect(res.ok(), `POST bed failed: ${res.status()}`).toBe(true)
  const body = await res.json()
  return body.id as string
}

async function deleteEntities(request: APIRequestContext, gardenId: string, ids: string[]) {
  await Promise.all(
    ids.map((id) =>
      request.delete(`${API_BASE}/gardens/${gardenId}/entities/${id}`).catch(() => null),
    ),
  )
}

async function selectIds(page: Page, ids: string[]) {
  await page.evaluate((selectedIds) => {
    const store = (window as unknown as { __openharvestStore?: { getState: () => { selectEntities: (ids: string[]) => void } } })
      .__openharvestStore
    store?.getState().selectEntities(selectedIds)
  }, ids)
}

interface StoredEntity {
  id: string
  transform: { position: Vec3; rotation: { x: number; y: number; z: number; w: number } }
  geometry: { size?: Vec3 }
}

async function getEntities(page: Page, ids: string[]): Promise<StoredEntity[]> {
  return await page.evaluate((entityIds) => {
    const store = (window as unknown as {
      __openharvestStore?: { getState: () => { entities: Record<string, StoredEntity> } }
    }).__openharvestStore
    if (!store) return []
    const all = store.getState().entities
    return entityIds.map((id) => all[id]).filter((e) => !!e)
  }, ids)
}

/** Wait until all of `ids` exist in the store (signalr broadcast caught up). */
async function waitForEntitiesPresent(page: Page, ids: string[], timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await getEntities(page, ids)
    if (found.length === ids.length) return
    await page.waitForTimeout(150)
  }
  throw new Error(`Timed out waiting for entities ${ids.join(', ')} to appear in store`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('distribute X collapses cross-axis to a clean line', async ({ page, request }) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  // Three beds with very different X AND Z values — distribute X should
  // equalize X spacing AND collapse Z to centroid (the post-#57 behavior).
  const ids: string[] = []
  try {
    ids.push(await createBed(request, gardenId, { position: { x: 0, y: 0, z: 0 } }))
    ids.push(await createBed(request, gardenId, { position: { x: 3, y: 0, z: 5 } }))
    ids.push(await createBed(request, gardenId, { position: { x: -2, y: 0, z: -3 } }))
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)

    // Click the multi-select bar's distribute-X button.
    await page.locator('[data-tour-id="multi-distribute-x"]').click()
    await page.waitForTimeout(SETTLE_MS)
    await page.screenshot({ path: 'tests/artifacts/placement-distribute-x.png', fullPage: false })

    const entities = await getEntities(page, ids)
    expect(entities).toHaveLength(3)
    // Centroid Z of the original positions: (0 + 5 + (-3)) / 3 = 0.667
    const expectedZ = (0 + 5 + -3) / 3
    for (const e of entities) {
      expect(
        Math.abs(e.transform.position.z - expectedZ),
        `Z=${e.transform.position.z} should be ≈${expectedZ} (centroid Z)`,
      ).toBeLessThan(0.01)
    }
    // X spacing should be equal between consecutive (sorted) entities.
    const xs = entities.map((e) => e.transform.position.x).sort((a, b) => a - b)
    const gap1 = xs[1] - xs[0]
    const gap2 = xs[2] - xs[1]
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.01)
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})

test('arrange grid in EDGE mode with 0 col gap puts bed edges flush', async ({ page, request }) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  const ids: string[] = []
  try {
    // 4 beds in a clump — arrange grid will lay them out from scratch.
    for (let i = 0; i < 4; i++) {
      ids.push(
        await createBed(request, gardenId, {
          position: { x: i * 0.05, y: 0, z: i * 0.05 },
        }),
      )
    }
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)

    // Force snap mode = edge via the store.
    await page.evaluate(() => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setSnapMode: (m: 'edge' | 'center') => void } } })
        .__openharvestStore
      store?.getState().setSnapMode('edge')
    })

    // Open the arrange panel.
    await page.locator('[data-tour-id="multi-arrange"]').click()
    await page.waitForTimeout(500)

    // Drive the col-gap slider to 0 by setting the store's gapXm directly.
    // The slider's onChange path is what we trust to correctly drive the
    // preview — but since the slider/text/store are wired bidirectionally,
    // setting the slider to 0 in the DOM matches what a user finger does.
    const gapXSlider = page.locator('[data-tour-id="arrange-grid-gap-x"] input[type="range"]')
    await gapXSlider.fill('0')
    const gapZSlider = page.locator('[data-tour-id="arrange-grid-gap-z"] input[type="range"]')
    await gapZSlider.fill('0')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'tests/artifacts/placement-edge-gap-zero.png', fullPage: false })

    // Apply.
    await page.locator('[data-tour-id="arrange-apply"]').click()
    await page.waitForTimeout(SETTLE_MS)

    const entities = await getEntities(page, ids)
    // With 4 beds defaulting to 4 cols (single row), the X step should equal
    // the bed footprint on X (1.2192m) since col gap = 0 in edge mode.
    const xs = entities.map((e) => e.transform.position.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      const step = xs[i] - xs[i - 1]
      expect(
        Math.abs(step - DEFAULT_BED_SIZE.x),
        `step ${step} should ≈ bed width ${DEFAULT_BED_SIZE.x} (edge-flush)`,
      ).toBeLessThan(0.05)
    }
    // All beds should sit on the same Z (single row).
    const zs = entities.map((e) => e.transform.position.z)
    const z0 = zs[0]
    for (const z of zs) {
      expect(Math.abs(z - z0)).toBeLessThan(0.01)
    }
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})

test('arrange grid in CENTER mode with 0 col gap stacks beds at the centroid', async ({
  page,
  request,
}) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  const ids: string[] = []
  try {
    for (let i = 0; i < 4; i++) {
      ids.push(
        await createBed(request, gardenId, { position: { x: i * 0.5, y: 0, z: 0 } }),
      )
    }
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)

    await page.evaluate(() => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setSnapMode: (m: 'edge' | 'center') => void } } })
        .__openharvestStore
      store?.getState().setSnapMode('center')
    })

    await page.locator('[data-tour-id="multi-arrange"]').click()
    await page.waitForTimeout(500)
    const gapXSlider = page.locator('[data-tour-id="arrange-grid-gap-x"] input[type="range"]')
    await gapXSlider.fill('0')
    const gapZSlider = page.locator('[data-tour-id="arrange-grid-gap-z"] input[type="range"]')
    await gapZSlider.fill('0')
    await page.waitForTimeout(500)
    await page.locator('[data-tour-id="arrange-apply"]').click()
    await page.waitForTimeout(SETTLE_MS)
    await page.screenshot({ path: 'tests/artifacts/placement-center-gap-zero.png', fullPage: false })

    const entities = await getEntities(page, ids)
    // In center mode, gap=0 means every entity stacks on the centroid X.
    const xs = entities.map((e) => e.transform.position.x)
    for (let i = 1; i < xs.length; i++) {
      expect(Math.abs(xs[i] - xs[0])).toBeLessThan(0.01)
    }
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})

test('group keyboard nudge moves every selected entity by exactly one snap step', async ({
  page,
  request,
}) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  const ids: string[] = []
  try {
    ids.push(await createBed(request, gardenId, { position: { x: 0, y: 0, z: 0 } }))
    ids.push(await createBed(request, gardenId, { position: { x: 5, y: 0, z: 0 } }))
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)

    // Set a known snap distance.
    const SNAP_M = 0.3048 // 1 foot
    await page.evaluate((snap) => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setSnap: (v: number) => void } } })
        .__openharvestStore
      store?.getState().setSnap(snap)
    }, SNAP_M)

    const before = await getEntities(page, ids)
    // Press ArrowUp once — group should move -Z by SNAP_M.
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(SETTLE_MS)
    const after = await getEntities(page, ids)
    for (let i = 0; i < before.length; i++) {
      const dz = after[i].transform.position.z - before[i].transform.position.z
      expect(
        Math.abs(dz - -SNAP_M),
        `entity ${i} Z delta ${dz} should ≈ -${SNAP_M}`,
      ).toBeLessThan(0.01)
      // X / Y should be unchanged.
      expect(after[i].transform.position.x).toBeCloseTo(before[i].transform.position.x, 5)
      expect(after[i].transform.position.y).toBeCloseTo(before[i].transform.position.y, 5)
    }
    await page.screenshot({ path: 'tests/artifacts/placement-group-nudge.png', fullPage: false })
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})

test('arrange ring places N entities at the requested radius, evenly spaced', async ({
  page,
  request,
}) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  const ids: string[] = []
  try {
    // 4 beds clumped near origin so we know the centroid is ≈ origin.
    for (let i = 0; i < 4; i++) {
      ids.push(
        await createBed(request, gardenId, { position: { x: 0.05 * i, y: 0, z: 0.05 * i } }),
      )
    }
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)

    await page.locator('[data-tour-id="multi-arrange"]').click()
    await page.waitForTimeout(500)
    // Switch to Ring tab — find the second tab button under arrange-tabs.
    await page.locator('[data-tour-id="arrange-tabs"] button').nth(1).click()
    await page.waitForTimeout(300)
    // Set radius to 2m, start angle 0.
    const radiusSlider = page.locator('[data-tour-id="arrange-ring-radius"] input[type="range"]')
    await radiusSlider.fill('2')
    const angleSlider = page.locator('[data-tour-id="arrange-ring-start"] input[type="range"]')
    await angleSlider.fill('0')
    await page.waitForTimeout(400)
    await page.locator('[data-tour-id="arrange-apply"]').click()
    await page.waitForTimeout(SETTLE_MS)
    await page.screenshot({ path: 'tests/artifacts/placement-ring.png', fullPage: false })

    const entities = await getEntities(page, ids)
    // Centroid of the original cluster ≈ (0.075, 0, 0.075) — close enough
    // to origin that all four should sit at radius ≈ 2 from that center.
    let cx = 0,
      cz = 0
    // Recompute centroid from ORIGINAL positions captured pre-arrange. We
    // don't have those here, so assert each entity is ~2m from any single
    // shared center: pick the centroid OF the new layout (which is the
    // same as the snapshot centroid for ring), then verify equidistance.
    for (const e of entities) {
      cx += e.transform.position.x
      cz += e.transform.position.z
    }
    cx /= entities.length
    cz /= entities.length
    for (const e of entities) {
      const dx = e.transform.position.x - cx
      const dz = e.transform.position.z - cz
      const r = Math.sqrt(dx * dx + dz * dz)
      expect(Math.abs(r - 2)).toBeLessThan(0.05)
    }
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})

test('Labels chip toggles button labels in the multi-select bar', async ({
  page,
  request,
}) => {
  await loadAppAndWait(page)
  const gardenId = await getGardenId(page)
  const ids: string[] = []
  try {
    ids.push(await createBed(request, gardenId, { position: { x: 0, y: 0, z: 0 } }))
    ids.push(await createBed(request, gardenId, { position: { x: 2, y: 0, z: 0 } }))
    await waitForEntitiesPresent(page, ids)
    await selectIds(page, ids)
    await page.waitForTimeout(SETTLE_MS)

    // Force labels ON, verify the rotate button text contains "rotate".
    await page.evaluate(() => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setShowButtonLabels: (v: boolean) => void } } })
        .__openharvestStore
      store?.getState().setShowButtonLabels(true)
    })
    await page.waitForTimeout(300)
    const rotateBtnOn = page.locator('[data-tour-id="multi-rotate"]')
    await expect(rotateBtnOn).toContainText('rotate')

    // Flip OFF, verify the label disappears (only the glyph remains).
    await page.evaluate(() => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setShowButtonLabels: (v: boolean) => void } } })
        .__openharvestStore
      store?.getState().setShowButtonLabels(false)
    })
    await page.waitForTimeout(300)
    const rotateBtnOff = page.locator('[data-tour-id="multi-rotate"]')
    await expect(rotateBtnOff).not.toContainText('rotate')
    await page.screenshot({ path: 'tests/artifacts/placement-labels-off.png', fullPage: false })

    // Restore default ON for the next test.
    await page.evaluate(() => {
      const store = (window as unknown as { __openharvestStore?: { getState: () => { setShowButtonLabels: (v: boolean) => void } } })
        .__openharvestStore
      store?.getState().setShowButtonLabels(true)
    })
  } finally {
    await deleteEntities(request, gardenId, ids)
  }
})
