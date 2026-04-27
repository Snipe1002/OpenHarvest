/**
 * MultiSelectInspector — bottom-center HTML overlay shown when the user has
 * 2+ entities selected. Mirrors the InspectorCard's utilitarian dark-pill
 * visual language but exposes mass operations across the whole selection
 * instead of single-entity edits.
 *
 * Position rationale: bottom-center, sitting just above MainToolbar (which
 * is at bottom:16). The single InspectorCard floats anchored to its entity
 * in 3D. Bottom-center gives this inspector its own real estate that
 * doesn't fight with the toolbar, and the user tends to look there for
 * edit-mode controls already.
 *
 * Operations:
 *   - 🗑 Delete all   — two-step confirm; DELETE every selected entity in
 *                       parallel; revert all on any failure.
 *   - 📋 Duplicate all — POST a copy of each (offset +0.5m on X), then jump
 *                       the selection to the new copies.
 *   - ⟳ Rotate 90°    — rotate every entity around the GROUP CENTROID on
 *                       world Y. Each entity's local position relative to
 *                       the centroid is rotated 90° on Y; its own quaternion
 *                       is also multiplied by Y90 so its facing matches.
 *   - ⇄ Translate     — flip groupTranslateActive on; the user then pointer-
 *                       downs any selected entity and drags the whole group.
 *   - ↔ Distribute X  — needs >=3; sort selection by X, keep extremes,
 *                       redistribute middle entities at equal spacing.
 *   - ↕ Distribute Z  — same on Z.
 *   - ⇤/⇥ Align L/R   — set every selected entity's X to min/max X.
 *   - ⇩/⇧ Align T/B(Z) — set every selected entity's Z to min/max Z.
 *   - ✕ Close         — clearSelection().
 *
 * Optimism + revert: every op snapshots the affected entities at start,
 * applies the local mutation immediately, then PATCHes in parallel via
 * Promise.all. If any PATCH rejects, we restore every entity to the
 * snapshot and surface a toast. Single delete failures revert the
 * entity that failed back into the store.
 *
 * Coordinate convention: X is east-west, Z is north-south on the y=0
 * ground plane. "Top" / "Bottom" map to min Z / max Z respectively (Three.js
 * default — looking down +Y, +Z points "down" on the screen). The icons are
 * suggestive, not strict, so we annotate the tooltips.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { ApiError, createEntity, deleteEntity, updateEntity } from '../api/client'
import type { CreateEntityRequest, GardenEntity, Quaternion } from '../api/types'
import { useGarden } from '../store/garden'
import { formatLength } from '../store/unitsHelpers'

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
  border: '1px solid #4ec9ff',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
  userSelect: 'none',
}

/**
 * Bottom offset is set dynamically by `useToolbarOffset` (below) so we always
 * sit above MainToolbar with a clean 12px gap, even when the toolbar wraps to
 * two lines on a narrow phone or grows new buttons. Hard-coding `bottom:90`
 * worked while the toolbar was a single row but eclipsed itself once the
 * House section wrapped underneath the Garden section on phone widths.
 */
const WRAP_STYLE_BASE: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  zIndex: 12,
}

const TOOLBAR_GAP_PX = 12 // gap between MainToolbar's top edge and our bottom edge
const FALLBACK_BOTTOM_PX = 96 // used while toolbar isn't yet measurable

/**
 * Reads MainToolbar's actual rendered height + bottom offset and returns
 * the `bottom` value our pill should use to clear it. Updates on toolbar
 * resize (e.g. when the prefab picker opens, or when the row wraps because
 * the viewport got narrower).
 */
