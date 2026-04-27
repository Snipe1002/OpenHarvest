/**
 * WallInspectorCard — the inspector pinned above a Pascal wall when one is
 * selected via the global wall-click subscription. Mirrors the
 * gardening-entity InspectorCard's visual language (small dark pill) but
 * exposes a single Delete action plus a Close button.
 *
 * Position: above the wall's centroid + a small vertical offset so the pill
 * floats just over the top of the wall. Wall coordinates are 2D plan
 * positions (x, z) on the y=0 plane; we use the wall's `height` to lift the
 * pill to the top of the wall in world space.
 *
 * Delete uses Pascal's `useScene.getState().deleteNode(id)` (the package's
 * own scene store action, exposed in `@pascal-app/core`'s `SceneState`
 * type). After delete, we clear `selectedWallId`.
 *
 * We bypass Pascal's hierarchical SelectionManager (which requires
 * building → level → zone selection before walls become pickable) by
 * subscribing directly to `wall:click` from Pascal's emitter. See
 * `App.tsx`.
 */
import { Html } from '@react-three/drei'
import { useScene, type AnyNodeId } from '@pascal-app/core'
import { useGarden } from '../store/garden'

const PILL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 16,
  border: '1px solid #444',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
}

const ICON_BUTTON: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 13,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
}

const DELETE_BUTTON: React.CSSProperties = {
  ...ICON_BUTTON,
  background: '#5a1f1f',
  borderColor: '#8a2a2a',
}

export default function WallInspectorCard() {
  const selectedWallId = useGarden((s) => s.selectedWallId)
  const selectWall = useGarden((s) => s.selectWall)
  // Subscribe to Pascal's scene nodes so the inspector unmounts when the wall
  // is removed (whether by us, by Pascal's own tooling, or by a future undo).
  const wallNode = useScene((s) =>
    selectedWallId ? s.nodes[selectedWallId as AnyNodeId] ?? null : null,
  )

  if (!selectedWallId || !wallNode || wallNode.type !== 'wall') return null

  // Centroid of the wall's plan footprint, lifted to the wall's top.
  const cx = (wallNode.start[0] + wallNode.end[0]) / 2
  const cz = (wallNode.start[1] + wallNode.end[1]) / 2
  const height = wallNode.height ?? 2.5
  const yTop = height + 0.3

  const onDelete = () => {
    // Pascal's deleteNode handles child removal (doors / windows under the
    // wall) on its own; we just call it and clear selection.
    useScene.getState().deleteNode(selectedWallId as AnyNodeId)
    selectWall(null)
  }

  return (
    <Html
      position={[cx, yTop, cz]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'auto',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={PILL_STYLE}>
          <span style={{ fontSize: 11, padding: '0 4px', color: '#bbb' }}>Wall</span>
          <button style={DELETE_BUTTON} onClick={onDelete} title="Delete wall">
            🗑
          </button>
          <button style={ICON_BUTTON} onClick={() => selectWall(null)} title="Close">
            ✕
          </button>
        </div>
      </div>
    </Html>
  )
}
