/**
 * RegionPaint — visual + control surface for drag-paint-region mode.
 *
 * Coexists with DemoGround.tsx, which owns the pointer-down/move/up pipeline
 * on the ground mesh. This component is a pure read-of-store visualizer +
 * configuring popover. Lifecycle:
 *
 *   1. awaiting-first-corner: nothing rendered (the toolbar pill alone tells
 *      the user what to do).
 *   2. awaiting-second-corner: cyan rectangle outline tracks the live drag.
 *   3. configuring: same outline + ghost children laid out in the rows×cols
 *      grid + an HTML popover anchored at the rectangle's center for tweaking
 *      the grid params and applying / cancelling.
 *
 * Two scopes share this code path (see `RegionScope` in store/garden.ts):
 *   - `world`: ghosts are translucent BEDS at world ground (original m#10a).
 *   - `fill-container`: ghosts are translucent PLANTS rendered at the parent's
 *     top surface Y. Apply commits Plant entities parented to the container,
 *     with local-space positions (world XZ minus parent world XZ).
 *
 * Position math (rectangle from snapped corners, internal cell layout):
 *   x0..x1 / z0..z1 = sorted corners (world XZ in both scopes)
 *   usableW = (x1-x0) - spacing*(cols-1)   →  per-cell width
 *   usableL = (z1-z0) - spacing*(rows-1)   →  per-cell length
 *   centerX(c) = x0 + cellW/2 + c*(cellW + spacing)
 *   centerZ(r) = z0 + cellL/2 + r*(cellL + spacing)
 *
 * Why corners stay in WORLD coords even in fill-container scope: the cyan
 * outline is mounted at the top of the R3F tree (sibling of all entities), so
 * world coords let it draw without re-implementing the parent transform. The
 * world→local conversion happens once at Apply time per child.
 *
 * v0 limitation: parent rotation is IGNORED. Children's local positions are
 * computed by simple subtraction `(worldX - parentWorldX, 0, worldZ - parentWorldZ)`,
 * which is only correct for axis-aligned parents. This matches DemoGround.tsx's
 * single-click placement convention and is acceptable for the v0 fill mode.
 *
 * Apply: parallel POSTs (one per ghost). Successes are inserted optimistically
 * and the new ids replace the selection so the user can immediately
 * group-translate. Failures don't roll back successes; we toast the failure
 * count.
 *
 * Sticky-aware re-entry: when stickyPlacement is true, Apply re-arms the
 * pipeline at `awaiting-first-corner` carrying the SAME scope so a fill-mode
 * paint stays in fill mode. Esc still cancels.
 *
 * Edge cases:
 *   - Parent entity is removed mid-paint (e.g. another agent deletes it via
 *     SignalR): we abort with a toast and clear regionPaint.
 *   - Selection changes mid-paint while in fill scope: we abort with a toast.
 *     The user can re-select and re-arm. (Multi-select is allowed to remain
 *     after Apply because the new children are auto-selected — see Apply.)
 */
import { useEffect, useMemo, useState } from 'react'
import { Html, Line } from '@react-three/drei'
import { ApiError, createEntity } from '../api/client'
import type { CreateEntityRequest, GardenEntity, Vector3 } from '../api/types'
import {
  useGarden,
  type RegionBedSize,
  type RegionPaintConfiguring,
  type RegionScope,
} from '../store/garden'
import { formatLength, parseLength, type Units } from '../store/unitsHelpers'

const RECT_COLOR = '#4ec9ff'
const RECT_LINE_WIDTH = 2
const RECT_Y = 0.02 // a hair above the ground plane to avoid z-fight
const RECT_FILL_LIFT = 0.005 // lift outline a hair above parent surface in fill mode
const GHOST_COLOR = '#6b4423' // wood, matches DemoBed plank color
const GHOST_PLANT_COLOR = '#4a8a3a' // matches DemoPlant stem
const GHOST_OPACITY = 0.3
const GHOST_DEFAULT_HEIGHT = 0.4 // matches default bed height
// Ghost plant geometry — mirrors DemoGround.tsx's defaultPlantGeometry so the
// preview matches what Apply will actually create.
const GHOST_PLANT_RADIUS = 0.04
const GHOST_PLANT_HEIGHT = 0.4
const POPOVER_Y = 0.3 // float popover above the ground
const MIN_CELL = 0.05 // refuse to render ghost cells smaller than 5cm — they'd be unusable

