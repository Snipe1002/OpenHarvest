/**
 * HUDMenuHub — popup that summons next to the compass when the user
 * taps it. Lists every HUD panel with a toggle so the operator can hide
 * pieces individually instead of using the all-or-nothing `hudCollapsed`
 * master switch. Per-panel choices persist to localStorage.
 *
 * Layout:
 *   ┌──────────────────────────┐
 *   │ HUD panels               │
 *   │ ─────────────────────────│
 *   │ ☑ Top-left chips         │
 *   │ ☑ Bottom toolbar         │
 *   │ ☑ Inspector              │
 *   │ ☑ Multi-select bar       │
 *   │ ─────────────────────────│
 *   │ [Show all] [Hide all]    │
 *   └──────────────────────────┘
 *
 * Anchored just to the right of the compass widget (top:188, left:96).
 * Esc dismisses. Tapping outside (managed by global onClick on the body)
 * also dismisses, but we keep the popup itself non-bubbling.
 */
import { useEffect } from 'react'
import { useGarden, type PanelId } from '../store/garden'

const POPUP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 188,
  // Compass left:16 + width 72 + 8 gap = 96.
  left: 96,
  zIndex: 14,
  background: 'rgba(20, 22, 24, 0.96)',
  border: '1px solid #4ec9ff',
  borderRadius: 8,
  padding: 10,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  color: '#e5e5e5',
  minWidth: 200,
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.6)',
  pointerEvents: 'auto',
  userSelect: 'none',
}

const HEADER_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: '#4ec9ff',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 2px',
  cursor: 'pointer',
}

const FOOTER_ROW: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px solid #333',
}

const FOOTER_BTN: React.CSSProperties = {
  flex: 1,
  background: '#2a2d31',
  color: '#ddd',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

interface PanelRow {
  id: PanelId
  label: string
}

const PANELS: PanelRow[] = [
  { id: 'chips', label: 'Top-left chips' },
  { id: 'mainToolbar', label: 'Bottom toolbar' },
  { id: 'inspector', label: 'Inspector card' },
  { id: 'multiInspector', label: 'Multi-select bar' },
]

export default function HUDMenuHub() {
  const open = useGarden((s) => s.menuHubOpen)
  const setOpen = useGarden((s) => s.setMenuHubOpen)
  const visibility = useGarden((s) => s.panelVisibility)
  const setVisibility = useGarden((s) => s.setPanelVisibility)
  const setAllVisible = useGarden((s) => s.setAllPanelsVisible)

  // Esc closes the popup. Mounted only while the popup is open so we
  // don't add a global listener for nothing.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      style={POPUP_STYLE}
      onClick={(e) => e.stopPropagation()}
      data-tour-id="hud-menu-hub"
    >
      <div style={HEADER_STYLE}>HUD panels</div>
      {PANELS.map((p) => (
        <label key={p.id} style={ROW_STYLE}>
          <input
            type="checkbox"
            checked={visibility[p.id]}
            onChange={(e) => setVisibility(p.id, e.target.checked)}
          />
          <span>{p.label}</span>
        </label>
      ))}
      <div style={FOOTER_ROW}>
        <button style={FOOTER_BTN} onClick={() => setAllVisible(true)}>
          Show all
        </button>
        <button style={FOOTER_BTN} onClick={() => setAllVisible(false)}>
          Hide all
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
        Esc to dismiss · tap compass to reopen
      </div>
    </div>
  )
}
