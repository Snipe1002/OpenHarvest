/**
 * InspectorCard — compact floating control card anchored to the selected
 * entity in 3D space. Rendered via drei's `<Html>` so it tracks camera
 * movement and auto-hides when nothing is selected.
 *
 * Layout: a small dark pill with type label + icon-only buttons (rotate,
 * translate, duplicate, delete, expand, close). Expand toggles a detail
 * panel below the pill with numeric position + size inputs.
 *
 * Anchor: just above the entity's top (position.y + size.y + 0.3m) so the
 * card doesn't overlap the geometry. Falls back to position.y + 1.5m when
 * the entity has no Box-style size.
 *
 * Editing flow mirrors the previous EditPanel: optimistic local update +
 * PATCH, revert on error with toast.
 */
import { useEffect, useState } from 'react'
import { ApiError, createEntity, deleteEntity, updateEntity } from '../api/client'
import type {
  CreateEntityRequest,
  GardenEntity,
  Geometry,
  Quaternion,
  Transform,
} from '../api/types'
import { useGarden } from '../store/garden'
import { formatLength, parseLength, type Units } from '../store/unitsHelpers'
import { useButtonDragHandle } from './useButtonDragHandle'


const PILL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 16,
  border: '1px solid #444',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
}

// Icon buttons stack a small icon on top of a tiny lowercase label so touch
// users (iOS Safari ignores `title` tooltips) can tell what each one does at
// a glance. The pill grows by ~10px in height; on a 390px-wide phone the
// seven buttons (rot/mv/copy/del/more/close + the type label) still fit
// without wrap.
const ICON_BUTTON: React.CSSProperties = {
  minWidth: 36,
  height: 38,
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: '2px 4px',
  lineHeight: 1,
}

const ICON_BUTTON_LABEL: React.CSSProperties = {
  fontSize: 9,
  color: '#aaa',
  textTransform: 'lowercase',
  letterSpacing: 0.2,
  lineHeight: 1,
}

const DELETE_BUTTON: React.CSSProperties = {
  ...ICON_BUTTON,
  background: '#5a1f1f',
  borderColor: '#8a2a2a',
}

const DELETE_CONFIRM: React.CSSProperties = {
  ...DELETE_BUTTON,
  background: '#a02a2a',
  borderColor: '#c04040',
}

