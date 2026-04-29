/**
 * NudgePad — 3×3 directional pad for fine-tune translation. Used by both
 * InspectorCard (single-entity nudge) and MultiSelectInspector (group
 * nudge). The center cell shows the active step in the user's units; the
 * four arrow buttons call back into the host with a (dx, dz) of unit
 * direction (e.g. left = -1, 0; up = 0, -1).
 *
 * Y is intentionally not exposed here — height edits go through the
 * inspector's size detail panel. This pad only moves things on the
 * ground plane.
 */
import { formatLength, type Units } from '../store/unitsHelpers'

interface NudgePadProps {
  /** Step in meters; the center cell labels this and arrows nudge by it. */
  step: number
  units: Units
  /** Called with (dx, dz) ∈ {-1, 0, 1}^2, never both zero. */
  onNudge: (dx: number, dz: number) => void
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
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 36px)',
  gridTemplateRows: 'repeat(3, 32px)',
  gap: 2,
  padding: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 8,
  pointerEvents: 'auto',
}

export default function NudgePad({ step, units, onNudge, tourId = 'nudge-pad' }: NudgePadProps) {
  const stepLabel = formatLength(step, units)
  return (
    <div data-tour-id={tourId} style={PAD_STYLE}>
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
  )
}
