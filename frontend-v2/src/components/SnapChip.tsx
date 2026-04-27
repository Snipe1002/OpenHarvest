/**
 * SnapChip — small fixed-position chip in the top-left corner showing the
 * current snap distance. Tap to cycle: off → 0.1m → 0.5m → 1.0m → off.
 *
 * Snap is honored by:
 *   - useTranslateDrag (entity drag-to-move quantizes x / z to the snap)
 *   - HouseToolbar wall placement (corner clicks quantize to the snap)
 *
 * Snap state is persisted in localStorage by the store; this chip is a
 * pure UI control over `useGarden().snap` / `setSnap`.
 */
import { useGarden, type SnapValue } from '../store/garden'

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

const ORDER: SnapValue[] = [null, 0.1, 0.5, 1.0]

function next(v: SnapValue): SnapValue {
  const i = ORDER.indexOf(v)
  return ORDER[(i + 1) % ORDER.length]
}

function label(v: SnapValue): string {
  if (v === null) return 'Snap: off'
  return `Snap: ${v}m`
}

export default function SnapChip() {
  const snap = useGarden((s) => s.snap)
  const setSnap = useGarden((s) => s.setSnap)
  return (
    <button
      style={snap === null ? STYLE : ACTIVE_STYLE}
      onClick={() => setSnap(next(snap))}
      title="Cycle snap distance"
    >
      {label(snap)}
    </button>
  )
}
