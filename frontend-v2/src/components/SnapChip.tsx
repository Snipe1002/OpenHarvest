/**
 * SnapChip — small fixed-position chip in the top-left corner showing the
 * current snap distance. Tap to cycle through the active unit system's snap
 * list.
 *
 * Snap is honored by:
 *   - useTranslateDrag (entity drag-to-move quantizes x / z to the snap)
 *   - MainToolbar wall placement (corner clicks quantize to the snap)
 *
 * Snap state is persisted in localStorage by the store; this chip is a
 * pure UI control over `useGarden().snap` / `setSnap`. The cycle list and
 * label format depend on `useGarden().units` (metric vs imperial).
 *
 * Position: first slot in the top-left chip column. Sibling chips
 * (StickyChip, MultiChip, UnitsChip) stack below this one.
 */
import {
  IMPERIAL_SNAP_VALUES,
  METRIC_SNAP_VALUES,
  useGarden,
  type SnapValue,
} from '../store/garden'
import { formatLength } from '../store/unitsHelpers'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: 16,
  zIndex: 11,
  padding: '6px 10px',
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  borderRadius: 999,
  border: '1px solid #444',
  cursor: 'pointer',
  userSelect: 'none',
}

const ACTIVE_STYLE: React.CSSProperties = {
  ...STYLE,
  background: 'rgba(60, 130, 200, 0.92)',
  borderColor: '#4a90c8',
}

function nextSnap(v: SnapValue, list: SnapValue[]): SnapValue {
  // The list always starts with `null` (off). Match by approximate equality
  // to tolerate accumulated FP drift from the closest-neighbor migration on
  // unit flips. If we can't find the current value (e.g. user just flipped
  // and snap was reset), start at the first non-null entry.
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
  const units = useGarden((s) => s.units)
  const list = units === 'metric' ? METRIC_SNAP_VALUES : IMPERIAL_SNAP_VALUES
  return (
    <button
      style={snap === null ? STYLE : ACTIVE_STYLE}
      onClick={() => setSnap(nextSnap(snap, list))}
      title="Cycle snap distance"
    >
      {snapLabel(snap, units)}
    </button>
  )
}
