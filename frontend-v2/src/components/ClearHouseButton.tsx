/**
 * ClearHouseButton — removes all walls / doors / windows from Pascal's scene
 * store. The user clicks it when they want to dismiss the placeholder house.
 *
 * Pascal renders nothing if its scene has no building geometry, but the
 * Site/Building/Level scaffold (created by SampleBuilding's `loadScene()`)
 * stays in place — the viewer keeps rendering, the canvas just no longer
 * shows walls. New walls can be added later via Pascal's tooling.
 *
 * We delete leaf nodes first (doors, windows) before parent walls so the
 * store doesn't complain about orphaned children.
 */
import { useScene } from '@pascal-app/core'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 10,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 4,
  border: '1px solid #444',
  cursor: 'pointer',
}

export default function ClearHouseButton() {
  const onClick = () => {
    const scene = useScene.getState()
    const nodes = Object.values(scene.nodes)

    // Delete leaves (doors/windows) first, then walls.
    const removable = (
      [...nodes.filter((n) => n.type === 'door' || n.type === 'window'), ...nodes.filter((n) => n.type === 'wall')]
    )

    // Pascal's scene store may expose removeNode / deleteNode; try both.
    const anyScene = scene as unknown as Record<string, ((id: string) => void) | undefined>
    const remove = anyScene.removeNode ?? anyScene.deleteNode
    if (!remove) {
      console.warn('[ClearHouseButton] scene has no removeNode/deleteNode action')
      return
    }
    for (const n of removable) {
      try {
        remove(n.id)
      } catch (err) {
        console.warn('[ClearHouseButton] failed to remove', n.type, n.id, err)
      }
    }
  }

  return (
    <button style={STYLE} onClick={onClick} title="Remove the placeholder house walls">
      Clear House
    </button>
  )
}
