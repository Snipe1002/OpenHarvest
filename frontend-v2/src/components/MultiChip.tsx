/**
 * MultiChip — top-left toggle for "multi-select mode". When ON, every entity
 * tap acts as additive selection (toggles the entity in the selection list)
 * with no shift key required. Designed for touch devices that can't
 * synthesize shift+click.
 *
 * Empty-ground click while multi-mode is on does NOT clear the selection,
 * matching the "shift held" desktop behavior — preserves multi-picks against
 * accidental misses.
 *
 * Sits to the right of StickyChip in the top-left chip stack. Persists to
 * localStorage via the store.
 */
import { useGarden } from '../store/garden'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  // SnapChip is at left:16, StickyChip is at left:124. This sits next.
  left: 232,
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

export default function MultiChip() {
  const multi = useGarden((s) => s.multiSelectMode)
  const setMulti = useGarden((s) => s.setMultiSelectMode)
  return (
    <button
      style={multi ? ACTIVE_STYLE : STYLE}
      onClick={() => setMulti(!multi)}
      title="When ON, every entity tap toggles its membership in the selection — multi-pick without shift. Useful on touch devices."
    >
      🔢 Multi: {multi ? 'on' : 'off'}
    </button>
  )
}