const POPOVER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'rgba(20, 22, 24, 0.92)',
  color: '#e5e5e5',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSize: 12,
  padding: 8,
  borderRadius: 6,
  border: '1px solid #444',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  pointerEvents: 'auto',
  userSelect: 'none',
  minWidth: 220,
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const LABEL_STYLE: React.CSSProperties = {
  width: 56,
  color: '#bbb',
  fontSize: 11,
}

const STEPPER_BUTTON: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 3,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
}

const STEPPER_VALUE: React.CSSProperties = {
  width: 28,
  textAlign: 'center',
  color: '#e5e5e5',
  fontSize: 12,
}

const TEXT_INPUT: React.CSSProperties = {
  width: 70,
  background: '#0e1012',
  color: '#e5e5e5',
  border: '1px solid #333',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
  fontFamily: 'inherit',
}

const APPLY_BUTTON: React.CSSProperties = {
  flex: 1,
  background: '#2e5b2e',
  color: '#e5ffe5',
  border: '1px solid #4a8a4a',
  borderRadius: 3,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const CANCEL_BUTTON: React.CSSProperties = {
  flex: 1,
  background: '#5a1f1f',
  color: '#ffe5e5',
  border: '1px solid #8a2a2a',
  borderRadius: 3,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const APPLY_BUTTON_DISABLED: React.CSSProperties = {
  ...APPLY_BUTTON,
  opacity: 0.4,
  cursor: 'not-allowed',
}

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

function sortedRect(a: [number, number], b: [number, number]): Rect {
  return {
    x0: Math.min(a[0], b[0]),
    x1: Math.max(a[0], b[0]),
    z0: Math.min(a[1], b[1]),
    z1: Math.max(a[1], b[1]),
  }
}

interface CellLayout {
  /** World-space center of each ghost bed. */
  centers: Array<{ x: number; z: number }>
  /** Per-cell box size (auto-fit value or the explicit override echoed back). */
  cellSize: { x: number; y: number; z: number }
  /** Whether the rectangle is too small / cells too tiny to render meaningfully. */
  degenerate: boolean
}

function computeLayout(state: RegionPaintConfiguring): CellLayout {
  const rect = sortedRect(state.firstCorner, state.secondCorner)
  const rectW = rect.x1 - rect.x0
  const rectL = rect.z1 - rect.z0
  const cols = Math.max(1, state.cols | 0)
  const rows = Math.max(1, state.rows | 0)
  const spacing = Math.max(0, state.spacingM)

  // Per-axis usable space = total - gap*(n-1). Negative means user has
  // demanded more spacing than the rectangle can hold; degrade gracefully by
  // marking degenerate so the popover can show "0 beds" and disable Apply.
  const usableW = rectW - spacing * (cols - 1)
  const usableL = rectL - spacing * (rows - 1)
  let cellW: number
  let cellL: number
  if (state.bedSize === 'auto') {
    cellW = usableW / cols
    cellL = usableL / rows
  } else {
    cellW = state.bedSize.x
    cellL = state.bedSize.z
  }

  const degenerate =
    cellW < MIN_CELL ||
    cellL < MIN_CELL ||
    rectW < MIN_CELL ||
    rectL < MIN_CELL

  // First cell starts at the rectangle's edge plus half its own width.
  // Subsequent cells step by cellW + spacing along the axis.
  const centers: Array<{ x: number; z: number }> = []
  if (!degenerate) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        centers.push({
          x: rect.x0 + cellW / 2 + c * (cellW + spacing),
          z: rect.z0 + cellL / 2 + r * (cellL + spacing),
        })
      }
    }
  }

  const sizeY =
    state.bedSize === 'auto' ? GHOST_DEFAULT_HEIGHT : state.bedSize.y
  return {
    centers,
    cellSize: { x: cellW, y: sizeY, z: cellL },
    degenerate,
  }
}

