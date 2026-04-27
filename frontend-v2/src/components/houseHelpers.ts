/**
 * House construction helpers — extracted from the old `HouseToolbar.tsx`
 * so they can be imported by both `MainToolbar.tsx` (the merged bottom
 * toolbar) and the wall-click subscriber in `App.tsx` + `DemoGround.tsx`'s
 * ground-click pipeline. The toolbar component itself is just UI glue;
 * these helpers are the actual "construct geometry" entry points and have
 * lived alongside the toolbar historically.
 */
import { type AnyNodeId, DoorNode, useScene, WallNode, WindowNode } from '@pascal-app/core'

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
