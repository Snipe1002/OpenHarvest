/**
 * AddToolbar — fixed-position bottom-center HTML toolbar with three buttons:
 *   "+ Bed", "+ Plant", "+ Prefab"
 *
 * Clicking a button enters placement mode (recorded on the Zustand store).
 * `DemoGround`'s pointer handler is responsible for actually placing the
 * entity at the click point; this component just toggles the mode flag.
 *
 * "+ Prefab" reveals a tiny inline picker with two slugs for milestone #3:
 *   `terracotta-pot` and `tomato-cage`. (More slugs come in milestone #4
 *   when the prefab catalog ships.)
 *
 * A small status pill at the top center shows "Click ground to place [X]"
 * while placement is active. Clicking the pill cancels placement; pressing
 * Escape also cancels. Toolbar buttons are disabled while a placement is
 * already active so the user can't enter "double" placement mode.
 */
import { useEffect } from 'react'
import { useGarden, type PlacementType } from '../store/garden'

const PREFAB_SLUGS: string[] = ['terracotta-pot', 'tomato-cage']

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  zIndex: 10,
}

const BUTTON_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  background: 'rgba(20, 22, 24, 0.92)',
  padding: 6,
  borderRadius: 6,
  border: '1px solid #333',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
}

const BUTTON_STYLE: React.CSSProperties = {
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '6px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const PILL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(255, 170, 0, 0.92)',
  color: '#1a1a1a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #d99a00',
  zIndex: 10,
  cursor: 'pointer',
}

const PICKER_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  padding: 6,
  borderRadius: 6,
  border: '1px solid #333',
}

function buttonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    ...BUTTON_STYLE,
    background: active ? '#5a4a1a' : BUTTON_STYLE.background,
    borderColor: active ? '#aa8a3a' : BUTTON_STYLE.border?.toString().split(' ').pop(),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function placementLabel(type: PlacementType, prefabSlug?: string | null): string {
  if (type === 'prefab') return prefabSlug ?? 'Prefab'
  if (type === 'bed') return 'Bed'
  if (type === 'plant') return 'Plant'
  return type
}

export default function AddToolbar() {
  const placement = useGarden((s) => s.placement)
  const setPlacement = useGarden((s) => s.setPlacement)

  // Escape cancels placement / closes the prefab picker.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && placement) setPlacement(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [placement, setPlacement])

  const isPicking = placement?.type === 'prefab' && !placement.prefabSlug
  const isPlacing = !!placement && !isPicking

  const enter = (type: PlacementType, prefabSlug?: string) => {
    setPlacement({ type, prefabSlug: prefabSlug ?? null })
  }

  return (
    <>
      {isPlacing && placement && (
        <div
          style={PILL_STYLE}
          role="status"
          onClick={() => setPlacement(null)}
          title="Click to cancel placement"
        >
          Click ground to place {placementLabel(placement.type, placement.prefabSlug)} (Esc to cancel)
        </div>
      )}

      <div style={BAR_STYLE}>
        {isPicking && (
          <div style={PICKER_STYLE}>
            {PREFAB_SLUGS.map((slug) => (
              <button
                key={slug}
                style={BUTTON_STYLE}
                onClick={() => enter('prefab', slug)}
              >
                {slug}
              </button>
            ))}
            <button style={BUTTON_STYLE} onClick={() => setPlacement(null)}>
              Cancel
            </button>
          </div>
        )}

        <div style={BUTTON_ROW_STYLE}>
          <button
            style={buttonStyle(placement?.type === 'bed', isPlacing && placement?.type !== 'bed')}
            disabled={isPlacing && placement?.type !== 'bed'}
            onClick={() => (placement?.type === 'bed' ? setPlacement(null) : enter('bed'))}
          >
            + Bed
          </button>
          <button
            style={buttonStyle(placement?.type === 'plant', isPlacing && placement?.type !== 'plant')}
            disabled={isPlacing && placement?.type !== 'plant'}
            onClick={() => (placement?.type === 'plant' ? setPlacement(null) : enter('plant'))}
          >
            + Plant
          </button>
          <button
            style={buttonStyle(placement?.type === 'prefab', false)}
            onClick={() => {
              if (placement?.type === 'prefab') setPlacement(null)
              else setPlacement({ type: 'prefab', prefabSlug: null })
            }}
          >
            + Prefab
          </button>
        </div>
      </div>
    </>
  )
}
