/**
 * SnapChip — top-left dual chip showing the current snap distance AND mode.
 * Two side-by-side mini-buttons in one rounded shell:
 *
 *   ┌────────────────────────┬──────┐
 *   │ Snap: 1m               │ edge │
 *   └────────────────────────┴──────┘
 *
 * Tap the value side to cycle through the active unit system's snap list.
 * Tap the mode side to toggle 'edge' ↔ 'center'.
 *
 * Snap is honored by:
 *   - useTranslateDrag / useGroupTranslateDrag (entity drag-to-move).
 *     'edge' magnets to neighbor edges with `snap` as the gap; 'center'
 *     quantizes the dragged entity's center to a fixed world grid.
 *   - MainToolbar wall placement (corner clicks always grid-snap).
 *
 * Persisted to localStorage by the store. Cycle list + labels depend on
 * `useGarden().units` (metric vs imperial).
 *
 * Position: first slot in the top-left chip column.
 */
import {
  IMPERIAL_SNAP_VALUES,
  METRIC_SNAP_VALUES,
  useGarden,
  type SnapValue,
} from '../store/garden'
import { formatLength } from '../store/unitsHelpers'

const SHELL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: 16,
  zIndex: 11,
  display: 'inline-flex',
  alignItems: 'stretch',
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 999,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  color: '#e5e5e5',
  overflow: 'hidden',
  userSelect: 'none',
}

const VALUE_BTN: React.CSSProperties = {
  padding: '6px 10px',
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const VALUE_BTN_ACTIVE: React.CSSProperties = {
  ...VALUE_BTN,
  background: 'rgba(60, 130, 200, 0.92)',
  color: '#fff',
}

const MODE_BTN: React.CSSProperties = {
  padding: '6px 10px',
  background: 'rgba(255, 255, 255, 0.04)',
  color: 'inherit',
  borderLeft: '1px solid #444',
  borderTop: 'none',
  borderRight: 'none',
  borderBottom: 'none',
  fontSize: 11,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  textTransform: 'lowercase',
  minWidth: 50,
}

function nextSnap(v: SnapValue, list: SnapValue[]): SnapValue {
  let i = list.findIndex((x) => snapEq(x, v))
  if (i < 0) i = 0
  return list[(i + 1) % list.length]
}

function snapEq(a: SnapValue, b: SnapValue): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) < 1e-6
}

function snapLabel(v: SnapValue, units: 'metric' | 'imperial'): string {
  if (v === null) return 'Snap: off'
  return `Snap: ${formatLength(v, units)}`
}

export default function SnapChip() {
  const snap = useGarden((s) => s.snap)
  const setSnap = useGarden((s) => s.setSnap)
  const snapMode = useGarden((s) => s.snapMode)
  const setSnapMode = useGarden((s) => s.setSnapMode)
  const units = useGarden((s) => s.units)
  const list = units === 'metric' ? METRIC_SNAP_VALUES : IMPERIAL_SNAP_VALUES
  return (
    <div style={SHELL_STYLE}>
      <button
        style={snap === null ? VALUE_BTN : VALUE_BTN_ACTIVE}
        onClick={() => setSnap(nextSnap(snap, list))}
        title="Cycle snap distance"
      >
        {snapLabel(snap, units)}
      </button>
      <button
        style={MODE_BTN}
        onClick={() => setSnapMode(snapMode === 'edge' ? 'center' : 'edge')}
        title={
          snapMode === 'edge'
            ? "'edge' = snap to neighbor's edge with `snap` as the gap. Tap to switch to 'center' (grid)."
            : "'center' = snap entity center to a fixed world grid. Tap to switch to 'edge' (magnet)."
        }
      >
        {snapMode}
      </button>
    </div>
  )
}
