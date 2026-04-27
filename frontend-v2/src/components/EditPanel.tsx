/**
 * EditPanel — slim horizontal bar at the bottom of the screen, visible only
 * when an entity is selected. Designed to NOT cover the scene: short height,
 * compact controls, sits above the AddToolbar.
 *
 * Lives outside the `<Viewer>` so it can be plain DOM (Pascal's children must
 * be R3F nodes).
 *
 * Editing flow for every field:
 *   1. Optimistic local update (`addOrUpdateEntity` with the mutated copy).
 *   2. PATCH the backend.
 *   3. On failure, revert and surface a toast.
 *
 * Style: utilitarian dark bar, light text, sans-serif. Inline styles only.
 */
import { useEffect, useState } from 'react'
import { ApiError, deleteEntity, updateEntity } from '../api/client'
import type { GardenEntity, Geometry, Quaternion, Transform } from '../api/types'
import { useGarden } from '../store/garden'

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 64, // sit above the AddToolbar (which is at bottom: 16)
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #333',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  zIndex: 11,
  pointerEvents: 'auto',
  maxWidth: 'calc(100vw - 32px)',
  flexWrap: 'wrap',
}

const LABEL_STYLE: React.CSSProperties = {
  color: '#999',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
}

const INPUT_STYLE: React.CSSProperties = {
  width: 56,
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
  whiteSpace: 'nowrap',
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

const SECTION_DIVIDER_STYLE: React.CSSProperties = {
  width: 1,
  height: 18,
  background: '#333',
  margin: '0 2px',
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return (Math.round(n * 100) / 100).toString()
}

/** Rotate a quaternion 90° about world-Y. q' = q_y * q. */
function rotateY90(q: Quaternion): Quaternion {
  const s = Math.SQRT1_2
  const aw = s
  const ay = s
  const x = aw * q.x + ay * q.z
  const y = aw * q.y + ay * q.w
  const z = aw * q.z - ay * q.x
  const w = aw * q.w - ay * q.y
  return { x, y, z, w }
}

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (next: number) => void
  step?: number
  min?: number
}

function NumberField({ label, value, onCommit, step = 0.1, min }: NumberFieldProps) {
  const [draft, setDraft] = useState<string>(fmt(value))
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
    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
    </label>
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

  useEffect(() => {
    setConfirmingDelete(false)
  }, [entity?.id])

  useEffect(() => {
    if (!toast) return
    const handle = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(handle)
  }, [toast, setToast])

  if (!entity) {
    return toast ? <ToastOnly message={toast} /> : null
  }
  if (!gardenId) return null

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
    removeEntity(id)
    selectEntity(null)
    try {
      await deleteEntity(gardenId, id)
    } catch (err) {
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
    const g = entity.geometry
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
    return null
  }

  return (
    <>
      <div style={BAR_STYLE} role="dialog" aria-label="Edit selected entity">
        <span style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
          {typeLabel(entity)}{' '}
          <span style={{ color: '#777', fontWeight: 400, fontSize: 10 }}>{shortId(entity.id)}</span>
        </span>

        <div style={SECTION_DIVIDER_STYLE} />

        <span style={LABEL_STYLE}>Pos</span>
        <NumberField label="X" value={entity.transform.position.x} onCommit={(n) => updatePosition('x', n)} />
        <NumberField label="Y" value={entity.transform.position.y} onCommit={(n) => updatePosition('y', n)} />
        <NumberField label="Z" value={entity.transform.position.z} onCommit={(n) => updatePosition('z', n)} />

        <div style={SECTION_DIVIDER_STYLE} />

        <span style={LABEL_STYLE}>Size</span>
        {renderSizeFields()}

        <div style={SECTION_DIVIDER_STYLE} />

        <button style={BUTTON_STYLE} onClick={rotate90} title="Rotate 90° around Y axis">
          ⟳ 90°
        </button>

        <div style={SECTION_DIVIDER_STYLE} />

        <button
          style={confirmingDelete ? DELETE_CONFIRM_STYLE : DELETE_STYLE}
          onClick={onDeleteClick}
          onBlur={() => setConfirmingDelete(false)}
        >
          {confirmingDelete ? 'Confirm?' : '🗑 Delete'}
        </button>

        <button
          style={BUTTON_STYLE}
          onClick={() => selectEntity(null)}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      {toast && <ToastOnly message={toast} />}
    </>
  )
}

function ToastOnly({ message }: { message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        zIndex: 12,
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
