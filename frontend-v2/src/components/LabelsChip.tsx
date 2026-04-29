/**
 * LabelsChip — top-left toggle for showing lowercase labels under icon
 * buttons (inspector pill + multi-select hotbar). Touch users can't see
 * HTML title tooltips on iOS Safari, so labels are the discoverability
 * mechanism. Defaults ON; turn off once you know the icons.
 *
 * Position: fifth slot in the top-left chip column (SnapChip → StickyChip
 * → MultiChip → UnitsChip → LabelsChip). Persists to localStorage via the
 * store.
 */
import { useGarden } from '../store/garden'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 144, // Below UnitsChip at 112 + ~28 height + 4 gap.
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

export default function LabelsChip() {
  const show = useGarden((s) => s.showButtonLabels)
  const setShow = useGarden((s) => s.setShowButtonLabels)
  return (
    <button
      data-tour-id="labels-chip"
      style={show ? ACTIVE_STYLE : STYLE}
      onClick={() => setShow(!show)}
      title="Toggle lowercase labels under icon buttons (inspector + multi-select). Useful while learning the icons; turn off once you know them."
    >
      🏷️ Labels: {show ? 'on' : 'off'}
    </button>
  )
}
