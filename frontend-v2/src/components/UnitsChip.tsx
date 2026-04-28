/**
 * UnitsChip — top-left toggle for the display unit system: metric ↔
 * imperial. Tap to flip. Internal coordinates always stay in meters; this
 * is purely a display-layer preference.
 *
 * Position: fourth slot in the top-left chip column (SnapChip →
 * StickyChip → MultiChip → UnitsChip). Persists to localStorage via the
 * store.
 *
 * When the units flip, the store migrates the active snap value to the
 * closest neighbor in the new system's snap cycle (or null stays null).
 */
import { useGarden } from '../store/garden'
import { unitDisplay } from '../store/unitsHelpers'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 112, // Below MultiChip at 80 + ~28 height + 4 gap.
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

export default function UnitsChip() {
  const units = useGarden((s) => s.units)
  const setUnits = useGarden((s) => s.setUnits)
  const isImperial = units === 'imperial'
  return (
    <button
      data-tour-id="units-chip"
      style={isImperial ? ACTIVE_STYLE : STYLE}
      onClick={() => setUnits(isImperial ? 'metric' : 'imperial')}
      title="Toggle metric ↔ imperial display units"
    >
      Units: {unitDisplay(units)}
    </button>
  )
}
