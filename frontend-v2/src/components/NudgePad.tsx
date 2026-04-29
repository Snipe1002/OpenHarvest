/**
 * NudgePad — directional pad for fine-tune translation. Used by both
 * InspectorCard (single-entity nudge) and MultiSelectInspector (group
 * nudge). The 3×3 left section moves the entity (or group) on the world
 * XZ ground plane; an optional 1×3 right column moves on world Y for
 * vertical stacking.
 *
 * Layout when onNudgeY is provided:
 *
 *   .   ↑   .   |  ▲ up
 *   ←   m   →   |  m
 *   .   ↓   .   |  ▼ dn
 *
 * Center cells in both columns show the active step in the user's units.
 * The host owns the step value; we just label and dispatch nudge events.
 *
 * Y is exposed as "up" / "down" rather than as an axis letter — the user's
 * mental model maps "up/down" cleanly onto the world's vertical, and the
 * axis-letter conventions (Three.js Y-up vs. CAD Z-up) are a frequent
 * source of confusion.
 */
import { formatLength, type Units } from '../store/unitsHelpers'

interface NudgePadProps {
  /** Step in meters; the center cell labels this and arrows nudge by it. */
  step: number
  units: Units
  /** Called with (dx, dz) ∈ {-1, 0, 1}^2, never both zero. */
  onNudge: (dx: number, dz: number) => void
  /** Optional vertical nudge — when supplied, an "up / down" column appears. */
  onNudgeY?: (dy: number) => void
  /** Optional override for the data-tour-id (defaults to a generic value). */
  tourId?: string
}

const NUDGE_BTN: React.CSSProperties = {
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 6,
  fontSize: 16,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
}

const NUDGE_BTN_LABEL: React.CSSProperties = {
  fontSize: 8,
  color: '#aaa',
  textTransform: 'lowercase',
  letterSpacing: 0.2,
  lineHeight: 1,
}

const NUDGE_CENTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(60, 130, 200, 0.18)',
  border: '1px solid #2a3a48',
  borderRadius: 6,
  fontSize: 10,
  color: '#bbb',
  padding: '0 2px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const PAD_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  padding: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 8,
  pointerEvents: 'auto',
  alignItems: 'flex-start',
}

const XZ_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 36px)',
  gridTemplateRows: 'repeat(3, 32px)',
  gap: 2,
}

const Y_COLUMN_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '36px',
  gridTemplateRows: 'repeat(3, 32px)',
  gap: 2,
  borderLeft: '1px solid #333',
  paddingLeft: 6,
  marginLeft: 2,
}

export default function NudgePad({ step, units, onNudge, onNudgeY, tourId = 'nudge-pad' }: NudgePadProps) {
  const stepLabel = formatLength(step, units)
  return (
    <div data-tour-id={tourId} style={PAD_STYLE}>
      <div style={XZ_GRID_STYLE}>
        <div />
        <button style={NUDGE_BTN} onClick={() => onNudge(0, -1)} title="Nudge north (−Z)" aria-label="nudge north">↑</button>
        <div />
        <button style={NUDGE_BTN} onClick={() => onNudge(-1, 0)} title="Nudge west (−X)" aria-label="nudge west">←</button>
        <div style={NUDGE_CENTER} title={`step: ${stepLabel}`}>{stepLabel}</div>
        <button style={NUDGE_BTN} onClick={() => onNudge(1, 0)} title="Nudge east (+X)" aria-label="nudge east">→</button>
        <div />
        <button style={NUDGE_BTN} onClick={() => onNudge(0, 1)} title="Nudge south (+Z)" aria-label="nudge south">↓</button>
        <div />
      </div>
      {onNudgeY && (
        <div style={Y_COLUMN_STYLE} aria-label="vertical nudge">
          <button style={NUDGE_BTN} onClick={() => onNudgeY(1)} title="Nudge up (+Y) — raise height">
            <span>▲</span>
            <span style={NUDGE_BTN_LABEL}>up</span>
          </button>
          <div style={NUDGE_CENTER} title={`step: ${stepLabel}`}>{stepLabel}</div>
          <button style={NUDGE_BTN} onClick={() => onNudgeY(-1)} title="Nudge down (−Y) — lower height">
            <span>▼</span>
            <span style={NUDGE_BTN_LABEL}>dn</span>
          </button>
        </div>
      )}
    </div>
  )
}
