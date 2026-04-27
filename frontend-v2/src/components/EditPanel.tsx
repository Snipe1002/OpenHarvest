/**
 * EditPanel — fixed-position bottom-right HTML panel showing the currently
 * selected entity's metadata and edit affordances.
 *
 * Lives outside the `<Viewer>` so it can be plain DOM (Pascal's children must
 * be R3F nodes). Visible only when `selectedEntityId` is set.
 *
 * Editing flow for every field is the same:
 *   1. Optimistic local update (`addOrUpdateEntity` with the mutated copy).
 *   2. PATCH the backend.
 *   3. On failure, revert to the original copy and surface a toast string.
 *
 * SignalR `entityUpserted` will arrive after a successful PATCH, but
 * `addOrUpdateEntity` is idempotent so the duplicate is harmless.
 *
 * Style: utilitarian dark panel, light text, sans-serif. Inline styles only —
 * no CSS framework per milestone constraints.
 */
import { useEffect, useMemo, useState } from 'react'
import { ApiError, deleteEntity, updateEntity } from '../api/client'
import type { GardenEntity, Geometry, Quaternion, Transform } from '../api/types'
import { useGarden } from '../store/garden'

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  width: 280,
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 13,
  padding: 12,
  borderRadius: 6,
  border: '1px solid #333',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  zIndex: 10,
  pointerEvents: 'auto',
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
}

const LABEL_STYLE: React.CSSProperties = {
  width: 14,
  color: '#999',
}

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  background: '#0e1012',
  color: '#e5e5e5',
  border: '1px solid #333',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 12,
  fontFamily: 'inherit',
}

const BUTTON_STYLE: React.CSSProperties = {
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '4px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const DELETE_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#5a1f1f',
  border: '1px solid #8a2a2a',
}

const DELETE_CONFIRM_STYLE: React.CSSProperties = {
  ...DELETE_STYLE,
  background: '#a02a2a',
  border: '1px solid #c04040',
}

const SECTION_HEADER_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#8a8a8a',
  marginTop: 10,
  marginBottom: 4,
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id
}

function typeLabel(entity: GardenEntity): string {
  if (entity.geometry.prefabRef) return entity.geometry.prefabRef
  switch (entity.kind) {
    case 'Bed':
      return 'Bed'
    case 'Plant':
      return 'Plant'
    default:
      return entity.kind ?? 'Unknown'
  }
}

/** Round to 2 decimals for display so we don't render ugly floats. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return (Math.round(n * 100) / 100).toString()
}

/**
 * Rotate a quaternion by 90° around the world-Y axis. Matches the wire format
 * (`Quaternion = {x, y, z, w}`). Math: q' = q_y * q where q_y is a 90° rotation
 * about Y — `[0, sin(45°), 0, cos(45°)]`.
 */
function rotateY90(q: Quaternion): Quaternion {
  const s = Math.SQRT1_2 // sin(45°) = cos(45°) = 1/√2
  const ax = 0
  const ay = s
  const az = 0
  const aw = s
  // Hamilton product: a * q
  const x = aw * q.x + ax * q.w + ay * q.z - az * q.y
  const y = aw * q.y - ax * q.z + ay * q.w + az * q.x
  const z = aw * q.z + ax * q.y - ay * q.x + az * q.w
  const w = aw * q.w - ax * q.x - ay * q.y - az * q.z
  return { x, y, z, w }
}

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (next: number) => void
  step?: number
  min?: number
}

/** Numeric input that commits onBlur or Enter. Local state isolates typing
 *  from the canonical entity value so we don't refetch on every keystroke. */
function NumberField({ label, value, onCommit, step = 0.1, min }: NumberFieldProps) {
  const [draft, setDraft] = useState<string>(fmt(value))
  // If the upstream value changes (SignalR or revert), resync the draft.
  useEffect(() => {
    setDraft(fmt(value))
  }, [value])

  const commit = () => {
    const n = parseFloat(draft)
    if (!Number.isFinite(n)) {
      setDraft(fmt(value))
      return
    }
    if (typeof min === 'number' && n < min) {
      setDraft(fmt(value))
      return
    }
    if (n !== value) onCommit(n)
  }

  return (
    <div style={ROW_STYLE}>
      <span style={LABEL_STYLE}>{label}</span>
      <input
        style={INPUT_STYLE}
        type="number"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setDraft(fmt(value))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </div>
  )
}

