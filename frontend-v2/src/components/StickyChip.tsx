/**
 * StickyChip — small fixed-position toggle in the top-left chip column.
 * Sits below SnapChip. When ON, finishing a placement (entity, wall, door,
 * window) does NOT exit placement mode — the toolbar stays armed for
 * another. Esc still cancels regardless of sticky state.
 *
 * Persists to localStorage via the store. Default off.
 *
 * Position: second slot in the top-left chip column (SnapChip top, then
 * StickyChip, then MultiChip, then UnitsChip).
 */
import { useGarden } from '../store/garden'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 48, // SnapChip is at top:16 with ~28px height + 4 gap.
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

export default function StickyChip() {
  const sticky = useGarden((s) => s.stickyPlacement)
  const setSticky = useGarden((s) => s.setStickyPlacement)
  return (
    <button
      style={sticky ? ACTIVE_STYLE : STYLE}
      onClick={() => setSticky(!sticky)}
      title="When ON, placement stays armed after each click — keep dropping the same kind without re-tapping the toolbar"
    >
      📌 Sticky: {sticky ? 'on' : 'off'}
    </button>
  )
}
