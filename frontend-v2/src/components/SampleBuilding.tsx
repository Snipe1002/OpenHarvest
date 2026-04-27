/**
 * SampleBuilding — minimal scaffold to keep Pascal's Viewer rendering.
 *
 * Pascal's `<Viewer>` short-circuits and renders black if its scene has
 * no building geometry, even when our own R3F children (lights, camera,
 * ground, garden entities) are mounted. To work around that without
 * showing a placeholder room, we create ONE invisible anchor wall: 1cm
 * × 1cm × 1cm, placed at (-100, -100) on the plan grid (far outside the
 * camera's natural view of the garden plane at the origin).
 *
 * The user gets an empty-looking scene. Pascal's renderer is happy.
 * Real walls land later via house-building tooling (next milestone).
 *
 * React 19 strict-mode safe via a ref guard.
 */
import { useEffect, useRef } from 'react'
import { useScene, WallNode, type AnyNodeId } from '@pascal-app/core'

export default function SampleBuilding() {
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true

    const scene = useScene.getState()
    scene.loadScene()

    const levelEntry = Object.values(useScene.getState().nodes).find(
      (n) => n.type === 'level',
    )
    if (!levelEntry) return
    const levelId = levelEntry.id as AnyNodeId

    const alreadyHasWalls = Object.values(useScene.getState().nodes).some(
      (n) => n.type === 'wall' && n.parentId === levelId,
    )
    if (alreadyHasWalls) return

    // Single tiny anchor wall — 1cm cube far from origin. Invisible in
    // practice; satisfies Pascal's render-path requirement.
    const anchor = WallNode.parse({
      start: [-100, -100],
      end: [-99.99, -100],
      height: 0.01,
      thickness: 0.01,
      children: [],
    })
    useScene.getState().createNode(anchor, levelId)
  }, [])

  return null
}
