/**
 * House construction helpers — extracted from the old `HouseToolbar.tsx`
 * so they can be imported by both `MainToolbar.tsx` (the merged bottom
 * toolbar) and the wall-click subscriber in `App.tsx` + `DemoGround.tsx`'s
 * ground-click pipeline. The toolbar component itself is just UI glue;
 * these helpers are the actual "construct geometry" entry points and have
 * lived alongside the toolbar historically.
 */
import { type AnyNodeId, DoorNode, useScene, WallNode, WindowNode } from '@pascal-app/core'
import type { AABB } from './aabbHelpers'

function findLevelId(): AnyNodeId | null {
  const nodes = Object.values(useScene.getState().nodes)
  const level = nodes.find((n) => n.type === 'level')
  return level ? (level.id as AnyNodeId) : null
}

/**
 * Apply snap to an arbitrary world coordinate pair. Mirrors the same
 * quantization useTranslateDrag uses so wall corners land on the same grid
 * as dragged entities.
 */
export function snapXZ(x: number, z: number, snap: number | null): [number, number] {
  if (!snap) return [x, z]
  return [Math.round(x / snap) * snap, Math.round(z / snap) * snap]
}

/**
 * Edge-relative magnet snap for entity translate drags.
 *
 * For each axis (X and Z) independently, compute candidate positions that
 * place the dragged entity's edge exactly `snap` meters from a neighbor's
 * edge. If the closest candidate is within MAGNET_RANGE of the raw pointer
 * position on that axis, snap to it; otherwise fall back to grid snap
 * (multiples of `snap`, the prior behavior).
 *
 * This fixes the overlap bug from plain grid snap: with `snap=1m` and two
 * 4-foot (~1.22m) beds, plain grid snap puts centers 1m apart while edges
 * span ±0.61m → overlap. Magnet snap places edges 1m apart instead, leaving
 * a 1m gap.
 *
 * Special cases:
 *   - `snap === null`: snap fully off, returns raw position (no magnet).
 *   - `snap === 0`: edges TOUCH (zero gap). The candidate formula
 *     `n.x1 + 0 + myHalfWidth` still works; we still magnet to neighbors,
 *     but skip the grid-snap fallback (no quantization grid at 0m).
 *
 * @param rawX           Raw raycast hit X (meters).
 * @param rawZ           Raw raycast hit Z (meters).
 * @param myHalfWidth    Half size on world X axis of the dragged entity.
 * @param myHalfDepth    Half size on world Z axis of the dragged entity.
 * @param snap           Snap distance (gap between edges) or null for off.
 * @param neighbors      AABBs of OTHER entities to magnet to. Caller filters.
 */
export function snapXZWithMagnet(
  rawX: number,
  rawZ: number,
  myHalfWidth: number,
  myHalfDepth: number,
  snap: number | null,
  neighbors: AABB[],
): [number, number] {
  // No snap at all — pure free movement.
  if (snap === null) return [rawX, rawZ]

  // Default fallback: grid snap to multiples of `snap`. Skip when snap===0
  // because a 0-meter grid would divide by zero.
  let bestX = snap > 0 ? Math.round(rawX / snap) * snap : rawX
  let bestZ = snap > 0 ? Math.round(rawZ / snap) * snap : rawZ
  let bestDX = Math.abs(rawX - bestX)
  let bestDZ = Math.abs(rawZ - bestZ)

  // Magnet range: how close raw-X must be to a neighbor candidate to take it.
  // - 1.5× snap so a small gap dominates the grid candidate when it should
  // - my half-size so a wide bed magnets across its own footprint
  // - 0.3m floor so snap=0 (edges touch) still attracts within a sane window
  const MAGNET_RANGE = Math.max(snap * 1.5, myHalfWidth, myHalfDepth, 0.3)

  for (const n of neighbors) {
    // X-axis: my entity sits to the +X (right) of neighbor → my left edge
    // = neighbor's right edge + snap. Or to the -X (left), with the
    // mirrored relation. In both cases my CENTER must be at:
    const cxRight = n.x1 + snap + myHalfWidth
    const cxLeft = n.x0 - snap - myHalfWidth
    for (const cx of [cxRight, cxLeft]) {
      const d = Math.abs(rawX - cx)
      if (d < MAGNET_RANGE && d < bestDX) {
        bestX = cx
        bestDX = d
      }
    }
    // Z-axis: same reasoning along world Z.
    const czFar = n.z1 + snap + myHalfDepth
    const czNear = n.z0 - snap - myHalfDepth
    for (const cz of [czFar, czNear]) {
      const d = Math.abs(rawZ - cz)
      if (d < MAGNET_RANGE && d < bestDZ) {
        bestZ = cz
        bestDZ = d
      }
    }
  }

  return [bestX, bestZ]
}

/**
 * Create a wall between two ground-plan corners (XZ). Returns the new wall's
 * id, or null if there's no level node to attach to.
 */
export function createWallBetween(
  start: [number, number],
  end: [number, number],
): AnyNodeId | null {
  const levelId = findLevelId()
  if (!levelId) return null
  const wall = WallNode.parse({
    start,
    end,
    height: 2.5,
    thickness: 0.2,
    children: [],
  })
  useScene.getState().createNode(wall, levelId)
  return wall.id as AnyNodeId
}

/**
 * Create a Door child of an existing wall. `localX` is the door's offset
 * along the wall's start→end direction in meters (Pascal's DoorNode position
 * is relative to the wall in [x, y, z] form; y=0 keeps the door on the
 * floor). Returns the new door's id, or null if the wall isn't found.
 */
export function createDoorOnWall(wallId: string, localX: number): AnyNodeId | null {
  const nodes = useScene.getState().nodes
  if (!nodes[wallId as AnyNodeId]) return null
  const door = DoorNode.parse({
    position: [localX, 0, 0],
  })
  useScene.getState().createNode(door, wallId as AnyNodeId)
  return door.id as AnyNodeId
}

/**
 * Create a Window child of an existing wall. Same convention as
 * createDoorOnWall — `localX` is along the wall, but the window's y is set
 * to 1.0m (sill height) so windows don't sit on the floor.
 */
export function createWindowOnWall(wallId: string, localX: number): AnyNodeId | null {
  const nodes = useScene.getState().nodes
  if (!nodes[wallId as AnyNodeId]) return null
  const win = WindowNode.parse({
    position: [localX, 1.0, 0],
  })
  useScene.getState().createNode(win, wallId as AnyNodeId)
  return win.id as AnyNodeId
}
