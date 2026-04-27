/**
 * HouseToolbar — fixed-position top-center HTML toolbar with three buttons:
 *   "+ Wall", "+ Door", "+ Window"
 *
 * Sibling to AddToolbar (which is bottom-center for garden entities). Drives
 * Pascal's `useScene` directly to add structural geometry.
 *
 * Flow:
 *   - + Wall: tap to enter wall placement. First ground click sets the first
 *     corner (with snap applied). Second ground click creates a wall via
 *     `WallNode.parse(...)` + `createNode(wall, levelId)`. The first-corner
 *     state lives on `useGarden().housePlacement.pendingFirstCorner`.
 *   - + Door / + Window: tap to enter placement. First click on a Pascal
 *     wall mesh creates a child Door/Window node positioned at the projected
 *     hit along the wall's start→end line.
 *   - Esc cancels placement; clicking the status pill cancels too. Toolbar
 *     buttons are disabled while a placement is already active so users
 *     can't enter "double" placement mode.
 *
 * The AddToolbar sits at top:16 too — but garden placement and house
 * placement are mutually exclusive in practice (entering one cancels the
 * other via the buttons themselves). We don't enforce that in code: it's a
 * UX convention. Status pills for both are at top:16; only one is ever
 * visible at a time.
 *
 * Wall picking for door/window placement subscribes to `wall:click` from
 * Pascal's `emitter`. We deliberately bypass Pascal's strategy-based
 * SelectionManager so the user doesn't have to drill building → level →
 * zone → wall first. See `App.tsx`'s wall-click subscription.
 */
import { useEffect } from 'react'
import { type AnyNodeId, DoorNode, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { useGarden, type HousePlacementType } from '../store/garden'

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  zIndex: 10,
}

const BUTTON_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  background: 'rgba(20, 22, 24, 0.92)',
  padding: 6,
  borderRadius: 6,
  border: '1px solid #333',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
}

const BUTTON_STYLE: React.CSSProperties = {
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '6px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const STATUS_PILL: React.CSSProperties = {
  position: 'fixed',
  top: 64, // sit below the HouseToolbar buttons
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(255, 170, 0, 0.92)',
  color: '#1a1a1a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #d99a00',
  zIndex: 10,
  cursor: 'pointer',
}

function buttonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    ...BUTTON_STYLE,
    background: active ? '#5a4a1a' : BUTTON_STYLE.background,
    borderColor: active ? '#aa8a3a' : BUTTON_STYLE.border?.toString().split(' ').pop(),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function statusText(type: HousePlacementType, hasFirstCorner: boolean): string {
  if (type === 'wall') {
    return hasFirstCorner
      ? 'Click second corner (Esc to cancel)'
      : 'Click first corner (Esc to cancel)'
  }
  if (type === 'door') return 'Tap a wall to place door (Esc to cancel)'
  return 'Tap a wall to place window (Esc to cancel)'
}

export default function HouseToolbar() {
  const housePlacement = useGarden((s) => s.housePlacement)
  const setHousePlacement = useGarden((s) => s.setHousePlacement)
  const setPlacement = useGarden((s) => s.setPlacement)

  // Esc cancels placement.
  useEffect(() => {
    if (!housePlacement) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHousePlacement(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [housePlacement, setHousePlacement])

  const enter = (type: HousePlacementType) => {
    // Entering house placement cancels any garden placement so the two modes
    // can't run at once.
    setPlacement(null)
    setHousePlacement({ type, pendingFirstCorner: null })
  }

  const isPlacing = !!housePlacement
  const hasFirstCorner = !!housePlacement?.pendingFirstCorner

  return (
    <>
      {housePlacement && (
        <div
          style={STATUS_PILL}
          role="status"
          onClick={() => setHousePlacement(null)}
          title="Click to cancel"
        >
          {statusText(housePlacement.type, hasFirstCorner)}
        </div>
      )}

      <div style={BAR_STYLE}>
        <div style={BUTTON_ROW_STYLE}>
          <button
            style={buttonStyle(housePlacement?.type === 'wall', isPlacing && housePlacement?.type !== 'wall')}
            disabled={isPlacing && housePlacement?.type !== 'wall'}
            onClick={() => (housePlacement?.type === 'wall' ? setHousePlacement(null) : enter('wall'))}
          >
            + Wall
          </button>
          <button
            style={buttonStyle(housePlacement?.type === 'door', isPlacing && housePlacement?.type !== 'door')}
            disabled={isPlacing && housePlacement?.type !== 'door'}
            onClick={() => (housePlacement?.type === 'door' ? setHousePlacement(null) : enter('door'))}
          >
            + Door
          </button>
          <button
            style={buttonStyle(housePlacement?.type === 'window', isPlacing && housePlacement?.type !== 'window')}
            disabled={isPlacing && housePlacement?.type !== 'window'}
            onClick={() => (housePlacement?.type === 'window' ? setHousePlacement(null) : enter('window'))}
          >
            + Window
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Helpers used by DemoGround (wall corner placement) and the wall-click
// subscriber in App.tsx (door / window placement). Exported here so the
// "what to construct" logic stays alongside the toolbar that owns the mode.
// ---------------------------------------------------------------------------

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
