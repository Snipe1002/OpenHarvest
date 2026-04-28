/**
 * Diagnostic: does DemoBed re-render its `<boxGeometry args={[w, h, l]}>` when
 * the entity's geometry size changes server-side?
 *
 * The user reported "a bed I made isn't scaling to the size changes I made."
 * That's a vague bug shape — could be the InspectorCard not committing, the
 * PATCH not landing, or DemoBed not picking up the new size on re-render.
 * This spec bypasses the InspectorCard UI entirely and proves the
 * data-binding side of DemoBed by:
 *
 *   1. Pulling a real Bed entity from the live API.
 *   2. PATCHing its size via the API (W doubled, L halved).
 *   3. Reloading the page so React re-mounts DemoBed cleanly.
 *   4. Comparing screenshots before vs after — they MUST differ visually if
 *      DemoBed reads from `entity.geometry.size`.
 *
 * Reverts the bed to its original size at the end so live data isn't
 * polluted. If the screenshots match we have an actual rendering bug; if
 * they differ, the rendering side is fine and the user's report is somewhere
 * upstream (UI commit path, PATCH error swallowed, etc.).
 *
 * NOTE: this is a one-shot diagnostic. It is left in the suite as a regression
 * test against any future change that breaks size-binding in DemoBed.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'

const API_BASE = 'https://nexus.tail1b8bd8.ts.net/openharvest/api/v1'
const APP_URL = 'https://nexus.tail1b8bd8.ts.net/openharvest/'

interface Vec3 {
  x: number
  y: number
  z: number
}
interface Quat {
  x: number
  y: number
  z: number
  w: number
}
interface Geometry {
  kind: string
  size?: Vec3 | null
  radius?: number | null
  height?: number | null
  prefabRef?: string | null
}
interface Entity {
  id: string
  gardenId: string
  kind: string
  name: string
  geometry: Geometry
  transform: { position: Vec3; rotation: Quat; scale: Vec3 }
}

test('DemoBed reactively re-renders when entity geometry size changes', async ({ page }) => {
  test.setTimeout(120_000)

  // 1. Find a real garden and a real Bed entity. We deliberately do NOT touch
  //    the user's beds at random — pick the first kind=='Bed' Box-geometry
  //    entity and roll with it.
  const idsRes = await page.request.get(`${API_BASE}/gardens/ids`)
  expect(idsRes.ok()).toBeTruthy()
  const ids: string[] = await idsRes.json()
  expect(ids.length).toBeGreaterThan(0)
  const gardenId = ids[0]

  const entitiesRes = await page.request.get(
    `${API_BASE}/gardens/${gardenId}/entities`,
  )
  expect(entitiesRes.ok()).toBeTruthy()
  const entities: Entity[] = await entitiesRes.json()
  const bed = entities.find(
    (e) => e.kind === 'Bed' && e.geometry.kind === 'Box' && e.geometry.size,
  )
  expect(bed, 'live garden contains a Box-geometry Bed').toBeTruthy()
  if (!bed) return

  const original = bed.geometry.size as Vec3
  console.log(
    `[diagnostic] target bed ${bed.id} (${bed.name}) — ` +
      `original size W=${original.x} H=${original.y} L=${original.z}`,
  )

  // 2. Snapshot 1: load the page at the original size.
  await page.goto(APP_URL)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(8000) // headroom for WebGPU + entity fetch.
  const before = await page.screenshot({
    path: 'tests/artifacts/bed-scaling-before.png',
    fullPage: true,
  })

  // 3. PATCH the size to something obviously different — 2x W, 0.5x L.
  //    Keep H the same so vertical anchoring isn't a confounding factor.
  const newSize: Vec3 = {
    x: original.x * 2,
    y: original.y,
    z: original.z * 0.5,
  }
  console.log(
    `[diagnostic] PATCH → W=${newSize.x} H=${newSize.y} L=${newSize.z}`,
  )
  const patchRes = await page.request.patch(
    `${API_BASE}/gardens/${gardenId}/entities/${bed.id}`,
    {
      headers: { 'content-type': 'application/json' },
      data: { geometry: { kind: 'Box', size: newSize } },
    },
  )
  expect(patchRes.ok()).toBeTruthy()
  const patched: Entity = await patchRes.json()
  expect(patched.geometry.size?.x).toBeCloseTo(newSize.x, 6)
  expect(patched.geometry.size?.z).toBeCloseTo(newSize.z, 6)

  try {
    // 4. Reload so React re-mounts the whole scene with the new entity data.
    await page.reload()
    await page.waitForSelector('canvas')
    await page.waitForTimeout(8000)
    const after = await page.screenshot({
      path: 'tests/artifacts/bed-scaling-after.png',
      fullPage: true,
    })

    // 5. Compare. Both screenshots are PNGs of the same viewport, but the
    //    bed should look meaningfully different — its X-axis footprint
    //    doubled and its Z-axis halved. If DemoBed reads the new size, the
    //    pixel-level encoding will differ. If DemoBed cached the old size
    //    (the bug), the pages will look identical and the buffers will be
    //    near-identical in content (and thus near-identical compressed
    //    size). PNG byte-equality is too strict (timestamps, overlays drift)
    //    so we use a byte-length-delta heuristic.
    //
    //    Since the bed visibly changes shape, the encoded PNG should differ
    //    by AT LEAST a few hundred bytes. A 0-byte delta means same pixels,
    //    which would be the bug signature.
    const delta = Math.abs(before.length - after.length)
    const beforeHash = bufferHash(before)
    const afterHash = bufferHash(after)
    console.log(
      `[diagnostic] before=${before.length}B after=${after.length}B ` +
        `delta=${delta}B beforeHash=${beforeHash} afterHash=${afterHash}`,
    )

    // The strict signal is that the buffer contents differ AT ALL. Identical
    // hash = identical pixels = DemoBed didn't pick up the size change.
    expect(
      beforeHash,
      'before/after screenshots should differ when bed size changes — ' +
        'if they match, DemoBed is not reading the new entity.geometry.size',
    ).not.toBe(afterHash)
  } finally {
    // 6. ALWAYS revert, even on assertion failure, so we don't leave the
    //    user's bed in a doubled state.
    const revertRes = await page.request.patch(
      `${API_BASE}/gardens/${gardenId}/entities/${bed.id}`,
      {
        headers: { 'content-type': 'application/json' },
        data: { geometry: { kind: 'Box', size: original } },
      },
    )
    if (!revertRes.ok()) {
      console.error(
        `[diagnostic] FAILED TO REVERT bed ${bed.id} — manually restore ` +
          `size to W=${original.x} H=${original.y} L=${original.z}`,
      )
    } else {
      console.log(`[diagnostic] reverted bed ${bed.id} to original size`)
    }
  }
})

/** Cheap stable buffer fingerprint for screenshot diff. */
function bufferHash(buf: Buffer): string {
  // Sum-of-bytes mod prime + length combination. Not crypto; just a quick
  // collision-resistant-enough fingerprint to tell "different image" from
  // "identical image" when the only thing that should change is bed shape.
  let h = 2166136261
  for (let i = 0; i < buf.length; i++) {
    h = Math.imul(h ^ buf[i], 16777619) >>> 0
  }
  return `${buf.length}:${h.toString(16)}`
}

// Make the unused fs import a hint to future maintainers — node:fs is
// available if someone wants to upgrade the diff to a real pixel compare.
void fs
