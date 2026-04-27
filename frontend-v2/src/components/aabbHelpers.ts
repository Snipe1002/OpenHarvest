/**
 * AABB (axis-aligned bounding box) helpers for entity-aware snap.
 *
 * The magnet-snap logic in `houseHelpers.snapXZWithMagnet` needs to know each
 * entity's footprint on the XZ plane so it can place the dragged entity's edge
 * exactly `snap` meters from a neighbor's edge (rather than naively
 * quantizing the dragged entity's center to a grid).
 *
 * Caveats:
 *   - We DO NOT account for rotation here. Most beds / prefabs sit axis-aligned;
 *     a rotated entity will report an oversized AABB along world axes. Address
 *     rotated AABB later if it becomes a problem (would require rotating the
 *     local size and taking a world-axis bounding extent).
 *   - Polygon and unsized prefab geometries return null. Callers MUST treat
 *     null as "no AABB available" and skip those entities for magnet purposes
 *     (falling back to grid snap).
 *   - Y is ignored — snap is 2D (XZ plane) only.
 */
import type { GardenEntity } from '../api/types'

export interface AABB {
  x0: number
  x1: number
  z0: number
  z1: number
}

/**
 * Compute the world-space XZ AABB for an entity. Returns null when the
 * geometry doesn't carry enough size info to bound it (Polygon, unsized
 * Prefab, etc).
 *
 * Position fields on `transform.position` are entity centers — verified by
 * reading DemoBed where planks are placed symmetrically around `(px, pz)`.
 */
export function entityAABB(e: GardenEntity): AABB | null {
  const px = e.transform.position.x
  const pz = e.transform.position.z
  const g = e.geometry

  if (g.kind === 'Box' && g.size) {
    const w = g.size.x
    const l = g.size.z
    return { x0: px - w / 2, x1: px + w / 2, z0: pz - l / 2, z1: pz + l / 2 }
  }

  if (g.kind === 'Cylinder') {
    // radius defaults to the demo plant's 4cm stem — same as DemoGround's
    // defaultPlantGeometry. Callers that supply a different radius will get
    // the right bound; null radius gracefully falls back so we don't return
    // null for valid plant entities.
    const r = g.radius ?? 0.04
    return { x0: px - r, x1: px + r, z0: pz - r, z1: pz + r }
  }

  // Prefab with explicit size override — same shape as Box.
  if (g.size) {
    const w = g.size.x
    const l = g.size.z
    return { x0: px - w / 2, x1: px + w / 2, z0: pz - l / 2, z1: pz + l / 2 }
  }

  // Polygon, MeshRef, or unsized Prefab — caller treats as "no AABB available";
  // magnet skips it, dragger falls back to grid snap.
  return null
}
