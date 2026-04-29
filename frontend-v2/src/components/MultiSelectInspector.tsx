/**
 * MultiSelectInspector — bottom-center HTML overlay shown when the user has
 * 2+ ENTITIES PRIMARILY selected. Mirrors the InspectorCard's utilitarian
 * dark-pill visual language but exposes mass operations across the whole
 * selection instead of single-entity edits.
 *
 * Selection model (m#7c): macro ops operate on `primarySelectedIds` — the
 * explicit picks — NOT on the expanded effective selection. Three's scene
 * graph already cascades parent transforms onto children, so moving the
 * primary picks is enough; including descendants would double-move them.
 * The header reports the primary count and notes how many descendants
 * came along via "extend" mode.
 *
 * Level-awareness: every primary's `parentId` is examined. If they all
 * share a parentId (or all are top-level), level-sensitive ops (Distribute,
 * Normalize, Align, Rotate) operate within that local frame. If primaries
 * span multiple hierarchy levels — e.g. one bed plus a plant from a DIFFERENT
 * bed — those ops are disabled with a tooltip explaining why. Delete-all
 * and Duplicate-all stay enabled because they don't depend on a shared
 * coordinate frame.
 *
 * Position rationale: bottom-center, sitting just above MainToolbar (which
 * is at bottom:16). The single InspectorCard floats anchored to its entity
 * in 3D. Bottom-center gives this inspector its own real estate that
 * doesn't fight with the toolbar, and the user tends to look there for
 * edit-mode controls already.
 *
 * Operations:
 *   - 🗑 Delete all   — two-step confirm; DELETE every primary entity in
 *                       parallel; revert all on any failure.
 *   - 📋 Duplicate all — POST a copy of each primary (offset +0.5m on X),
 *                       then jump the selection to the new copies.
 *   - ⟳ Rotate 90°    — rotate every primary around the GROUP CENTROID on
 *                       world Y. (Disabled on mixed levels.)
 *   - ⇄ Translate     — flip groupTranslateActive on; the user then pointer-
 *                       downs any selected entity and drags the whole group.
 *   - ↔ Normalize     — distribute primaries evenly along the longest
 *                       extent axis (X or Z) at equal spacing between
 *                       extremes. Picks the axis automatically. Y is left
 *                       alone. Disabled on mixed levels.
 *   - ↔ Distribute X  — needs >=3; sort primaries by X, keep extremes,
 *                       redistribute middle entities at equal spacing.
 *                       (Disabled on mixed levels.)
 *   - ↕ Distribute Z  — same on Z. (Disabled on mixed levels.)
 *   - ⇤/⇥ Align L/R   — set every primary's X to min/max X. (Disabled on
 *                       mixed levels.)
 *   - ⇩/⇧ Align T/B(Z) — set every primary's Z to min/max Z. (Disabled on
 *                       mixed levels.)
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ApiError, createEntity, deleteEntity, updateEntity } from '../api/client'
import type { CreateEntityRequest, GardenEntity, Quaternion } from '../api/types'
import { useGarden } from '../store/garden'
import { formatLength, parseLength } from '../store/unitsHelpers'
import NudgePad from './NudgePad'
import { useButtonDragHandle } from './useButtonDragHandle'

const PILL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  // Allow the action bar to wrap to a second row when the labeled-button
  // variant is active — 13 buttons at 36px each don't fit on a phone width
  // viewport without wrapping.
  flexWrap: 'wrap',
  rowGap: 4,
  gap: 4,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 16,
  border: '1px solid #4ec9ff',
  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
  pointerEvents: 'auto',
  userSelect: 'none',
  justifyContent: 'center',
  maxWidth: 'calc(100vw - 24px)',
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

// Labeled variant — used when the user has Labels: on. Stacks a small
// lowercase word under the glyph so touch users (iOS Safari hides title
// tooltips) can tell what each one does at a glance. The icon stays the
// same size; the height grows to ~38px and width grows to ~36px.
const ICON_BUTTON_LABELED: React.CSSProperties = {
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

const ARRANGE_PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  // Translucent so the user can see the live ghost-preview of the layout
  // through the panel as they drag sliders. Backdrop blur keeps text
  // readable against busy backgrounds.
  background: 'rgba(20, 22, 24, 0.55)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  border: '1px solid rgba(78, 201, 255, 0.7)',
  borderRadius: 8,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 11,
  color: '#e5e5e5',
  pointerEvents: 'auto',
  minWidth: 280,
  boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
}

const SLIDER_STYLE: React.CSSProperties = {
  flex: 2,
  cursor: 'pointer',
  accentColor: '#4ec9ff',
}

const TAB_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
}

const TAB_BTN: React.CSSProperties = {
  flex: 1,
  background: '#2a2d31',
  color: '#aaa',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const TAB_BTN_ACTIVE: React.CSSProperties = {
  ...TAB_BTN,
  background: 'rgba(60, 130, 200, 0.85)',
  borderColor: '#4a90c8',
  color: '#fff',
}

const FIELD_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const FIELD_LABEL: React.CSSProperties = {
  width: 64,
  color: '#888',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
}

const FIELD_INPUT: React.CSSProperties = {
  flex: 1,
  background: '#0e1012',
  color: '#e5e5e5',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
  fontFamily: 'inherit',
}

const APPLY_BTN: React.CSSProperties = {
  flex: 1,
  background: 'rgba(60, 130, 200, 0.85)',
  color: '#fff',
  border: '1px solid #4a90c8',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const CANCEL_BTN: React.CSSProperties = {
  flex: 1,
  background: '#2a2d31',
  color: '#bbb',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
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
  // m#7c: macro ops scope to PRIMARY picks only. Three's scene graph already
  // cascades parent transforms onto descendants, so moving primaries is
  // enough — including descendants would double-move them. We still read
  // the effective selection length to know when to render at all (the
  // multi-inspector should be silent if the user only has one primary even
  // if descendants make the effective list >=2 — InspectorCard handles that).
  const selectedIds = useGarden((s) => s.primarySelectedIds)
  // Effective selection — used for the centroid + descendant count surface
  // in the header so the user can see "this op covers 12 entities total".
  const effectiveIds = useGarden((s) => s.selectedEntityIds)
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
  const showLabels = useGarden((s) => s.showButtonLabels)

  const selected: GardenEntity[] = useMemo(() => {
    const out: GardenEntity[] = []
    for (const id of selectedIds) {
      const e = entitiesDict[id]
      if (e) out.push(e)
    }
    return out
  }, [selectedIds, entitiesDict])

  // Hierarchy level analysis. `commonParentId` is:
  //   - null  : every primary is top-level (no parentId)
  //   - <id>  : every primary shares the same parentId (and is non-null)
  //   - 'mixed': primaries span different parentIds — level-sensitive ops
  //     can't run because we'd be mixing local frames.
  // `levelLabel` is rendered in the header for context.
  const { commonParentId, levelLabel } = useMemo(() => {
    if (selected.length === 0) {
      return { commonParentId: 'mixed' as const, levelLabel: '' }
    }
    const first = selected[0].parentId ?? null
    let allSame = true
    for (const e of selected) {
      const pid = e.parentId ?? null
      if (pid !== first) {
        allSame = false
        break
      }
    }
    if (!allSame) return { commonParentId: 'mixed' as const, levelLabel: 'mixed levels' }
    if (first === null) return { commonParentId: null, levelLabel: 'top-level' }
    const parent = entitiesDict[first]
    const parentName = parent?.name ?? parent?.geometry.prefabRef ?? parent?.kind ?? 'parent'
    return { commonParentId: first, levelLabel: `children of ${parentName}` }
  }, [selected, entitiesDict])

  const isMixedLevel = commonParentId === 'mixed'

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [arrangeMode, setArrangeMode] = useState<'grid' | 'ring'>('grid')
  // Each numeric input is paired with a text draft. The meters/integer
  // values drive the live preview AND the slider position; the text drafts
  // give the user free-form imperial / metric typing. Slider movement
  // updates both. Text edits update the draft on every keystroke and the
  // canonical value only when the parse succeeds.
  const [cols, setCols] = useState(1)
  const [gapXm, setGapXm] = useState(0.5)
  const [gapZm, setGapZm] = useState(0.5)
  const [radiusM, setRadiusM] = useState(1)
  const [startAngleDeg, setStartAngleDeg] = useState(0)
  const [colsText, setColsText] = useState('1')
  const [gapXText, setGapXText] = useState('')
  const [gapZText, setGapZText] = useState('')
  const [radiusText, setRadiusText] = useState('')
  const [angleText, setAngleText] = useState('0')
  // Snapshot of every primary's pre-arrange state. We layout from this so
  // the centroid doesn't drift as the user adjusts inputs (each preview
  // applies to the snapshot, not to the already-previewed positions).
  // Restored on Cancel or precondition loss; cleared on Apply success.
  const snapshotRef = useRef<Record<string, GardenEntity> | null>(null)

  // Reset transient UI state when the selection changes. If an arrange
  // preview was in progress, restore every entity from the snapshot — the
  // store still holds preview positions for the original selection's
  // entities even after they were deselected, so without this they'd be
  // stuck in the previewed layout.
  useEffect(() => {
    setConfirmingDelete(false)
    if (snapshotRef.current) {
      const store = useGarden.getState()
      for (const id of Object.keys(snapshotRef.current)) {
        store.addOrUpdateEntity(snapshotRef.current[id])
      }
      snapshotRef.current = null
    }
    setArrangeOpen(false)
  }, [selectedIds])

  // Esc cancels an in-progress arrange preview (restoring the snapshot).
  useEffect(() => {
    if (!arrangeOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (snapshotRef.current) {
          const store = useGarden.getState()
          for (const id of Object.keys(snapshotRef.current)) {
            store.addOrUpdateEntity(snapshotRef.current[id])
          }
          snapshotRef.current = null
        }
        setArrangeOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [arrangeOpen])

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

  // Button-as-drag-handle for the group-translate ⇄. Tap toggles
  // `groupTranslateActive` (legacy behavior — drag any selected entity);
  // press-hold-drag past ~6px screen movement drags the whole selection
  // directly with the leader being the first selected id. Hook MUST be
  // called unconditionally — keep above the early return.
  const groupButtonDrag = useButtonDragHandle({
    onTap: () => setGroupTranslateActive(!groupTranslateActive),
    getSelectedIds: () => useGarden.getState().selectedEntityIds,
  })

  // -------------------------------------------------------------------------
  // Arrange-wizard defaults — MUST live above the early return so the hook
  // count stays stable across selection-count transitions (going from 1 to 2
  // primaries previously crashed the whole tree with a hooks-order error).
  // The body returns sane fallbacks when the selection is empty or singular
  // so the wizard input placeholders are still computable on the very first
  // render after the panel opens.
  // -------------------------------------------------------------------------
  const arrangeDefaults = useMemo(() => {
    const snap = useGarden.getState().snap ?? 0.5
    const n = selected.length
    if (n === 0) return { cols: 1, gap: snap, radius: snap * 2 }
    // Small selections (≤4) default to a single row — for 2 beds the
    // "rows × cols" framing felt absurd to the user. Larger selections get
    // the roughly-square √N layout.
    const cols = n <= 4 ? n : Math.max(1, Math.round(Math.sqrt(n)))
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity
    for (const e of selected) {
      const { x, z } = e.transform.position
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const extent = Math.max(maxX - minX, maxZ - minZ, snap * 2)
    return { cols, gap: snap, radius: Math.max(extent / 2, snap * 2) }
  }, [selected])

  // When the panel opens, snapshot the current selection and seed every
  // input from the computed defaults. The snapshot is the layout origin
  // for live preview — Cancel restores from it, Apply discards it. Above
  // the early return so the hook count stays stable.
  useEffect(() => {
    if (!arrangeOpen) return
    const s = useGarden.getState()
    const snap: Record<string, GardenEntity> = {}
    for (const id of s.primarySelectedIds) {
      const e = s.entities[id]
      if (e) snap[id] = JSON.parse(JSON.stringify(e)) as GardenEntity
    }
    snapshotRef.current = snap
    setCols(arrangeDefaults.cols)
    setColsText(String(arrangeDefaults.cols))
    setGapXm(arrangeDefaults.gap)
    setGapZm(arrangeDefaults.gap)
    setRadiusM(arrangeDefaults.radius)
    setStartAngleDeg(0)
    setGapXText(formatLength(arrangeDefaults.gap, units))
    setGapZText(formatLength(arrangeDefaults.gap, units))
    setRadiusText(formatLength(arrangeDefaults.radius, units))
    setAngleText('0')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeOpen])

  // When the user flips units while the panel is open, re-format the text
  // drafts so they show the new system. Keep the underlying meters values
  // unchanged.
  useEffect(() => {
    if (!arrangeOpen) return
    setGapXText(formatLength(gapXm, units))
    setGapZText(formatLength(gapZm, units))
    setRadiusText(formatLength(radiusM, units))
  }, [units, arrangeOpen, gapXm, gapZm, radiusM])

  // Live preview — recompute layout from the SNAPSHOT on every input
  // change and apply optimistically to the local store. No PATCH yet; the
  // user sees the preview update in real time as they drag a slider or
  // type a value. Apply commits via PATCH; Cancel restores from snapshot.
  useEffect(() => {
    if (!arrangeOpen) return
    const snap = snapshotRef.current
    if (!snap) return
    const ids = Object.keys(snap)
    if (ids.length === 0) return
    const entitiesArr = ids.map((id) => snap[id])
    let cx = 0,
      cz = 0
    for (const e of entitiesArr) {
      cx += e.transform.position.x
      cz += e.transform.position.z
    }
    cx /= entitiesArr.length
    cz /= entitiesArr.length
    let layout: GardenEntity[]
    if (arrangeMode === 'grid') {
      const totalCols = Math.max(1, Math.min(cols, entitiesArr.length))
      const totalRows = Math.ceil(entitiesArr.length / totalCols)
      const gridWidth = (totalCols - 1) * gapXm
      const gridHeight = (totalRows - 1) * gapZm
      const x0 = cx - gridWidth / 2
      const z0 = cz - gridHeight / 2
      layout = entitiesArr.map((e, i) => {
        const col = i % totalCols
        const row = Math.floor(i / totalCols)
        return {
          ...e,
          transform: {
            ...e.transform,
            position: { x: x0 + col * gapXm, y: e.transform.position.y, z: z0 + row * gapZm },
          },
        }
      })
    } else {
      const startRad = (startAngleDeg * Math.PI) / 180
      const step = (2 * Math.PI) / entitiesArr.length
      layout = entitiesArr.map((e, i) => {
        const angle = startRad + i * step
        return {
          ...e,
          transform: {
            ...e.transform,
            position: {
              x: cx + radiusM * Math.cos(angle),
              y: e.transform.position.y,
              z: cz + radiusM * Math.sin(angle),
            },
          },
        }
      })
    }
    const store = useGarden.getState()
    for (const e of layout) store.addOrUpdateEntity(e)
  }, [arrangeOpen, arrangeMode, cols, gapXm, gapZm, radiusM, startAngleDeg])

  // Group keyboard nudge — arrow keys translate every primary by one snap
  // step on world XZ when 2+ are selected. Mirrors InspectorCard's
  // single-entity nudge so desktop fine-tune works the same way regardless
  // of selection size. Above the early return to keep hook count stable.
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
      if (s.primarySelectedIds.length < 2 || !s.currentGardenId) return
      const step = s.snap ?? NUDGE_FALLBACK_M
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      const dz = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      e.preventDefault()
      const next: GardenEntity[] = s.primarySelectedIds
        .map((id) => s.entities[id])
        .filter((ent): ent is GardenEntity => !!ent)
        .map((ent) => ({
          ...ent,
          transform: {
            ...ent.transform,
            position: {
              x: ent.transform.position.x + dx * step,
              y: ent.transform.position.y,
              z: ent.transform.position.z + dz * step,
            },
          },
        }))
      // Optimistic local update + parallel PATCH. Reuse the same pattern as
      // applyOptimisticPatch but inline so it can run from this effect's
      // closure without depending on the not-yet-defined helper.
      const gid = s.currentGardenId
      for (const ent of next) s.addOrUpdateEntity(ent)
      void Promise.all(
        next.map((ent) =>
          updateEntity(gid, ent.id, { transform: ent.transform }).then(
            (server) => useGarden.getState().addOrUpdateEntity(server),
            (err) => {
              console.error('[MultiSelectInspector] keyboard nudge failed', err)
              useGarden.getState().setToast('Nudge failed')
            },
          ),
        ),
      )
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  /**
   * Normalize — distribute primaries evenly along whichever in-plane axis
   * (X or Z) is the longest extent of the current selection. The user
   * doesn't have to think about which axis applies; we look at
   * |maxX - minX| vs |maxZ - minZ| and pick the bigger one. Y is left
   * untouched. Ties go to X (arbitrary but stable).
   *
   * With <3 selected the op is a no-op (nothing to redistribute), matching
   * Distribute X / Z. Caller should disable the button at <3 too.
   */
  const onNormalize = async () => {
    if (selected.length < 3) return
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const e of selected) {
      const { x, z } = e.transform.position
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const xExtent = maxX - minX
    const zExtent = maxZ - minZ
    // If both extents are effectively zero the points overlap — give up.
    if (xExtent < 1e-6 && zExtent < 1e-6) return
    const axis: 'x' | 'z' = xExtent >= zExtent ? 'x' : 'z'
    await onDistribute(axis)
  }

  // -------------------------------------------------------------------------
  // Group fine-tune nudge — translates every primary by one snap step on
  // world XZ. Backed by the standard mass-PATCH helper so partial failures
  // revert the whole batch.
  // -------------------------------------------------------------------------
  const NUDGE_FALLBACK_M = 0.1
  const snapStep = useGarden.getState().snap ?? NUDGE_FALLBACK_M
  const nudgeBy = (dx: number, dz: number) => {
    const next: GardenEntity[] = selected.map((e) => ({
      ...e,
      transform: {
        ...e.transform,
        position: {
          x: e.transform.position.x + dx * snapStep,
          y: e.transform.position.y,
          z: e.transform.position.z + dz * snapStep,
        },
      },
    }))
    void applyOptimisticPatch(next)
  }
  // Vertical group nudge — raise or lower every primary by one step on
  // world Y. Floor at y=0 so the group never sinks below ground.
  const nudgeYBy = (dy: number) => {
    const next: GardenEntity[] = selected.map((e) => ({
      ...e,
      transform: {
        ...e.transform,
        position: {
          x: e.transform.position.x,
          y: Math.max(0, e.transform.position.y + dy * snapStep),
          z: e.transform.position.z,
        },
      },
    }))
    void applyOptimisticPatch(next)
  }

  // -------------------------------------------------------------------------
  // Arrange — cartesian grid + polar ring layout helpers.
  //
  // Both place primaries in *selection order* (the order they were tapped),
  // anchored at the current group centroid so opening the wizard never
  // teleports the cluster across the scene. Y is preserved per-entity so
  // beds on a sloped surface or plants at varying heights don't collapse to
  // a single plane.
  //
  // We compute a sensible default for each unspecified input on first open
  // (cols ≈ √N, gap = active snap or 0.5m, radius = current max in-plane
  // extent / 2) so a user can hit Apply without filling anything in. The
  // useMemo / seed-useEffect that drive these defaults moved above the
  // early return — see notes there.
  // -------------------------------------------------------------------------
  // Apply commits the live preview — local entities already sit at the
  // previewed positions, we just send the PATCH for each one. On success
  // the snapshot is dropped so reopening the panel captures fresh state.
  // On failure we restore from the snapshot via onArrangeCancel so the
  // user isn't stuck with half-applied positions.
  const onArrangeApply = async () => {
    const snap = snapshotRef.current
    if (!snap) {
      setArrangeOpen(false)
      return
    }
    const ids = Object.keys(snap)
    const s = useGarden.getState()
    const current = ids
      .map((id) => s.entities[id])
      .filter((e): e is GardenEntity => !!e)
    setBusy(true)
    try {
      await Promise.all(
        current.map((e) =>
          updateEntity(gardenId, e.id, { transform: e.transform }).then((server) =>
            useGarden.getState().addOrUpdateEntity(server),
          ),
        ),
      )
      snapshotRef.current = null
      setArrangeOpen(false)
    } catch (err) {
      const store = useGarden.getState()
      for (const id of ids) {
        const orig = snap[id]
        if (orig) store.addOrUpdateEntity(orig)
      }
      const msg =
        err instanceof ApiError
          ? `Arrange apply failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Arrange apply failed'
      setToast(msg)
      console.error('[MultiSelectInspector] arrange apply failed', err)
    } finally {
      setBusy(false)
    }
  }

  // Cancel restores every primary from the snapshot taken when the panel
  // opened. Same handler runs when the user toggles the ▤ button off, hits
  // Esc, or the precondition is lost (selection cleared mid-preview).
  const onArrangeCancel = () => {
    const snap = snapshotRef.current
    if (snap) {
      const store = useGarden.getState()
      for (const id of Object.keys(snap)) {
        store.addOrUpdateEntity(snap[id])
      }
      snapshotRef.current = null
    }
    setArrangeOpen(false)
  }

  const canDistribute = selected.length >= 3
  // Level-sensitive ops (Distribute, Normalize, Align, Rotate) require all
  // primaries share a coordinate frame. When the selection spans multiple
  // levels — e.g. a top-level bed AND a plant inside a different bed — the
  // local frames don't line up, so disable the op rather than producing a
  // visually nonsensical result. Delete + Duplicate stay enabled because
  // they don't depend on a shared frame.
  const levelLockedDisabled = isMixedLevel
  const buttonDisabled = busy
  const distributeTooltipSuffix = canDistribute
    ? ''
    : ' — needs 3+ primaries'
  const mixedTooltip =
    'Selection spans hierarchy levels — pick items at one level to use this.'

  const descendantCount = effectiveIds.length - selectedIds.length
  const breakdown = describeKindBreakdown(selected)
  const wrapStyle: React.CSSProperties = { ...WRAP_STYLE_BASE, bottom: toolbarBottom }

  // When the user has Labels: on, swap every action-pill button to the
  // taller icon+label variant. The five style refs below are the only
  // states a button can be in (base, active, delete, delete-confirm,
  // disabled); deriving them once here keeps the JSX simple.
  const baseBtn = showLabels ? ICON_BUTTON_LABELED : ICON_BUTTON
  const activeBtn: React.CSSProperties = showLabels
    ? { ...ICON_BUTTON_LABELED, background: 'rgba(60, 130, 200, 0.85)', borderColor: '#4a90c8' }
    : ACTIVE_BUTTON
  const deleteBtn: React.CSSProperties = showLabels
    ? { ...ICON_BUTTON_LABELED, background: '#5a1f1f', borderColor: '#8a2a2a' }
    : DELETE_BUTTON
  const deleteConfirmBtn: React.CSSProperties = showLabels
    ? { ...ICON_BUTTON_LABELED, background: '#a02a2a', borderColor: '#c04040' }
    : DELETE_CONFIRM
  const disabledBtn: React.CSSProperties = showLabels
    ? { ...ICON_BUTTON_LABELED, opacity: 0.4, cursor: 'not-allowed' }
    : DISABLED_BUTTON

  // Render an icon glyph plus optional lowercase label below it. Used
  // inside every action-pill button so the label is conditional on the
  // showLabels store flag.
  const lbl = (icon: string, label: string) =>
    showLabels ? (
      <>
        <span>{icon}</span>
        <span style={ICON_BUTTON_LABEL}>{label}</span>
      </>
    ) : (
      icon
    )

  return (
    <div style={wrapStyle} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div data-tour-id="multi-header" style={HEADER_STYLE}>
        <span style={{ color: '#4ec9ff', fontWeight: 600 }}>{selected.length} selected</span>
        {levelLabel && (
          <span style={{ color: isMixedLevel ? '#ffaa00' : '#aaa' }}>— {levelLabel}</span>
        )}
        <span style={{ color: '#aaa' }}>— {breakdown}</span>
        {descendantCount > 0 && (
          <span style={{ color: '#888' }}>(+{descendantCount} descendants)</span>
        )}
        <span style={{ color: '#888' }}>
          centroid ({fmt(centroid.x, units)}, {fmt(centroid.y, units)}, {fmt(centroid.z, units)})
        </span>
      </div>

      {arrangeOpen && (
        <div style={ARRANGE_PANEL_STYLE}>
          <div data-tour-id="arrange-tabs" style={TAB_ROW_STYLE}>
            <button
              style={arrangeMode === 'grid' ? TAB_BTN_ACTIVE : TAB_BTN}
              onClick={() => setArrangeMode('grid')}
            >
              Grid (cartesian)
            </button>
            <button
              style={arrangeMode === 'ring' ? TAB_BTN_ACTIVE : TAB_BTN}
              onClick={() => setArrangeMode('ring')}
            >
              Ring (polar)
            </button>
          </div>
          {arrangeMode === 'grid' ? (
            <>
              <div data-tour-id="arrange-grid-cols" style={FIELD_ROW}>
                <span style={FIELD_LABEL}>Cols</span>
                <input
                  type="range"
                  style={SLIDER_STYLE}
                  min={1}
                  max={Math.max(1, selected.length)}
                  step={1}
                  value={cols}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    setCols(v)
                    setColsText(String(v))
                  }}
                />
                <input
                  style={{ ...FIELD_INPUT, flex: 'none', width: 44 }}
                  inputMode="numeric"
                  value={colsText}
                  onChange={(e) => {
                    setColsText(e.target.value)
                    const v = parseInt(e.target.value, 10)
                    if (Number.isFinite(v) && v >= 1 && v <= selected.length) setCols(v)
                  }}
                />
                <span style={{ color: '#888', fontSize: 10, whiteSpace: 'nowrap' }}>
                  × {Math.ceil(selected.length / Math.max(1, cols))} rows
                </span>
              </div>
              <div data-tour-id="arrange-grid-gap-x" style={FIELD_ROW}>
                <span style={FIELD_LABEL} title="Spacing between columns (world X axis)">Col gap</span>
                <input
                  type="range"
                  style={SLIDER_STYLE}
                  min={0}
                  max={3}
                  step={0.01}
                  value={Math.min(gapXm, 3)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setGapXm(v)
                    setGapXText(formatLength(v, units))
                  }}
                />
                <input
                  style={{ ...FIELD_INPUT, flex: 'none', width: 70 }}
                  value={gapXText}
                  onChange={(e) => {
                    setGapXText(e.target.value)
                    const v = parseLength(e.target.value, units)
                    if (v !== null && v >= 0) setGapXm(v)
                  }}
                />
              </div>
              <div data-tour-id="arrange-grid-gap-z" style={FIELD_ROW}>
                <span style={FIELD_LABEL} title="Spacing between rows (world Z axis)">Row gap</span>
                <input
                  type="range"
                  style={SLIDER_STYLE}
                  min={0}
                  max={3}
                  step={0.01}
                  value={Math.min(gapZm, 3)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setGapZm(v)
                    setGapZText(formatLength(v, units))
                  }}
                />
                <input
                  style={{ ...FIELD_INPUT, flex: 'none', width: 70 }}
                  value={gapZText}
                  onChange={(e) => {
                    setGapZText(e.target.value)
                    const v = parseLength(e.target.value, units)
                    if (v !== null && v >= 0) setGapZm(v)
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div data-tour-id="arrange-ring-radius" style={FIELD_ROW}>
                <span style={FIELD_LABEL}>Radius</span>
                <input
                  type="range"
                  style={SLIDER_STYLE}
                  min={0.05}
                  max={Math.max(5, arrangeDefaults.radius * 2)}
                  step={0.01}
                  value={radiusM}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setRadiusM(v)
                    setRadiusText(formatLength(v, units))
                  }}
                />
                <input
                  style={{ ...FIELD_INPUT, flex: 'none', width: 70 }}
                  value={radiusText}
                  onChange={(e) => {
                    setRadiusText(e.target.value)
                    const v = parseLength(e.target.value, units)
                    if (v !== null && v > 0) setRadiusM(v)
                  }}
                />
              </div>
              <div data-tour-id="arrange-ring-start" style={FIELD_ROW}>
                <span style={FIELD_LABEL}>Start °</span>
                <input
                  type="range"
                  style={SLIDER_STYLE}
                  min={0}
                  max={360}
                  step={1}
                  value={startAngleDeg}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    setStartAngleDeg(v)
                    setAngleText(String(v))
                  }}
                />
                <input
                  style={{ ...FIELD_INPUT, flex: 'none', width: 50 }}
                  inputMode="decimal"
                  value={angleText}
                  onChange={(e) => {
                    setAngleText(e.target.value)
                    const v = parseFloat(e.target.value)
                    if (Number.isFinite(v)) setStartAngleDeg(v)
                  }}
                />
                <span style={{ color: '#888', fontSize: 10, whiteSpace: 'nowrap' }}>
                  step {(360 / Math.max(1, selected.length)).toFixed(1)}°
                </span>
              </div>
            </>
          )}
          <div style={{ ...FIELD_ROW, marginTop: 2 }}>
            <button style={CANCEL_BTN} onClick={onArrangeCancel} disabled={busy}>
              Cancel
            </button>
            <button data-tour-id="arrange-apply" style={APPLY_BTN} onClick={onArrangeApply} disabled={busy}>
              {busy ? 'Applying…' : `Apply to ${selected.length}`}
            </button>
          </div>
        </div>
      )}
      {/* Group nudge pad — same component InspectorCard uses for single-
          entity fine-tune, but the callback translates every primary at
          once. Sits just above the action pill so the fine-tune workflow
          flows visually downward into the macro-op buttons. */}
      <NudgePad step={snapStep} units={units} onNudge={nudgeBy} onNudgeY={nudgeYBy} tourId="multi-nudge-pad" />
      <div style={PILL_STYLE}>
        <button
          data-tour-id="multi-rotate"
          style={buttonDisabled || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={onRotate}
          disabled={buttonDisabled || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : 'Rotate group 90° around centroid (world Y)'
          }
        >
          {lbl('⟳', 'rotate')}
        </button>
        <button
          data-tour-id="multi-translate"
          style={
            buttonDisabled ? disabledBtn : groupTranslateActive ? activeBtn : baseBtn
          }
          onPointerDown={buttonDisabled ? undefined : groupButtonDrag.onPointerDown}
          disabled={buttonDisabled}
          title={
            groupTranslateActive
              ? 'Group translate ON — tap to exit, or press and drag this button to move all (Esc to exit)'
              : 'Tap to enter group translate, or press and drag this button to move all directly'
          }
        >
          {lbl('⇄', 'move')}
        </button>
        <button
          data-tour-id="multi-duplicate"
          style={buttonDisabled ? disabledBtn : baseBtn}
          onClick={onDuplicateAll}
          disabled={buttonDisabled}
          title="Duplicate all (offset +0.5m on X) — works on any selection"
        >
          {lbl('📋', 'copy')}
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          data-tour-id="multi-normalize"
          style={buttonDisabled || !canDistribute || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={onNormalize}
          disabled={buttonDisabled || !canDistribute || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : canDistribute
                ? 'Normalize — distribute evenly along the longest axis'
                : `Normalize${distributeTooltipSuffix}`
          }
        >
          {lbl('⇔', 'norm')}
        </button>
        <button
          data-tour-id="multi-distribute-x"
          style={buttonDisabled || !canDistribute || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onDistribute('x')}
          disabled={buttonDisabled || !canDistribute || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : canDistribute
                ? 'Distribute along X (equal spacing, extremes fixed)'
                : `Distribute X${distributeTooltipSuffix}`
          }
        >
          {lbl('↔', 'dist x')}
        </button>
        <button
          data-tour-id="multi-distribute-z"
          style={buttonDisabled || !canDistribute || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onDistribute('z')}
          disabled={buttonDisabled || !canDistribute || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : canDistribute
                ? 'Distribute along Z (equal spacing, extremes fixed)'
                : `Distribute Z${distributeTooltipSuffix}`
          }
        >
          {lbl('↕', 'dist z')}
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          data-tour-id="multi-align-l"
          style={buttonDisabled || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onAlignX('min')}
          disabled={buttonDisabled || levelLockedDisabled}
          title={levelLockedDisabled ? mixedTooltip : 'Align Left (min X)'}
        >
          {lbl('⇤', 'align l')}
        </button>
        <button
          data-tour-id="multi-align-r"
          style={buttonDisabled || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onAlignX('max')}
          disabled={buttonDisabled || levelLockedDisabled}
          title={levelLockedDisabled ? mixedTooltip : 'Align Right (max X)'}
        >
          {lbl('⇥', 'align r')}
        </button>
        <button
          data-tour-id="multi-align-t"
          style={buttonDisabled || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onAlignZ('min')}
          disabled={buttonDisabled || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : 'Align Top — minimum Z (toward camera-back in default view)'
          }
        >
          {lbl('⇩', 'align t')}
        </button>
        <button
          data-tour-id="multi-align-b"
          style={buttonDisabled || levelLockedDisabled ? disabledBtn : baseBtn}
          onClick={() => onAlignZ('max')}
          disabled={buttonDisabled || levelLockedDisabled}
          title={levelLockedDisabled ? mixedTooltip : 'Align Bottom — maximum Z'}
        >
          {lbl('⇧', 'align b')}
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          data-tour-id="multi-arrange"
          style={
            buttonDisabled || levelLockedDisabled
              ? disabledBtn
              : arrangeOpen
                ? activeBtn
                : baseBtn
          }
          onClick={() => (arrangeOpen ? onArrangeCancel() : setArrangeOpen(true))}
          disabled={buttonDisabled || levelLockedDisabled}
          title={
            levelLockedDisabled
              ? mixedTooltip
              : 'Arrange in a grid or ring around the centroid (live preview)'
          }
        >
          {lbl('▤', 'arrange')}
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 2px' }} />
        <button
          data-tour-id="multi-delete"
          style={confirmingDelete ? deleteConfirmBtn : buttonDisabled ? disabledBtn : deleteBtn}
          onClick={onDeleteAll}
          onBlur={() => setConfirmingDelete(false)}
          disabled={buttonDisabled}
          title={confirmingDelete ? 'Confirm delete?' : 'Delete all selected primaries'}
        >
          {lbl('🗑', confirmingDelete ? 'confirm?' : 'delete')}
        </button>
        <button
          data-tour-id="multi-close"
          style={baseBtn}
          onClick={() => clearSelection()}
          title="Close (clear selection)"
        >
          {lbl('✕', 'close')}
        </button>
      </div>
    </div>
  )
}