const DETAIL_STYLE: React.CSSProperties = {
  marginTop: 6,
  padding: '6px 8px',
  background: 'rgba(20, 22, 24, 0.92)',
  border: '1px solid #444',
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 180,
  pointerEvents: 'auto',
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const TINY_LABEL: React.CSSProperties = {
  width: 18,
  color: '#888',
  fontSize: 10,
  textTransform: 'uppercase',
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

const NUM_INPUT: React.CSSProperties = {
  width: 50,
  background: '#0e1012',
  color: '#e5e5e5',
  border: '1px solid #333',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
  fontFamily: 'inherit',
}

/**
 * Format a length in meters for display in the active unit system. We use
 * `formatLength` for everything length-bearing (positions, box sizes,
 * cylinder radius/height) so the inspector stays consistent with the
 * SnapChip and unit toggle.
 */
function fmt(n: number, units: Units): string {
  if (!Number.isFinite(n)) return units === 'metric' ? '0 m' : "0'0\""
  return formatLength(n, units)
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

/**
 * Resolve a friendly label for the entity's parent — preferring the catalog's
 * `displayName` when the parent is a prefab, falling back to the parent's
 * own type label. Returns null when the parent isn't loaded yet (in which
 * case we just hide the chip rather than show "child of …").
 */
function parentLabel(
  parent: GardenEntity | null,
  catalog: ReturnType<typeof useGarden.getState>['prefabCatalog'],
): string | null {
  if (!parent) return null
  const slug = parent.geometry.prefabRef
  if (slug && catalog?.[slug]?.displayName) return catalog[slug].displayName
  return typeLabel(parent)
}

function rotateY90(q: Quaternion): Quaternion {
  const s = Math.SQRT1_2
  const x = s * q.x + s * q.z
  const y = s * q.y + s * q.w
  const z = s * q.z - s * q.x
  const w = s * q.w - s * q.y
  return { x, y, z, w }
}

interface NumberFieldProps {
  label: string
  /** Always in meters (the canonical internal unit). */
  value: number
  /** Callback receives the new value in meters. */
  onCommit: (next: number) => void
  /** Minimum legal value in meters. */
  min?: number
}

/**
 * Length-bearing input that displays + parses the active unit system.
 *
 * Internally `value` is always meters; we run it through `formatLength` for
 * display and `parseLength` for commit so the user can type either system's
 * shorthand (e.g. `5'0"`, `1.5 m`, `60in`, `1.5`). On unit-system change the
 * draft re-syncs to the new format automatically.
 */
function NumberField({ label, value, onCommit, min }: NumberFieldProps) {
  const units = useGarden((s) => s.units)
  const [draft, setDraft] = useState<string>(fmt(value, units))
  useEffect(() => {
    setDraft(fmt(value, units))
  }, [value, units])
  const commit = () => {
    const meters = parseLength(draft, units)
    if (meters === null || !Number.isFinite(meters)) {
      setDraft(fmt(value, units))
      return
    }
    if (typeof min === 'number' && meters < min) {
      setDraft(fmt(value, units))
      return
    }
    if (meters !== value) onCommit(meters)
  }
  return (
    <label style={ROW_STYLE}>
      <span style={TINY_LABEL}>{label}</span>
      <input
        style={NUM_INPUT}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(fmt(value, units))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

export default function InspectorCard() {
  // The single-entity inspector only mounts when EXACTLY one entity has
  // been EXPLICITLY picked (one primary). When zero or multiple primaries
  // are picked, it returns null and the MultiSelectInspector takes over
  // (for >=2 primaries). We key off `primarySelectedIds`, not the full
  // effective selection — selecting a parent in extend mode includes its
  // descendants in `selectedEntityIds`, but conceptually that's still one
  // pick and InspectorCard should show the parent's pill.
  const selectedId = useGarden((s) =>
    s.primarySelectedIds.length === 1 ? s.primarySelectedIds[0] : null,
  )
  const entity = useGarden((s) => (selectedId ? s.entities[selectedId] ?? null : null))
  // Parent lookup: subscribed separately so the chip updates if the user
  // re-parents (or the parent disappears) without re-rendering the whole pill.
  const parent = useGarden((s) =>
    entity?.parentId ? s.entities[entity.parentId] ?? null : null,
  )
  const prefabCatalog = useGarden((s) => s.prefabCatalog)
  const gardenId = useGarden((s) => s.currentGardenId)
  const setToast = useGarden((s) => s.setToast)
  const clearSelection = useGarden((s) => s.clearSelection)
  const addOrUpdateEntity = useGarden((s) => s.addOrUpdateEntity)
  const removeEntity = useGarden((s) => s.removeEntity)
  const setTranslateMode = useGarden((s) => s.setTranslateMode)
  const selectEntity = useGarden((s) => s.selectEntity)
  const snapStep = useGarden((s) => s.snap)
  const units = useGarden((s) => s.units)

  const [expanded, setExpanded] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Reset transient UI state on selection change. Keying off the id (not the
  // entity object) means a streaming entity update from SignalR doesn't
  // collapse the expanded panel.
  useEffect(() => {
    setConfirmingDelete(false)
    setExpanded(false)
  }, [selectedId])

  // Keyboard arrow nudge. Mirrors the on-screen nudge pad — one tap moves
  // the selected entity by one snap step on world XZ. We pull state via
  // `useGarden.getState()` inside the handler so the listener can stay
  // mounted across selection changes without rebinding. Bail when focus is
  // on a text field (so typing in the size inputs doesn't move the entity)
  // or when no single entity is picked. Y is intentionally locked.
  useEffect(() => {
    const NUDGE_FALLBACK_M = 0.1
    const handler = (e: KeyboardEvent) => {
      if (
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight'
      )
        return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )
        return
      const s = useGarden.getState()
      if (s.primarySelectedIds.length !== 1) return
      const id = s.primarySelectedIds[0]
      const ent = s.entities[id]
      if (!ent || !s.currentGardenId) return
      const step = s.snap ?? NUDGE_FALLBACK_M
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      const dz = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      const p = ent.transform.position
      const nextTransform: Transform = {
        ...ent.transform,
        position: { x: p.x + dx * step, y: p.y, z: p.z + dz * step },
      }
      const next: GardenEntity = { ...ent, transform: nextTransform }
      s.addOrUpdateEntity(next)
      e.preventDefault()
      void updateEntity(s.currentGardenId, ent.id, { transform: nextTransform }).then(
        (updated) => useGarden.getState().addOrUpdateEntity(updated),
        (err) => {
          useGarden.getState().addOrUpdateEntity(ent)
          const msg =
            err instanceof ApiError
              ? `Nudge failed (${err.status})`
              : err instanceof Error
                ? err.message
                : 'Nudge failed'
          useGarden.getState().setToast(msg)
          console.error('[InspectorCard] nudge failed', err)
        },
      )
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Button-as-drag-handle for the ⇄ button. Tap toggles legacy translate-mode
  // (preserving the "drag the entity directly" path for power users). Press-
  // hold-drag past ~6px screen movement directly drags the entity, finger
  // staying on the button so it doesn't occlude what's being moved.
  //
  // IMPORTANT: this hook MUST be called unconditionally — i.e. above the
  // early-return below — otherwise React's hook-order check fires when the
  // selection becomes empty (entity goes null). Pass `entity ?? undefined`;
  // the hook bails harmlessly when it's missing.
  const buttonDrag = useButtonDragHandle({
    entity: entity ?? undefined,
    onTap: () =>
      entity &&
      setTranslateMode(
        useGarden.getState().translateModeId === entity.id ? null : entity.id,
      ),
  })

  if (!entity || !gardenId) return null

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
      console.error('[InspectorCard] update failed', err)
    }
  }

  const updatePosition = (axis: 'x' | 'y' | 'z', value: number) => {
    const nextTransform: Transform = {
      ...entity.transform,
      position: { ...entity.transform.position, [axis]: value },
    }
    void patch({ ...entity, transform: nextTransform }, { transform: nextTransform })
  }

  // Nudge by world XZ. Step is the active snap distance (so the chip and
  // the nudge pad always agree on what "one tap" means). Snap=off falls back
  // to a small default — without one the arrows would do nothing useful.
  const NUDGE_FALLBACK_M = 0.1
  const nudgeBy = (dx: number, dz: number) => {
    const step = snapStep ?? NUDGE_FALLBACK_M
    const p = entity.transform.position
    const nextTransform: Transform = {
      ...entity.transform,
      position: { x: p.x + dx * step, y: p.y, z: p.z + dz * step },
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

  const onRotate = () => {
    const nextRotation = rotateY90(entity.transform.rotation)
    const nextTransform: Transform = { ...entity.transform, rotation: nextRotation }
    void patch({ ...entity, transform: nextTransform }, { transform: nextTransform })
  }

  const onDuplicate = async () => {
    // Build a CreateEntityRequest matching the source entity's shape, with
    // the position offset by 0.5m on X so the duplicate doesn't z-fight.
    // After creating, jump selection to the new copy AND auto-enter translate
    // mode so the user can immediately drag it without a separate ⇄ tap.
    const body: CreateEntityRequest = {
      kind: entity.kind,
      name: entity.name ? `${entity.name} (copy)` : undefined,
      transform: {
        ...entity.transform,
        position: {
          x: entity.transform.position.x + 0.5,
          y: entity.transform.position.y,
          z: entity.transform.position.z,
        },
      },
      geometry: entity.geometry,
      tags: entity.tags ?? [],
    }
    try {
      const created = await createEntity(gardenId, body)
      addOrUpdateEntity(created)
      selectEntity(created.id) // jump selection to the new copy
      setTranslateMode(created.id) // auto-enter translate so user can immediately drag
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Duplicate failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Duplicate failed'
      setToast(msg)
      console.error('[InspectorCard] duplicate failed', err)
    }
  }

  const onDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    const id = entity.id
    removeEntity(id)
    clearSelection()
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
      console.error('[InspectorCard] delete failed', err)
    }
  }

  // Compute the size row JSX once, so it doesn't get re-invoked twice in the
  // conditional + render pass below.
  const sizeRow = (() => {
    const g = entity.geometry
    if (g.kind === 'Box') {
      const s = g.size ?? { x: 1, y: 1, z: 1 }
      return (
        <div style={ROW_STYLE}>
          <NumberField label="W" value={s.x} min={0.01} onCommit={(n) => updateBoxSize('x', n)} />
          <NumberField label="H" value={s.y} min={0.01} onCommit={(n) => updateBoxSize('y', n)} />
          <NumberField label="L" value={s.z} min={0.01} onCommit={(n) => updateBoxSize('z', n)} />
        </div>
      )
    }
    if (g.kind === 'Cylinder') {
      return (
        <div style={ROW_STYLE}>
          <NumberField label="R" value={g.radius ?? 0.04} min={0.01} onCommit={(n) => updateCylinder('radius', n)} />
          <NumberField label="H" value={g.height ?? 0.4} min={0.01} onCommit={(n) => updateCylinder('height', n)} />
        </div>
      )
    }
    if (g.size) {
      const s = g.size
      return (
        <div style={ROW_STYLE}>
          <NumberField label="W" value={s.x} min={0.01} onCommit={(n) => updateBoxSize('x', n)} />
          <NumberField label="H" value={s.y} min={0.01} onCommit={(n) => updateBoxSize('y', n)} />
          <NumberField label="L" value={s.z} min={0.01} onCommit={(n) => updateBoxSize('z', n)} />
        </div>
      )
    }
    return null
  })()

  return (
    <div
      // Fixed top-right corner so the pill is ALWAYS in the same place,
      // never covers the entity, and is far from the typical drag area.
      // Was anchored to the entity in 3D space via drei <Html>, but that
      // (a) put the action buttons right on top of the entity and made
      // button-drag pointless (finger still covered the object), and
      // (b) created weird projection edge-cases when the entity went
      // near the viewport edge. The entity's outline still indicates
      // WHICH entity is being inspected; predictable corner location wins.
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        pointerEvents: 'auto',
        maxWidth: 'calc(100vw - 32px)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Action row: type label + (optional) parent chip + buttons */}
        <div style={PILL_STYLE}>
          <span data-tour-id="insp-type-label" style={{ fontSize: 11, padding: '0 4px', color: '#bbb' }}>{typeLabel(entity)}</span>
          {parent && (
            <span
              style={{ fontSize: 10, padding: '0 4px', color: '#888' }}
              title={`Parented to ${parent.id}`}
            >
              child of {parentLabel(parent, prefabCatalog) ?? 'parent'}
            </span>
          )}
          <button data-tour-id="insp-rotate" style={ICON_BUTTON} onClick={onRotate} title="Rotate 90°">
            <span>⟳</span>
            <span style={ICON_BUTTON_LABEL}>rotate</span>
          </button>
          <button
            data-tour-id="insp-move"
            style={ICON_BUTTON}
            onPointerDown={buttonDrag.onPointerDown}
            title="Tap to toggle translate mode, or press and drag to move directly"
          >
            <span>⇄</span>
            <span style={ICON_BUTTON_LABEL}>move</span>
          </button>
          <button data-tour-id="insp-copy" style={ICON_BUTTON} onClick={onDuplicate} title="Duplicate">
            <span>📋</span>
            <span style={ICON_BUTTON_LABEL}>copy</span>
          </button>
          <button
            data-tour-id="insp-delete"
            style={confirmingDelete ? DELETE_CONFIRM : DELETE_BUTTON}
            onClick={onDelete}
            onBlur={() => setConfirmingDelete(false)}
            title={confirmingDelete ? 'Confirm delete?' : 'Delete'}
          >
            <span>🗑</span>
            <span style={ICON_BUTTON_LABEL}>{confirmingDelete ? 'confirm?' : 'delete'}</span>
          </button>
          <button
            data-tour-id="insp-size"
            style={{ ...ICON_BUTTON, background: expanded ? '#444' : ICON_BUTTON.background }}
            onClick={() => setExpanded((v) => !v)}
            title="Edit size details"
          >
            <span>⋯</span>
            <span style={ICON_BUTTON_LABEL}>size</span>
          </button>
          <button
            data-tour-id="insp-close"
            style={ICON_BUTTON}
            onClick={() => clearSelection()}
            title="Close"
          >
            <span>✕</span>
            <span style={ICON_BUTTON_LABEL}>close</span>
          </button>
        </div>

        {/* Nudge pad — 3x3 directional grid that moves the entity by one snap
            step on world XZ (Y is intentionally locked; height edits go
            through the size detail panel). Center cell shows the active step
            so the user knows what one arrow tap will do; tap-and-hold also
            repeats via native browser key-repeat when keyboard arrows are
            used in App.tsx. The pad always shows once an entity is picked —
            no extra mode toggle, since fine adjustment after a coarse drag
            is the most common workflow. */}
        <div
          data-tour-id="insp-nudge-pad"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 36px)',
            gridTemplateRows: 'repeat(3, 32px)',
            gap: 2,
            padding: 4,
            background: 'rgba(20, 22, 24, 0.92)',
            border: '1px solid #444',
            borderRadius: 8,
            pointerEvents: 'auto',
          }}
        >
          <div />
          <button style={NUDGE_BTN} onClick={() => nudgeBy(0, -1)} title="Nudge north (−Z)" aria-label="nudge north">↑</button>
          <div />
          <button style={NUDGE_BTN} onClick={() => nudgeBy(-1, 0)} title="Nudge west (−X)" aria-label="nudge west">←</button>
          <div style={NUDGE_CENTER} title={snapStep === null ? `step: ${formatLength(NUDGE_FALLBACK_M, units)} (snap off — using default)` : `step: ${formatLength(snapStep, units)}`}>
            {snapStep === null ? formatLength(NUDGE_FALLBACK_M, units) : formatLength(snapStep, units)}
          </div>
          <button style={NUDGE_BTN} onClick={() => nudgeBy(1, 0)} title="Nudge east (+X)" aria-label="nudge east">→</button>
          <div />
          <button style={NUDGE_BTN} onClick={() => nudgeBy(0, 1)} title="Nudge south (+Z)" aria-label="nudge south">↓</button>
          <div />
        </div>

        {/* Detail panel — collapsible. Shows BOTH position and size when
            expanded. Position is no longer permanently visible above the pill. */}
        {expanded && (
          <div style={DETAIL_STYLE}>
            <div style={ROW_STYLE}>
              <span style={TINY_LABEL}>Pos</span>
              <NumberField label="X" value={entity.transform.position.x} onCommit={(n) => updatePosition('x', n)} />
              <NumberField label="Y" value={entity.transform.position.y} onCommit={(n) => updatePosition('y', n)} />
              <NumberField label="Z" value={entity.transform.position.z} onCommit={(n) => updatePosition('z', n)} />
            </div>
            {sizeRow && (
              <div style={ROW_STYLE}>
                <span style={TINY_LABEL}>Size</span>
                {sizeRow}
              </div>
            )}
          </div>
        )}
    </div>
  )
}
