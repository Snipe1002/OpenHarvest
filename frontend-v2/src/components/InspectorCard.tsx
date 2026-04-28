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
import * as THREE from 'three'
import { Html } from '@react-three/drei'
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

/**
 * drei `<Html>` `calculatePosition` override. Replicates the default
 * world→screen projection but clamps the result to viewport with a margin
 * so the pill never disappears off-screen when the entity is near (or past)
 * the visible frustum edge. Reusing a Vector3 across calls avoids per-frame
 * allocations.
 */
const HTML_VIEWPORT_MARGIN_PX = 16
const HTML_PILL_HALF_W_PX = 160
const HTML_PILL_HALF_H_PX = 60
const _projVec = new THREE.Vector3()
function CLAMPED_HTML_POSITION(
  el: THREE.Object3D,
  camera: THREE.Camera,
  size: { width: number; height: number },
): [number, number] {
  el.getWorldPosition(_projVec)
  _projVec.project(camera)
  const widthHalf = size.width / 2
  const heightHalf = size.height / 2
  const rawX = _projVec.x * widthHalf + widthHalf
  const rawY = -(_projVec.y * heightHalf) + heightHalf
  const minX = HTML_VIEWPORT_MARGIN_PX + HTML_PILL_HALF_W_PX
  const maxX = size.width - HTML_VIEWPORT_MARGIN_PX - HTML_PILL_HALF_W_PX
  const minY = HTML_VIEWPORT_MARGIN_PX + HTML_PILL_HALF_H_PX
  const maxY = size.height - HTML_VIEWPORT_MARGIN_PX - HTML_PILL_HALF_H_PX
  return [
    Math.max(minX, Math.min(maxX, rawX)),
    Math.max(minY, Math.min(maxY, rawY)),
  ]
}

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

const ICON_BUTTON: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 13,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
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

function anchorOffsetY(entity: GardenEntity): number {
  // Above the top of the entity's bounding box, with a small padding.
  const size = entity.geometry.size
  if (size) return size.y + 0.3
  if (typeof entity.geometry.height === 'number') return entity.geometry.height + 0.3
  return 1.5
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
  // The single-entity inspector only mounts when EXACTLY one entity is
  // selected. When zero or multiple are selected, it returns null and the
  // MultiSelectInspector takes over (for >=2). We intentionally subscribe to
  // the id only and look the entity up from the entities dict in a separate
  // selector — this way a re-render caused by an entity-content change
  // doesn't churn the `entity` reference identity for useEffect deps that
  // key off `entity.id`.
  const selectedId = useGarden((s) =>
    s.selectedEntityIds.length === 1 ? s.selectedEntityIds[0] : null,
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

  const [expanded, setExpanded] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Reset transient UI state on selection change. Keying off the id (not the
  // entity object) means a streaming entity update from SignalR doesn't
  // collapse the expanded panel.
  useEffect(() => {
    setConfirmingDelete(false)
    setExpanded(false)
  }, [selectedId])

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

  const { x: ax, y: ay, z: az } = entity.transform.position
  const yOffset = anchorOffsetY(entity)

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
    <Html
      position={[ax, ay + yOffset, az]}
      center
      // Clamp the projected screen position so the pill never sails off the
      // viewport when the entity is near (or beyond) the visible frustum.
      // Default drei behavior sets x/y wherever projection lands, including
      // negative coords or coords past size.width/height — visually the pill
      // disappears even though the entity is selected. Clamp keeps it pinned
      // to the nearest viewport edge with a margin.
      calculatePosition={CLAMPED_HTML_POSITION}
      // drei's wrapper has its own root; we keep it pointer-event-transparent
      // and rely on per-pill pointerEvents:auto so empty-space clicks fall
      // through to the canvas.
      style={{ pointerEvents: 'none' }}
    >
      <div
        // The flex column owns its own pointer-events so all descendants
        // (pill + detail panel) reliably receive clicks. Without this, the
        // `pointerEvents:'none'` from the parent <Html> can mask click
        // hit-testing on touch devices in particular.
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'auto',
        }}
        // Stop pointerdown from reaching the canvas (camera orbit) AND stop
        // click from reaching the canvas (deselect on empty-ground click).
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Action row: type label + (optional) parent chip + buttons */}
        <div style={PILL_STYLE}>
          <span style={{ fontSize: 11, padding: '0 4px', color: '#bbb' }}>{typeLabel(entity)}</span>
          {parent && (
            <span
              style={{ fontSize: 10, padding: '0 4px', color: '#888' }}
              title={`Parented to ${parent.id}`}
            >
              child of {parentLabel(parent, prefabCatalog) ?? 'parent'}
            </span>
          )}
          <button style={ICON_BUTTON} onClick={onRotate} title="Rotate 90°">
            ⟳
          </button>
          <button
            style={ICON_BUTTON}
            onPointerDown={buttonDrag.onPointerDown}
            title="Tap to toggle translate mode, or press and drag to move directly"
          >
            ⇄
          </button>
          <button style={ICON_BUTTON} onClick={onDuplicate} title="Duplicate">
            📋
          </button>
          <button
            style={confirmingDelete ? DELETE_CONFIRM : DELETE_BUTTON}
            onClick={onDelete}
            onBlur={() => setConfirmingDelete(false)}
            title={confirmingDelete ? 'Confirm delete?' : 'Delete'}
          >
            🗑
          </button>
          <button
            style={{ ...ICON_BUTTON, background: expanded ? '#444' : ICON_BUTTON.background }}
            onClick={() => setExpanded((v) => !v)}
            title="Edit size details"
          >
            ⋯
          </button>
          <button
            style={ICON_BUTTON}
            onClick={() => clearSelection()}
            title="Close"
          >
            ✕
          </button>
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
    </Html>
  )
}
