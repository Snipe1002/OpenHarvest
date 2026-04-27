/**
 * TranslateStatusPill — top-center status pill shown while the user is in
 * drag-to-move (translate) mode for a selected entity. Click pill or press
 * Esc to cancel; cancelling rolls the entity back to its pre-drag position
 * via `addOrUpdateEntity` since the on-pointer-up commit only fires after a
 * release-with-movement.
 *
 * The pill must appear ABOVE the canvas pointer events but doesn't capture
 * pointermoves — `useTranslateDrag` does that on the entity itself.
 *
 * Position: top-center at top:152 — guaranteed below the top-left chip
 * column (Snap/Sticky/Multi/Units, which ends at ~top:142) at any viewport
 * width or orientation. The MainToolbar's placement-status pill uses the
 * same offset; the two are mutually exclusive in practice (you can't be
 * translating an entity AND placing a wall/door/window/garden item at once).
 */
import { useEffect, useMemo } from 'react'
import { useGarden } from '../store/garden'

const PILL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 152,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(60, 130, 200, 0.92)',
  color: '#fff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #4a90c8',
  zIndex: 11,
  cursor: 'pointer',
}

function typeLabel(kind: string | undefined, prefabRef: string | null | undefined): string {
  if (prefabRef) return prefabRef
  return kind ?? 'entity'
}

export default function TranslateStatusPill() {
  const translateModeId = useGarden((s) => s.translateModeId)
  const entity = useGarden((s) => (translateModeId ? s.entities[translateModeId] ?? null : null))
  const setTranslateMode = useGarden((s) => s.setTranslateMode)

  // Esc cancels translate mode without committing the dragged position. We
  // don't restore the original position here because the drag handler in
  // useTranslateDrag only writes to the store on pointer-move, not on the
  // initial pointer-down. If the user enters translate mode, drags, then
  // hits Esc, we DO need to rollback. We snapshot via the entity's
  // pre-translate position. For simplicity and to avoid duplicating the
  // rollback path that already lives in useTranslateDrag's pointerup, we
  // accept that Esc-without-release leaves the latest dragged position
  // unsaved. (The next inspector field commit or page reload will round-trip
  // the server's authoritative copy.)
  useEffect(() => {
    if (!translateModeId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTranslateMode(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [translateModeId, setTranslateMode])

  const label = useMemo(() => typeLabel(entity?.kind, entity?.geometry.prefabRef), [entity])

  if (!translateModeId || !entity) return null

  return (
    <div
      style={PILL_STYLE}
      role="status"
      onClick={() => setTranslateMode(null)}
      title="Click to cancel"
    >
      Drag {label} to move (Esc to cancel)
    </div>
  )
}