export default function EditPanel() {
  const entity = useGarden((s) => {
    const id = s.selectedEntityId
    return id ? s.entities[id] ?? null : null
  })
  const gardenId = useGarden((s) => s.currentGardenId)
  const toast = useGarden((s) => s.toast)
  const setToast = useGarden((s) => s.setToast)
  const selectEntity = useGarden((s) => s.selectEntity)
  const addOrUpdateEntity = useGarden((s) => s.addOrUpdateEntity)
  const removeEntity = useGarden((s) => s.removeEntity)

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // When the selected entity changes (or panel hides), reset the
  // delete-confirm state so it doesn't leak across selections.
  useEffect(() => {
    setConfirmingDelete(false)
  }, [entity?.id])

  // Auto-clear toast after a few seconds.
  useEffect(() => {
    if (!toast) return
    const handle = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(handle)
  }, [toast, setToast])

  const geometryControls = useMemo(() => {
    if (!entity) return null
    return entity.geometry
  }, [entity])

  if (!entity) {
    // Toast can show even when nothing is selected (e.g. placement failed).
    return toast ? <ToastOnly message={toast} /> : null
  }
  if (!gardenId) return null

  // Issue a PATCH with the merged transform/geometry. Optimistic on entry,
  // revert on failure.
  const patch = async (
    nextEntity: GardenEntity,
    body: { transform?: Transform; geometry?: Geometry },
  ) => {
    const original = entity
    addOrUpdateEntity(nextEntity)
    try {
      const updated = await updateEntity(gardenId, entity.id, body)
      addOrUpdateEntity(updated)
    } catch (err) {
      addOrUpdateEntity(original)
      const msg =
        err instanceof ApiError
          ? `Update failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Update failed'
      setToast(msg)
      console.error('[EditPanel] updateEntity failed', err)
    }
  }

  const updatePosition = (axis: 'x' | 'y' | 'z', value: number) => {
    const nextTransform: Transform = {
      ...entity.transform,
      position: { ...entity.transform.position, [axis]: value },
    }
    void patch({ ...entity, transform: nextTransform }, { transform: nextTransform })
  }

  const updateBoxSize = (axis: 'x' | 'y' | 'z', value: number) => {
    const safe = Math.max(value, 0.01)
    const currentSize = entity.geometry.size ?? { x: 1, y: 1, z: 1 }
    const nextGeometry: Geometry = {
      ...entity.geometry,
      size: { ...currentSize, [axis]: safe },
    }
    void patch({ ...entity, geometry: nextGeometry }, { geometry: nextGeometry })
  }

  const updateCylinder = (field: 'radius' | 'height', value: number) => {
    const safe = Math.max(value, 0.01)
    const nextGeometry: Geometry = { ...entity.geometry, [field]: safe }
    void patch({ ...entity, geometry: nextGeometry }, { geometry: nextGeometry })
  }

  const rotate90 = () => {
    const nextRotation = rotateY90(entity.transform.rotation)
    const nextTransform: Transform = { ...entity.transform, rotation: nextRotation }
    void patch({ ...entity, transform: nextTransform }, { transform: nextTransform })
  }

  const onDeleteClick = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    const id = entity.id
    // Optimistic local removal; SignalR will broadcast for other clients.
    removeEntity(id)
    selectEntity(null)
    try {
      await deleteEntity(gardenId, id)
    } catch (err) {
      // Re-insert the original on failure.
      addOrUpdateEntity(entity)
      const msg =
        err instanceof ApiError
          ? `Delete failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Delete failed'
      setToast(msg)
      console.error('[EditPanel] deleteEntity failed', err)
    }
  }

  const renderSizeFields = () => {
    const g = geometryControls
    if (!g) return null
    if (g.kind === 'Box') {
      const s = g.size ?? { x: 1, y: 1, z: 1 }
      return (
        <>
          <NumberField label="W" value={s.x} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('x', n)} />
          <NumberField label="H" value={s.y} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('y', n)} />
          <NumberField label="L" value={s.z} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('z', n)} />
        </>
      )
    }
    if (g.kind === 'Cylinder') {
      return (
        <>
          <NumberField
            label="R"
            value={g.radius ?? 0.04}
            step={0.01}
            min={0.01}
            onCommit={(n) => updateCylinder('radius', n)}
          />
          <NumberField
            label="H"
            value={g.height ?? 0.4}
            step={0.1}
            min={0.01}
            onCommit={(n) => updateCylinder('height', n)}
          />
        </>
      )
    }
    if (g.kind === 'Polygon') {
      return <div style={{ color: '#999', fontSize: 12 }}>(non-resizable)</div>
    }
    // Prefab / MeshRef: also expose size if present, else a placeholder.
    if (g.size) {
      const s = g.size
      return (
        <>
          <NumberField label="W" value={s.x} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('x', n)} />
          <NumberField label="H" value={s.y} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('y', n)} />
          <NumberField label="L" value={s.z} step={0.1} min={0.01} onCommit={(n) => updateBoxSize('z', n)} />
        </>
      )
    }
    return <div style={{ color: '#999', fontSize: 12 }}>(non-resizable)</div>
  }

  return (
    <div style={PANEL_STYLE} role="dialog" aria-label="Edit selected entity">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>{typeLabel(entity)}</strong>
        <span style={{ color: '#777', fontSize: 11 }}>{shortId(entity.id)}</span>
      </div>
      {entity.name && (
        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 8 }}>{entity.name}</div>
      )}

      <div style={SECTION_HEADER_STYLE}>Position (m)</div>
      <NumberField label="X" value={entity.transform.position.x} onCommit={(n) => updatePosition('x', n)} />
      <NumberField label="Y" value={entity.transform.position.y} onCommit={(n) => updatePosition('y', n)} />
      <NumberField label="Z" value={entity.transform.position.z} onCommit={(n) => updatePosition('z', n)} />

      <div style={SECTION_HEADER_STYLE}>Size (m)</div>
      {renderSizeFields()}

      <div style={SECTION_HEADER_STYLE}>Rotate</div>
      <button style={BUTTON_STYLE} onClick={rotate90}>
        Rotate 90° (Y)
      </button>

      <div style={{ ...SECTION_HEADER_STYLE, marginTop: 14 }}>Danger</div>
      <button
        style={confirmingDelete ? DELETE_CONFIRM_STYLE : DELETE_STYLE}
        onClick={onDeleteClick}
        onBlur={() => setConfirmingDelete(false)}
      >
        {confirmingDelete ? 'Confirm delete?' : 'Delete'}
      </button>

      {toast && (
        <div
          style={{
            marginTop: 10,
            padding: '6px 8px',
            background: '#3a1a1a',
            border: '1px solid #6a2a2a',
            borderRadius: 3,
            color: '#f5b5b5',
            fontSize: 12,
          }}
          role="alert"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function ToastOnly({ message }: { message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 10,
        padding: '8px 12px',
        background: '#3a1a1a',
        border: '1px solid #6a2a2a',
        borderRadius: 4,
        color: '#f5b5b5',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
      }}
      role="alert"
    >
      {message}
    </div>
  )
}