/** Outline points for a rectangle in XZ — closed loop (5 vertices, last == first)
 *  so drei's <Line> draws all four edges. Y is `outlineY`, lifted slightly
 *  above whichever surface (ground or parent top) the rectangle is anchored to. */
function rectOutlinePoints(rect: Rect, outlineY: number): Array<[number, number, number]> {
  return [
    [rect.x0, outlineY, rect.z0],
    [rect.x1, outlineY, rect.z0],
    [rect.x1, outlineY, rect.z1],
    [rect.x0, outlineY, rect.z1],
    [rect.x0, outlineY, rect.z0],
  ]
}

interface StepperProps {
  value: number
  min: number
  onChange: (next: number) => void
}

function Stepper({ value, min, onChange }: StepperProps) {
  return (
    <div style={ROW_STYLE}>
      <button
        style={STEPPER_BUTTON}
        onClick={() => onChange(Math.max(min, value - 1))}
        title="Decrease"
      >
        −
      </button>
      <span style={STEPPER_VALUE}>{value}</span>
      <button
        style={STEPPER_BUTTON}
        onClick={() => onChange(value + 1)}
        title="Increase"
      >
        +
      </button>
    </div>
  )
}

interface LengthInputProps {
  meters: number
  onCommit: (meters: number) => void
  /** Minimum legal value in meters. */
  min?: number
}

/**
 * Tiny length-bearing input that displays + parses the active unit system,
 * mirroring InspectorCard's NumberField but inlined here so we don't have to
 * surface that file's internals. Internal value is meters.
 */
