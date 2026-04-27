import { useEffect, useRef } from 'react'
import {
  DoorNode,
  LevelNode,
  useScene,
  WallNode,
  WindowNode,
  type AnyNodeId,
} from '@pascal-app/core'

/**
 * SampleBuilding — programmatically populates Pascal's scene store with a
 * single 5m x 5m square room containing one door (south wall) and one window
 * (east wall). Hierarchy: Site -> Building -> Level -> Walls -> Door / Window.
 *
 * Uses Pascal's Zod-validated node schemas + `useScene.createNode()` API.
 * Bootstraps via `loadScene()` which lazily creates the Site/Building/Level
 * scaffold if none exists, then we layer walls/openings on top.
 *
 * React 19 strict-mode safe: a ref guards against double-creation when the
 * effect runs twice on mount.
 */
export default function SampleBuilding() {
  const populated = useRef(false)

  useEffect(() => {
    if (populated.current) return
    populated.current = true

    const scene = useScene.getState()

    // 1. Bootstrap default Site -> Building -> Level (no-op if already loaded).
    scene.loadScene()

    // 2. Locate the level Pascal just created.
    const levelEntry = Object.values(useScene.getState().nodes).find(
      (n) => n.type === 'level',
    )
    if (!levelEntry) return
    const levelId = levelEntry.id as AnyNodeId

    // If walls already exist on this level, assume we've populated already.
    const alreadyHasWalls = Object.values(useScene.getState().nodes).some(
      (n) => n.type === 'wall' && n.parentId === levelId,
    )
    if (alreadyHasWalls) return

    // 3. Build a 5m x 5m square room. Wall start/end are 2D plan coords [x, z].
    //    Walls run counter-clockwise viewed from above:
    //      south: (0,0) -> (5,0)
    //      east : (5,0) -> (5,5)
    //      north: (5,5) -> (0,5)
    //      west : (0,5) -> (0,0)
    const wallHeight = 2.5
    const wallThickness = 0.2

    const southWall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      height: wallHeight,
      thickness: wallThickness,
      children: [],
    })
    const eastWall = WallNode.parse({
      start: [5, 0],
      end: [5, 5],
      height: wallHeight,
      thickness: wallThickness,
      children: [],
    })
    const northWall = WallNode.parse({
      start: [5, 5],
      end: [0, 5],
      height: wallHeight,
      thickness: wallThickness,
      children: [],
    })
    const westWall = WallNode.parse({
      start: [0, 5],
      end: [0, 0],
      height: wallHeight,
      thickness: wallThickness,
      children: [],
    })

    const { createNode } = useScene.getState()
    createNode(southWall, levelId)
    createNode(eastWall, levelId)
    createNode(northWall, levelId)
    createNode(westWall, levelId)

    // 4. Door on south wall — wall-local: x = position along wall, y = 0
    //    (Pascal centers the door vertically based on its height).
    const door = DoorNode.parse({
      wallId: southWall.id,
      position: [2.5, 0, 0],
      width: 0.9,
      height: 2.1,
    })
    createNode(door, southWall.id)

    // 5. Window on east wall — centered, sill ~1m off the floor.
    const window_ = WindowNode.parse({
      wallId: eastWall.id,
      position: [2.5, 1.0, 0],
      width: 1.5,
      height: 1.2,
    })
    createNode(window_, eastWall.id)

    // Re-stamp level children to ensure level rendering picks up new walls.
    // (createNode already updates parents, but we also want the LevelNode
    // schema's typed children list parsed afterwards if needed.)
    void LevelNode
  }, [])

  return null
}
