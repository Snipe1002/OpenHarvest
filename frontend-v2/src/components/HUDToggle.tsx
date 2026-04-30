/**
 * HUDToggle — small fixed-position bar at the top-RIGHT of the viewport
 * with two icons: collapse/expand the entire HUD, and toggle the ground
 * grid. Stays visible even when the rest of the HUD is collapsed so the
 * user can always summon everything back.
 *
 * Sits at top:16, right:16. The InspectorCard mounts at the same anchor
 * when an entity is selected, so this toggle sits ABOVE / OFFSET from
 * it — the inspector grows downward and this stays in the corner.
 *
 * Position rationale: top-right is the default "menu" corner on most
 * apps, and the help (?) button lives bottom-right, so they don't
 * fight for space.
 */
import { useGarden } from '../store/garden'

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 13,
  display: 'flex',
  gap: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 999,
  padding: 4,
  pointerEvents: 'auto',
  userSelect: 'none',
}

const ICON_BTN: React.CSSProperties = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: '#e5e5e5',
  border: 'none',
  borderRadius: 999,
  fontSize: 16,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
}

const ICON_BTN_ACTIVE: React.CSSProperties = {
  ...ICON_BTN,
  background: 'rgba(60, 130, 200, 0.85)',
  color: '#fff',
}

export default function HUDToggle() {
  const collapsed = useGarden((s) => s.hudCollapsed)
  const setCollapsed = useGarden((s) => s.setHudCollapsed)
  const showGrid = useGarden((s) => s.showGrid)
  const setShowGrid = useGarden((s) => s.setShowGrid)
  return (
    <div style={BAR_STYLE} data-tour-id="hud-toggle-bar">
      <button
        style={collapsed ? ICON_BTN_ACTIVE : ICON_BTN}
        onClick={() => setCollapsed(!collapsed)}
        title={
          collapsed
            ? 'Show all HUD (chips, toolbar, inspector)'
            : 'Hide all HUD — see the scene without overlays'
        }
        aria-label="toggle hud"
      >
        {collapsed ? '⊟' : '⊞'}
      </button>
      <button
        style={showGrid ? ICON_BTN_ACTIVE : ICON_BTN}
        onClick={() => setShowGrid(!showGrid)}
        title="Toggle the ground grid (1m / 1ft markings)"
        aria-label="toggle grid"
      >
        ▦
      </button>
    </div>
  )
}