function LengthInput({ meters, onCommit, min }: LengthInputProps) {
  const units = useGarden((s) => s.units)
  const fmt = (n: number, u: Units) => formatLength(n, u)
  const [draft, setDraft] = useState<string>(fmt(meters, units))
  useEffect(() => {
    setDraft(fmt(meters, units))
  }, [meters, units])
  const commit = () => {
    const parsed = parseLength(draft, units)
    if (parsed === null || !Number.isFinite(parsed)) {
      setDraft(fmt(meters, units))
      return
    }
    if (typeof min === 'number' && parsed < min) {
      setDraft(fmt(meters, units))
      return
    }
    if (parsed !== meters) onCommit(parsed)
  }
  return (
    <input
      style={TEXT_INPUT}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(fmt(meters, units))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/**
 * Single ghost bed — translucent box matching the DemoBed silhouette without
 * the plank/soil detail. Rendered inside a group at the bed's world position
 * with the box's bottom flush with y=0.
 */
function GhostBed({
  position,
  size,
}: {
  position: { x: number; z: number }
  size: { x: number; y: number; z: number }
}) {
  const w = Math.max(size.x, 0.01)
  const h = Math.max(size.y, 0.01)
  const l = Math.max(size.z, 0.01)
  return (
    <mesh position={[position.x, h / 2, position.z]}>
      <boxGeometry args={[w, h, l]} />
      <meshStandardMaterial
        color={GHOST_COLOR}
        transparent
        opacity={GHOST_OPACITY}
        depthWrite={false}
      />
    </mesh>
  )
}

/**
 * Single ghost plant — translucent green cylinder matching the DemoPlant stem.
 * `position.y` is the world-space base of the cylinder (i.e. the parent's top
 * surface Y). The cylinder is centered at y = base + height/2 so it stands ON
 * the surface rather than sinking into it. We render this directly in world
 * coords (sibling of the rectangle outline) instead of inside the parent's
 * `<group>` because RegionPaint mounts at the App level, not inside the entity
 * tree — re-parenting the whole component would require deeper refactoring
 * and the visual result is identical at v0 (parent rotation is ignored).
 */
function GhostPlant({
  position,
}: {
  position: { x: number; y: number; z: number }
}) {
  const r = GHOST_PLANT_RADIUS
  const h = GHOST_PLANT_HEIGHT
  return (
    <mesh position={[position.x, position.y + h / 2, position.z]}>
      <cylinderGeometry args={[r, r, h, 8]} />
      <meshStandardMaterial
        color={GHOST_PLANT_COLOR}
        transparent
        opacity={GHOST_OPACITY}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function RegionPaint() {
  const regionPaint = useGarden((s) => s.regionPaint)
  const setRegionPaint = useGarden((s) => s.setRegionPaint)
  const stickyPlacement = useGarden((s) => s.stickyPlacement)
  const currentGardenId = useGarden((s) => s.currentGardenId)
  const addOrUpdateEntity = useGarden((s) => s.addOrUpdateEntity)
  const selectEntities = useGarden((s) => s.selectEntities)
  const setToast = useGarden((s) => s.setToast)
  // Subscribed for the edge-case watcher below — when fill scope is active we
  // need to abort if the parent disappears or the user changes selection.
  const entities = useGarden((s) => s.entities)
  const selectedEntityIds = useGarden((s) => s.selectedEntityIds)
  const [applying, setApplying] = useState(false)

  // Edge case watcher (fill-container scope only):
  //  - parent removed → abort + toast
  //  - selection changed away from the parent → abort + toast
  // Both conditions are silently ignored in world scope, where there is no
  // parent to track. We deliberately do NOT abort on `applying` — the apply
  // path itself drives the selection change to the new children.
  useEffect(() => {
    if (!regionPaint) return
    if (regionPaint.scope.kind !== 'fill-container') return
    if (applying) return
    const { parentId, parentLabel } = regionPaint.scope
    if (!entities[parentId]) {
      setToast(`${parentLabel} was removed — region paint cancelled`)
      setRegionPaint(null)
      return
    }
    // Selection-change abort: the user must keep the parent selected through
    // the paint. If they tap a different entity (or clear selection) we treat
    // that as an intent change and bail.
    const stillSelected =
      selectedEntityIds.length === 1 && selectedEntityIds[0] === parentId
    if (!stillSelected) {
      setToast(`Selection changed — region paint cancelled`)
      setRegionPaint(null)
    }
  }, [regionPaint, entities, selectedEntityIds, applying, setRegionPaint, setToast])

  // Hooks must run unconditionally — derive layout / rect even when phase ≠
  // configuring (we just don't render the popover or ghosts in those cases).
  const rect = useMemo<Rect | null>(() => {
    if (!regionPaint) return null
    if (regionPaint.phase === 'awaiting-first-corner') return null
    return sortedRect(regionPaint.firstCorner, regionPaint.secondCorner)
  }, [regionPaint])

  const layout = useMemo<CellLayout | null>(() => {
    if (!regionPaint || regionPaint.phase !== 'configuring') return null
    return computeLayout(regionPaint)
  }, [regionPaint])

  if (!regionPaint || !rect) return null

  const isConfiguring = regionPaint.phase === 'configuring'

  const updateConfig = (
    patch: Partial<Pick<RegionPaintConfiguring, 'rows' | 'cols' | 'spacingM' | 'bedSize'>>,
  ) => {
    if (!isConfiguring) return
    setRegionPaint({ ...regionPaint, ...patch })
  }

  const apply = async () => {
    if (!isConfiguring || !layout || !currentGardenId) return
    if (layout.degenerate || layout.centers.length === 0) return
    setApplying(true)
    const scope: RegionScope = regionPaint.scope
    let bodies: CreateEntityRequest[]
    let childNoun: string
    if (scope.kind === 'fill-container') {
      // Fill mode: emit Plant entities parented to the container, with local
      // positions (world XZ minus parent world XZ). Y is the parent's top
      // surface in the parent's LOCAL frame — we recompute it from the
      // entity's current position in case the parent moved between arming
      // and Apply (snapshotted parentWorldX/Z is safe to keep using as long
      // as the parent didn't rotate; v0 ignores rotation).
      const parent = useGarden.getState().entities[scope.parentId]
      if (!parent) {
        setToast('Parent was removed — region paint cancelled')
        setApplying(false)
        setRegionPaint(null)
        return
      }
      // Re-derive local surface Y from the catalog spec to stay correct if the
      // parent's vertical position changed since arming.
      const catalog = useGarden.getState().prefabCatalog
      const slug = parent.geometry.prefabRef
      const spec = slug && catalog ? catalog[slug] : null
      const localSurfaceY = spec?.surface?.y ?? 0
      bodies = layout.centers.map((c) => ({
        kind: 'Plant',
        name: 'Plant',
        parentId: scope.parentId,
        transform: {
          position: {
            x: c.x - scope.parentWorldX,
            y: localSurfaceY,
            z: c.z - scope.parentWorldZ,
          },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        geometry: {
          kind: 'Cylinder',
          radius: GHOST_PLANT_RADIUS,
          height: GHOST_PLANT_HEIGHT,
        },
        tags: [],
      }))
      childNoun = 'plant'
    } else {
      const size: Vector3 = {
        x: Math.max(layout.cellSize.x, 0.01),
        y: Math.max(layout.cellSize.y, 0.01),
        z: Math.max(layout.cellSize.z, 0.01),
      }
      bodies = layout.centers.map((c) => ({
        kind: 'Bed',
        name: 'Bed',
        transform: {
          position: { x: c.x, y: 0, z: c.z },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        geometry: { kind: 'Box', size },
        tags: [],
      }))
      childNoun = 'bed'
    }
    // Parallel POSTs. Successful inserts are kept even if peers fail —
    // partial-success rollback wasn't asked for and would surprise the user
    // who can already see the optimistic ghosts.
    const results = await Promise.allSettled(
      bodies.map((b) => createEntity(currentGardenId, b)),
    )
    const created: GardenEntity[] = []
    let failed = 0
    for (const r of results) {
      if (r.status === 'fulfilled') {
        addOrUpdateEntity(r.value)
        created.push(r.value)
      } else {
        failed++
        const err = r.reason
        const msg =
          err instanceof ApiError
            ? `Create failed (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Create failed'
        // Log every failure for debugging; toast a summary below.
        console.error('[RegionPaint] createEntity failed', err, msg)
      }
    }
    if (failed > 0) {
      setToast(
        `Region paint: ${failed} of ${bodies.length} ${childNoun}${
          bodies.length === 1 ? '' : 's'
        } failed`,
      )
    }
    if (created.length > 0) {
      // Jump selection to the new children so the user can immediately
      // group-translate / inspect them. In fill scope this also intentionally
      // breaks the "selection must be the parent" invariant the edge-case
      // watcher uses, but applying is finished by then so the watcher won't
      // re-fire with a stale scope.
      selectEntities(created.map((c) => c.id))
    }
    setApplying(false)
    if (stickyPlacement) {
      // Sticky: re-arm so the user can paint another region. Carry the SAME
      // scope through — a fill-mode paint that "stuck" should keep filling
      // the same container, not flip back to world mode (the children we
      // just created replaced the selection, so re-deriving scope from the
      // current selection would not pick up the original parent).
      setRegionPaint({ phase: 'awaiting-first-corner', scope })
    } else {
      setRegionPaint(null)
    }
  }

  const cancel = () => setRegionPaint(null)

  // In fill-container scope the rectangle visually rides the parent's top
  // surface (e.g. on top of a raised bed) instead of the ground plane.
  // Capture the narrowed scope once so downstream JSX doesn't need to
  // re-discriminate the union for TypeScript.
  const fillScope =
    regionPaint.scope.kind === 'fill-container' ? regionPaint.scope : null
  const outlineY = fillScope ? fillScope.surfaceY + RECT_FILL_LIFT : RECT_Y
  const outlinePoints = rectOutlinePoints(rect, outlineY)

  // Popover anchor — center of the rectangle in world space, lifted slightly
  // so the HTML floats above the relevant surface and the ghost geometry.
  // drei's <Html> tracks this in screen space as the camera moves.
  const anchor: [number, number, number] = [
    (rect.x0 + rect.x1) / 2,
    fillScope ? fillScope.surfaceY + POPOVER_Y : POPOVER_Y,
    (rect.z0 + rect.z1) / 2,
  ]

  const childCount =
    isConfiguring && layout && !layout.degenerate ? layout.centers.length : 0
  const childNoun = fillScope ? 'plant' : 'bed'

  return (
    <>
      <Line points={outlinePoints} color={RECT_COLOR} lineWidth={RECT_LINE_WIDTH} />
      {isConfiguring && layout && !layout.degenerate && fillScope &&
        layout.centers.map((c, i) => (
          <GhostPlant
            key={i}
            position={{ x: c.x, y: fillScope.surfaceY, z: c.z }}
          />
        ))}
      {isConfiguring && layout && !layout.degenerate && !fillScope &&
        layout.centers.map((c, i) => (
          <GhostBed key={i} position={c} size={layout.cellSize} />
        ))}
      {isConfiguring && (
        <Html
          position={anchor}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={POPOVER_STYLE}
            // Don't let pointerdown / click reach the canvas — those would
            // bubble to camera orbit / pointer-missed clearing.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={ROW_STYLE}>
              <span style={LABEL_STYLE}>Rows</span>
              <Stepper
                value={regionPaint.rows}
                min={1}
                onChange={(n) => updateConfig({ rows: n })}
              />
            </div>
            <div style={ROW_STYLE}>
              <span style={LABEL_STYLE}>Cols</span>
              <Stepper
                value={regionPaint.cols}
                min={1}
                onChange={(n) => updateConfig({ cols: n })}
              />
            </div>
            <div style={ROW_STYLE}>
              <span style={LABEL_STYLE}>Spacing</span>
              <LengthInput
                meters={regionPaint.spacingM}
                min={0}
                onCommit={(m) => updateConfig({ spacingM: m })}
              />
            </div>
            {/* Size controls only matter for world-mode bed grids — plants in
                fill mode use a fixed default geometry, so suppressing the row
                avoids confusing UI that would have no effect. */}
            {!fillScope && (
              <>
                <div style={ROW_STYLE}>
                  <span style={LABEL_STYLE}>Size</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <input
                      type="radio"
                      checked={regionPaint.bedSize === 'auto'}
                      onChange={() => updateConfig({ bedSize: 'auto' })}
                    />
                    auto
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <input
                      type="radio"
                      checked={regionPaint.bedSize !== 'auto'}
                      onChange={() => {
                        // Default explicit size matches the standard 4'×2' raised bed:
                        // 1.22m × 0.4m × 0.61m (W × H × L).
                        const seed: RegionBedSize =
                          regionPaint.bedSize === 'auto'
                            ? { x: 1.22, y: 0.4, z: 0.61 }
                            : regionPaint.bedSize
                        updateConfig({ bedSize: seed })
                      }}
                    />
                    fixed
                  </label>
                </div>
                {regionPaint.bedSize !== 'auto' && (
                  <div style={ROW_STYLE}>
                    <span style={LABEL_STYLE}>W H L</span>
                    <LengthInput
                      meters={regionPaint.bedSize.x}
                      min={0.01}
                      onCommit={(m) =>
                        updateConfig({
                          bedSize:
                            regionPaint.bedSize !== 'auto'
                              ? { ...regionPaint.bedSize, x: m }
                              : { x: m, y: 0.4, z: 0.61 },
                        })
                      }
                    />
                    <LengthInput
                      meters={regionPaint.bedSize.y}
                      min={0.01}
                      onCommit={(m) =>
                        updateConfig({
                          bedSize:
                            regionPaint.bedSize !== 'auto'
                              ? { ...regionPaint.bedSize, y: m }
                              : { x: 1.22, y: m, z: 0.61 },
                        })
                      }
                    />
                    <LengthInput
                      meters={regionPaint.bedSize.z}
                      min={0.01}
                      onCommit={(m) =>
                        updateConfig({
                          bedSize:
                            regionPaint.bedSize !== 'auto'
                              ? { ...regionPaint.bedSize, z: m }
                              : { x: 1.22, y: 0.4, z: m },
                        })
                      }
                    />
                  </div>
                )}
              </>
            )}
            {layout?.degenerate && (
              <div style={{ color: '#ffaa44', fontSize: 11 }}>
                Region too small for current grid
              </div>
            )}
            <div style={ROW_STYLE}>
              <button
                style={
                  applying || childCount === 0 ? APPLY_BUTTON_DISABLED : APPLY_BUTTON
                }
                disabled={applying || childCount === 0}
                onClick={apply}
              >
                {applying
                  ? 'Applying…'
                  : `Apply ${childCount} ${childNoun}${childCount === 1 ? '' : 's'}`}
              </button>
              <button style={CANCEL_BUTTON} onClick={cancel} disabled={applying}>
                Cancel
              </button>
            </div>
          </div>
        </Html>
      )}
    </>
  )
}
