/**
 * CameraFocusButton — small fixed-position toggle on the LEFT side
 * (separate from the right-side HUDToggle bar with grid/collapse) that
 * arms "pick a camera focus point" mode. Tap once to enter picking mode;
 * the next click on the ground sets the camera's orbit target to that
 * point. Tap again (or once a focus is set) to clear the focus and reset
 * the orbit target to the world origin.
 *
 * Position: directly below the CompassWidget so the orientation tools
 * cluster on the left. Bottom of the chip column to top of the compass:
 * top:188 + 72 (compass) + 8 gap = 268.
 */
import { useGarden } from '../store/garden'

const STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 268,
  left: 16,
  width: 72,
  height: 36,
  zIndex: 12,
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 8,
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 11,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  pointerEvents: 'auto',
  userSelect: 'none',
}

const STYLE_PICKING: React.CSSProperties = {
  ...STYLE,
  background: 'rgba(60, 130, 200, 0.85)',
  borderColor: '#4a90c8',
  color: '#fff',
}

const STYLE_LOCKED: React.CSSProperties = {
  ...STYLE,
  background: 'rgba(255, 170, 0, 0.85)',
  borderColor: '#ffaa00',
  color: '#1a1a1a',
}

export default function CameraFocusButton() {
  const focus = useGarden((s) => s.cameraFocus)
  const picking = useGarden((s) => s.cameraFocusPicking)
  const setFocus = useGarden((s) => s.setCameraFocus)
  const setPicking = useGarden((s) => s.setCameraFocusPicking)

  const onClick = () => {
    if (focus) {
      // A focus is locked — clear it and reset the orbit target.
      setFocus(null)
      setPicking(false)
      return
    }
    // Toggle picking mode. If already picking, cancel; else arm.
    setPicking(!picking)
  }

  const style = picking ? STYLE_PICKING : focus ? STYLE_LOCKED : STYLE
  const label = picking ? 'tap ground' : focus ? 'focus on' : 'cam focus'
  return (
    <button
      type="button"
      style={style}
      onClick={onClick}
      title={
        picking
          ? 'Tap a spot on the ground to lock the camera focus there. Tap again to cancel.'
          : focus
            ? `Camera locked to (${focus.x.toFixed(1)}, ${focus.z.toFixed(1)}). Tap to clear.`
            : 'Pin the camera focus to a point. The camera will orbit around that point instead of the world origin.'
      }
      aria-label="camera focus pin"
      data-tour-id="camera-focus-button"
    >
      <span style={{ fontSize: 14 }}>📍</span>
      <span>{label}</span>
    </button>
  )
}