function useToolbarOffset(): number {
  const [offset, setOffset] = useState(FALLBACK_BOTTOM_PX)
  useLayoutEffect(() => {
    const el = document.querySelector('[data-toolbar="main"]') as HTMLElement | null
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const cs = window.getComputedStyle(el)
      const toolbarBottom = parseInt(cs.bottom || '16', 10) || 16
      setOffset(toolbarBottom + rect.height + TOOLBAR_GAP_PX)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return offset
}

const ICON_BUTTON: React.CSSProperties = {
  width: 28,
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

const ACTIVE_BUTTON: React.CSSProperties = {
  ...ICON_BUTTON,
  background: 'rgba(60, 130, 200, 0.85)',
  borderColor: '#4a90c8',
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

const DISABLED_BUTTON: React.CSSProperties = {
  ...ICON_BUTTON,
  opacity: 0.4,
  cursor: 'not-allowed',
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid #4ec9ff',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto',
}

/**
 * Format a length in meters in the active unit system. Used for the
 * centroid readout in the header. We keep this thin wrapper so the unit
 * selector flows in via the hook without threading the value through
 * every helper signature.
 */
function fmt(n: number, units: 'metric' | 'imperial'): string {
  if (!Number.isFinite(n)) return units === 'metric' ? '0 m' : "0'0\""
  return formatLength(n, units)
}

function describeKindBreakdown(entities: GardenEntity[]): string {
  const counts = new Map<string, number>()
  for (const e of entities) {
    const key = e.geometry.prefabRef ?? e.kind ?? 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [k, n] of counts) {
    parts.push(`${n} ${k}${n > 1 ? 's' : ''}`)
  }
  return parts.join(', ')
}

function centroidOf(entities: GardenEntity[]): { x: number; y: number; z: number } {
  if (entities.length === 0) return { x: 0, y: 0, z: 0 }
  let sx = 0
  let sy = 0
  let sz = 0
  for (const e of entities) {
    sx += e.transform.position.x
    sy += e.transform.position.y
    sz += e.transform.position.z
  }
  const n = entities.length
  return { x: sx / n, y: sy / n, z: sz / n }
}

/** Compose qOuter * qInner (THREE convention; q1.multiply(q2) = q1 * q2). */
function quatMul(qOuter: Quaternion, qInner: Quaternion): Quaternion {
  const a = new THREE.Quaternion(qOuter.x, qOuter.y, qOuter.z, qOuter.w)
  const b = new THREE.Quaternion(qInner.x, qInner.y, qInner.z, qInner.w)
  const r = a.clone().multiply(b)
  return { x: r.x, y: r.y, z: r.z, w: r.w }
}

/** A 90-degree rotation around world +Y, as a quaternion. */
const Y90: Quaternion = (() => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  return { x: q.x, y: q.y, z: q.z, w: q.w }
})()

interface MassOpResult {
  ok: boolean
}

export default function MultiSelectInspector() {
  // We snapshot the array of selected ids in selection order. Each entity is
  // looked up from the entities dict so a streaming SignalR upsert doesn't
  // tear the inspector. Using an array + dict keeps re-renders predictable.
  const selectedIds = useGarden((s) => s.selectedEntityIds)
  const entitiesDict = useGarden((s) => s.entities)
  const gardenId = useGarden((s) => s.currentGardenId)
  const setToast = useGarden((s) => s.setToast)
  const addOrUpdateEntity = useGarden((s) => s.addOrUpdateEntity)
  const removeEntity = useGarden((s) => s.removeEntity)
  const selectEntities = useGarden((s) => s.selectEntities)
  const clearSelection = useGarden((s) => s.clearSelection)
  const groupTranslateActive = useGarden((s) => s.groupTranslateActive)
  const setGroupTranslateActive = useGarden((s) => s.setGroupTranslateActive)
  const units = useGarden((s) => s.units)

  const selected: GardenEntity[] = useMemo(() => {
    const out: GardenEntity[] = []
    for (const id of selectedIds) {
      const e = entitiesDict[id]
      if (e) out.push(e)
    }
    return out
  }, [selectedIds, entitiesDict])

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  // Reset transient UI state when the selection changes.
  useEffect(() => {
    setConfirmingDelete(false)
  }, [selectedIds])

  // Esc cancels group-translate mode. Selection is left intact (Esc clearing
  // selection itself is a separate decision; user may want to keep picks).
  useEffect(() => {
    if (!groupTranslateActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGroupTranslateActive(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [groupTranslateActive, setGroupTranslateActive])

  // IMPORTANT: every hook must run on every render — including the
  // toolbar-offset measurement — otherwise React's hook-order check fires
  // when this component conditionally returns null below. Keep this above
  // the early return.
  const toolbarBottom = useToolbarOffset()

  if (selected.length < 2 || !gardenId) return null

  const centroid = centroidOf(selected)

  // -------------------------------------------------------------------------
  // Mass-op helpers
  // -------------------------------------------------------------------------
  const applyOptimisticPatch = async (
    next: GardenEntity[],
  ): Promise<MassOpResult> => {
    const originals = selected.map((e) => ({ ...e }))
    for (const e of next) addOrUpdateEntity(e)
    setBusy(true)
    try {
      await Promise.all(
        next.map((e) =>
          updateEntity(gardenId, e.id, { transform: e.transform }).then((server) =>
            addOrUpdateEntity(server),
          ),
        ),
      )
      return { ok: true }
    } catch (err) {
      // Revert every entity in the working set.
      for (const orig of originals) addOrUpdateEntity(orig)
      const msg =
        err instanceof ApiError
          ? `Mass update failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Mass update failed'
      setToast(msg)
      console.error('[MultiSelectInspector] mass PATCH failed', err)
      return { ok: false }
    } finally {
      setBusy(false)
    }
  }

  const onDeleteAll = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    const targets = selected.map((e) => ({ ...e }))
    setBusy(true)
    // Optimistic local removal + selection clear.
    for (const e of targets) removeEntity(e.id)
    clearSelection()
    try {
      await Promise.all(targets.map((e) => deleteEntity(gardenId, e.id)))
    } catch (err) {
      // Revert: re-insert every entity. Selection isn't restored to avoid
      // surprising the user after a partial failure — they can re-select.
      for (const orig of targets) addOrUpdateEntity(orig)
      const msg =
        err instanceof ApiError
          ? `Delete failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Delete failed'
      setToast(msg)
      console.error('[MultiSelectInspector] mass DELETE failed', err)
    } finally {
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  const onDuplicateAll = async () => {
    setBusy(true)
    try {
      const created = await Promise.all(
        selected.map((e) => {
          const body: CreateEntityRequest = {
            kind: e.kind,
            name: e.name ? `${e.name} (copy)` : undefined,
            transform: {
              ...e.transform,
              position: {
                x: e.transform.position.x + 0.5,
                y: e.transform.position.y,
                z: e.transform.position.z,
              },
            },
            geometry: e.geometry,
            tags: e.tags ?? [],
          }
          return createEntity(gardenId, body)
        }),
      )
      for (const c of created) addOrUpdateEntity(c)
      selectEntities(created.map((c) => c.id))
      // Auto-enter group translate so the user can immediately drag the new
      // copies as a group without an extra ⇄ tap.
      setGroupTranslateActive(true)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Duplicate failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Duplicate failed'
      setToast(msg)
      console.error('[MultiSelectInspector] mass duplicate failed', err)
    } finally {
      setBusy(false)
    }
  }

  const onRotate = async () => {
    // Rotate every entity 90° around the GROUP CENTROID on world Y.
    // For each entity:
    //   localOffset = position - centroid (XZ; Y is preserved)
    //   rotated     = rotateY(localOffset, 90°)
    //   newPosition = centroid + rotated
    //   newRotation = Y90 * existingRotation  (so the entity faces the new direction)
    const next: GardenEntity[] = selected.map((e) => {
      const dx = e.transform.position.x - centroid.x
      const dz = e.transform.position.z - centroid.z
      // Rotation matrix for +90° around Y (right-handed, Y up):
      //   x' =  z
      //   z' = -x
      const rdx = dz
      const rdz = -dx
      return {
        ...e,
        transform: {
          ...e.transform,
          position: {
            x: centroid.x + rdx,
            y: e.transform.position.y,
            z: centroid.z + rdz,
          },
          rotation: quatMul(Y90, e.transform.rotation),
        },
      }
    })
    await applyOptimisticPatch(next)
  }

  const onAlignX = async (mode: 'min' | 'max') => {
    let target = selected[0].transform.position.x
    for (const e of selected) {
      const x = e.transform.position.x
      if (mode === 'min' ? x < target : x > target) target = x
    }
    const next = selected.map((e) => ({
      ...e,
      transform: {
        ...e.transform,
        position: { ...e.transform.position, x: target },
      },
    }))
    await applyOptimisticPatch(next)
  }

  const onAlignZ = async (mode: 'min' | 'max') => {
    let target = selected[0].transform.position.z
    for (const e of selected) {
      const z = e.transform.position.z
      if (mode === 'min' ? z < target : z > target) target = z
    }
    const next = selected.map((e) => ({
      ...e,
      transform: {
        ...e.transform,
        position: { ...e.transform.position, z: target },
      },
    }))
    await applyOptimisticPatch(next)
  }

  const onDistribute = async (axis: 'x' | 'z') => {
    if (selected.length < 3) return
    // Sort by axis ascending; keep first/last fixed; redistribute middles
    // at equal spacing between them.
    const sorted = [...selected].sort(
      (a, b) => a.transform.position[axis] - b.transform.position[axis],
    )
    const lo = sorted[0].transform.position[axis]
    const hi = sorted[sorted.length - 1].transform.position[axis]
    const step = (hi - lo) / (sorted.length - 1)
    // Build new entities for the middles only; extremes pass through.
    const updates: Record<string, GardenEntity> = {}
    for (let i = 1; i < sorted.length - 1; i++) {
      const e = sorted[i]
      const target = lo + step * i
      updates[e.id] = {
        ...e,
        transform: {
          ...e.transform,
          position: { ...e.transform.position, [axis]: target },
        },
      }
    }
    // Apply in selection order so the optimistic patcher snapshots match.
    const next = selected.map((e) => updates[e.id] ?? e)
    await applyOptimisticPatch(next)
  }

  const canDistribute = selected.length >= 3
  const buttonDisabled = busy

  const breakdown = describeKindBreakdown(selected)
  const wrapStyle: React.CSSProperties = { ...WRAP_STYLE_BASE, bottom: toolbarBottom }

  return (
    <div style={wrapStyle} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div style={HEADER_STYLE}>
        <span style={{ color: '#4ec9ff', fontWeight: 600 }}>{selected.length} selected</span>
        <span style={{ color: '#aaa' }}>— {breakdown}</span>
        <span style={{ color: '#888' }}>
          centroid ({fmt(centroid.x, units)}, {fmt(centroid.y, units)}, {fmt(centroid.z, units)})
        </span>
      </div>

      <div style={PILL_STYLE}>
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={onRotate}
          disabled={buttonDisabled}
          title="Rotate group 90° around centroid (world Y)"
        >
          ⟳
        </button>
        <button
          style={
            buttonDisabled
              ? DISABLED_BUTTON
              : groupTranslateActive
                ? ACTIVE_BUTTON
                : ICON_BUTTON
          }
          onClick={() => setGroupTranslateActive(!groupTranslateActive)}
          disabled={buttonDisabled}
          title={
            groupTranslateActive
              ? 'Group translate ON — drag any selected entity to move all (Esc to exit)'
              : 'Enter group translate (drag any selected entity to move all)'
          }
        >
          ⇄
        </button>
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={onDuplicateAll}
          disabled={buttonDisabled}
          title="Duplicate all (offset +0.5m on X)"
        >
          📋
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          style={buttonDisabled || !canDistribute ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onDistribute('x')}
          disabled={buttonDisabled || !canDistribute}
          title={canDistribute ? 'Distribute along X (equal spacing, extremes fixed)' : 'Distribute X — needs 3+ selected'}
        >
          ↔
        </button>
        <button
          style={buttonDisabled || !canDistribute ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onDistribute('z')}
          disabled={buttonDisabled || !canDistribute}
          title={canDistribute ? 'Distribute along Z (equal spacing, extremes fixed)' : 'Distribute Z — needs 3+ selected'}
        >
          ↕
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onAlignX('min')}
          disabled={buttonDisabled}
          title="Align Left (min X)"
        >
          ⇤
        </button>
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onAlignX('max')}
          disabled={buttonDisabled}
          title="Align Right (max X)"
        >
          ⇥
        </button>
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onAlignZ('min')}
          disabled={buttonDisabled}
          title="Align Top — minimum Z (toward camera-back in default view)"
        >
          ⇩
        </button>
        <button
          style={buttonDisabled ? DISABLED_BUTTON : ICON_BUTTON}
          onClick={() => onAlignZ('max')}
          disabled={buttonDisabled}
          title="Align Bottom — maximum Z"
        >
          ⇧
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          style={confirmingDelete ? DELETE_CONFIRM : buttonDisabled ? DISABLED_BUTTON : DELETE_BUTTON}
          onClick={onDeleteAll}
          onBlur={() => setConfirmingDelete(false)}
          disabled={buttonDisabled}
          title={confirmingDelete ? 'Confirm delete?' : 'Delete all selected'}
        >
          🗑
        </button>
        <button
          style={ICON_BUTTON}
          onClick={() => clearSelection()}
          title="Close (clear selection)"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
