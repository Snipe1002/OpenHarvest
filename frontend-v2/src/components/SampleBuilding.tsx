/**
 * SampleBuilding — populates Pascal's scene store with a placeholder room.
 *
 * Pascal's `<Viewer>` requires building geometry to render: with no walls,
 * the viewer short-circuits and the canvas stays black, even with our own
 * lights and camera. So we seed a small 5×5m room (door + window) on first
 * mount.
 *
 * The user can clear these walls at runtime via the "Clear House" button —
 * see `ClearHouseButton` in the UI overlays.
 *
 * React 19 strict-mode safe: a ref guards against double-create when the
 * effect runs twice on mount.
 */
import { useEffect, useRef } from 'react'
import {
  DoorNode,
  useScene,
  WallNode,
  WindowNode,
  type AnyNodeId,
} from '@pascal-app/core'

export default function SampleBuilding() {
  const populated = useRef(false)

  useEffect(() => {
    if (populated.current) return
    populated.current = true

    const scene = useScene.getState()

    // Bootstrap Site -> Building -> Level (no-op if already loaded).
    scene.loadScene()

    const levelEntry = Object.values(useScene.getState().nodes).find(
      (n) => n.type === 'level',
    )
    if (!levelEntry) return
    const levelId = levelEntry.id as AnyNodeId

    // If walls already exist on this level, assume populated.
    const alreadyHasWalls = Object.values(useScene.getState().nodes).some(
      (n) => n.type === 'wall' && n.parentId === levelId,
    )
    if (alreadyHasWalls) return

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

    const door = DoorNode.parse({
      wallId: southWall.id,
      position: [2.5, 0, 0],
      width: 0.9,
      height: 2.1,
    })
    createNode(door, southWall.id)

    const window_ = WindowNode.parse({
      wallId: eastWall.id,
      position: [2.5, 1.0, 0],
      width: 1.5,
      height: 1.2,
    })
    createNode(window_, eastWall.id)
  }, [])

  return null
}
