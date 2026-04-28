/**
 * Zustand store keyed by the active garden. Holds the canonical local copy of
 * entities + nudges so React Three Fiber can render them and SignalR / REST
 * can both upsert into the same dictionary.
 *
 * `currentGardenId` is persisted to localStorage so a page reload restores
 * the active garden. App.tsx is responsible for picking a fallback (first id
 * from `listGardenIds`) when nothing is persisted.
 */
import { create } from 'zustand'
import { getGarden, listEntities } from '../api/client'
import { fetchPrefabCatalog, type PrefabCatalog } from '../api/prefabs'
import type { Garden, GardenEntity, Guid, Nudge } from '../api/types'
import type { Units } from './unitsHelpers'

const STORAGE_KEY = 'openharvest:v2:currentGardenId'
const SNAP_STORAGE_KEY = 'openharvest:v2:snap'
const SNAP_MODE_STORAGE_KEY = 'openharvest:v2:snapMode'
const STICKY_STORAGE_KEY = 'openharvest:v2:stickyPlacement'
const MULTI_STORAGE_KEY = 'openharvest:v2:multiSelectMode'
const UNITS_STORAGE_KEY = 'openharvest:v2:units'

function readPersistedGardenId(): Guid | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

function writePersistedGardenId(id: Guid | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* no-op — non-blocking */
  }
}

/**
 * Snap distance in meters, or `null` for free movement. The chip's cycle
 * order depends on the active units system (see `METRIC_SNAP_VALUES` and
 * `IMPERIAL_SNAP_VALUES`); the underlying type is just `number | null` so we
 * can hold any value either system contributes (e.g. 0.0254 m for 1 inch).
 */
export type SnapValue = number | null

/** Snap cycle for metric mode, in meters. */
export const METRIC_SNAP_VALUES: SnapValue[] = [null, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0]

/** Snap cycle for imperial mode, in meters (labeled in inches/feet). */
export const IMPERIAL_SNAP_VALUES: SnapValue[] = [
  null,
  0.0254, // 1"
  0.1524, // 6"
  0.3048, // 1'
  0.6096, // 2'
  1.2192, // 4'
]

function readPersistedSnap(): SnapValue {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(SNAP_STORAGE_KEY)
    if (v === null) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writePersistedSnap(v: SnapValue): void {
  if (typeof window === 'undefined') return
  try {
    if (v === null) window.localStorage.removeItem(SNAP_STORAGE_KEY)
    else window.localStorage.setItem(SNAP_STORAGE_KEY, String(v))
  } catch {
    /* no-op */
  }
}

/**
 * Snap MODE controls how snap is applied during translate.
 *  - 'edge': edges of dragged entity snap relative to neighbors' edges with
 *            `snap` as the gap. Avoids overlaps when arranging objects of
 *            non-zero size next to each other.
 *  - 'center': dragged entity's center quantizes to a fixed world grid of
 *              `snap` units. Original behavior; useful for laying things out
 *              on absolute coordinates.
 */
export type SnapMode = 'edge' | 'center'

function readPersistedSnapMode(): SnapMode {
  if (typeof window === 'undefined') return 'edge'
  try {
    const v = window.localStorage.getItem(SNAP_MODE_STORAGE_KEY)
    return v === 'center' ? 'center' : 'edge'
  } catch {
    return 'edge'
  }
}

function writePersistedSnapMode(v: SnapMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SNAP_MODE_STORAGE_KEY, v)
  } catch {
    /* no-op */
  }
}

function readPersistedUnits(): Units {
  if (typeof window === 'undefined') return 'metric'
  try {
    const v = window.localStorage.getItem(UNITS_STORAGE_KEY)
    return v === 'imperial' ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

function writePersistedUnits(v: Units): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UNITS_STORAGE_KEY, v)
  } catch {
    /* no-op */
  }
}

/**
 * Find the closest valid snap in the target list to a given snap value.
 * Used when the user flips units — we want to pick a sensible neighbor in
 * the new unit's snap cycle rather than jarringly resetting to off.
 *
 * If `current` is null, we return null (off stays off across unit flips).
 */
function closestSnap(current: SnapValue, list: SnapValue[]): SnapValue {
  if (current === null) return null
  let best: SnapValue = null
  let bestDist = Infinity
  for (const v of list) {
    if (v === null) continue
    const d = Math.abs(v - current)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  return best
}

function readPersistedSticky(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STICKY_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePersistedSticky(v: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (v) window.localStorage.setItem(STICKY_STORAGE_KEY, '1')
    else window.localStorage.removeItem(STICKY_STORAGE_KEY)
  } catch {
    /* no-op */
  }
}

function readPersistedMultiMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MULTI_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePersistedMultiMode(v: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (v) window.localStorage.setItem(MULTI_STORAGE_KEY, '1')
    else window.localStorage.removeItem(MULTI_STORAGE_KEY)
  } catch {
    /* no-op */
  }
}

/**
 * Walk the entities map and return every transitive descendant of `rootId`
 * (children, grandchildren, ...). Excludes the root itself. Visited set
 * guards against pathological cycles (shouldn't happen on a clean server but
 * cheap insurance, especially during streaming SignalR upserts where the
 * graph can be momentarily inconsistent).
 */
function collectDescendants(
  rootId: Guid,
  entities: Record<Guid, GardenEntity>,
): Guid[] {
  // Build a parentId -> children index once. Cheap (O(n)) and avoids an
  // O(n) scan per BFS step.
  const childrenByParent = new Map<Guid, Guid[]>()
  for (const id in entities) {
    const e = entities[id]
    const pid = e.parentId
    if (!pid) continue
    const list = childrenByParent.get(pid)
    if (list) list.push(id)
    else childrenByParent.set(pid, [id])
  }
  const out: Guid[] = []
  const seen = new Set<Guid>([rootId])
  const queue: Guid[] = [rootId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const kids = childrenByParent.get(cur)
    if (!kids) continue
    for (const k of kids) {
      if (seen.has(k)) continue
      seen.add(k)
      out.push(k)
      queue.push(k)
    }
  }
  return out
}

/**
 * Expand a list of primary ids to the effective selection by including
 * descendants when `mode === 'extend'`. De-dups while preserving primary
 * ordering (primaries first, descendants in BFS order after each).
 */
function expandSelection(
  primaries: Guid[],
  entities: Record<Guid, GardenEntity>,
  mode: 'extend' | 'self-only',
): Guid[] {
  if (primaries.length === 0) return []
  if (mode === 'self-only') return [...primaries]
  const seen = new Set<Guid>()
  const out: Guid[] = []
  for (const pid of primaries) {
    if (seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
    for (const d of collectDescendants(pid, entities)) {
      if (seen.has(d)) continue
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

/**
 * Active "place new entity" mode. `null` when not placing. Toolbar buttons
 * set this; the ground click handler reads it to decide what to POST.
 */
export type PlacementType = 'bed' | 'plant' | 'prefab'
export interface PlacementState {
  type: PlacementType
  /** Required when type === 'prefab'. Identifies which prefab catalog entry to spawn. */
  prefabSlug?: string | null
}

/**
 * Active "place house element" mode driven by the MainToolbar. Walls need
 * two ground clicks (corners), so `pendingFirstCorner` holds the first hit
 * while we wait for the second. Doors / windows take a single click on a
 * wall mesh and don't use `pendingFirstCorner`.
 */
export type HousePlacementType = 'wall' | 'door' | 'window'
export interface HousePlacementState {
  type: HousePlacementType
  pendingFirstCorner?: [number, number] | null
}

/**
 * Drag-paint a rectangular region. Two scopes share one state machine:
 *
 *  - `world` (m#10a behavior): drag two corners on the ground to create a grid
 *    of top-level Bed entities at world ground.
 *  - `fill-container`: drag two corners INSIDE a selected container's local
 *    frame to fill it with a grid of Plant entities parented to the container.
 *    Corners are still committed in world XZ (so the cyan rectangle outline
 *    can render without a parent transform); local positions for the children
 *    are computed at Apply time by subtracting `parentWorldX/Z`. Ghosts are
 *    plants instead of beds, rendered at `surfaceY` (world Y).
 *
 * Lifecycle (both scopes):
 *  - awaiting-first-corner: user has armed region-paint via the toolbar but
 *    hasn't yet pressed on the ground. Pointer-down on ground begins the drag.
 *  - awaiting-second-corner: user is mid-drag — first corner is committed and
 *    the second corner tracks pointer-move until pointer-up.
 *  - configuring: drag complete; rectangle is fixed and the inline controls
 *    popover lets the user tweak rows / cols / spacing / size before applying.
 *
 * Coordinates are world-space XZ in meters, snapped per the active snap chip
 * at the moment they're committed (pointer-down for the first corner;
 * pointer-up for the second). Ghost positions are computed from the snapped
 * corners and the chosen grid params; they do NOT re-snap.
 *
 * Why store world coords + parent offsets instead of local coords directly:
 * the cyan outline renders at the App level (sibling of all entities), not
 * inside the parent's `<group>`. World coords let the outline draw with no
 * extra transform, and the world→local conversion happens once at Apply.
 */
export type RegionScope =
  | { kind: 'world' }
  | {
      kind: 'fill-container'
      parentId: Guid
      /** Display name of the parent at arming time, for the status pill copy. */
      parentLabel: string
      /** Y-offset (world meters) of the parent's top surface — children land here. */
      surfaceY: number
      /** Parent's world position at arming time. Snapshotted so we don't
       *  re-read entity state on every pointer move. v0 ignores parent
       *  rotation, so a simple subtraction yields local coords. */
      parentWorldX: number
      parentWorldZ: number
    }
export interface RegionPaintAwaitingFirstCorner {
  phase: 'awaiting-first-corner'
  scope: RegionScope
}
export interface RegionPaintAwaitingSecondCorner {
  phase: 'awaiting-second-corner'
  scope: RegionScope
  /** Snapped first corner in world XZ (meters). */
  firstCorner: [number, number]
  /** Live, snapped second corner; updates on pointer-move. */
  secondCorner: [number, number]
}
export type RegionBedSize = 'auto' | { x: number; y: number; z: number }
export interface RegionPaintConfiguring {
  phase: 'configuring'
  scope: RegionScope
  firstCorner: [number, number]
  secondCorner: [number, number]
  rows: number
  cols: number
  /** Gap between adjacent ghost cells, meters. */
  spacingM: number
  /** Either 'auto' (cell-fits) or an explicit Box size in meters. Only
   *  consumed by world scope; fill-container always uses a fixed plant size. */
  bedSize: RegionBedSize
}
export type RegionPaintState =
  | RegionPaintAwaitingFirstCorner
  | RegionPaintAwaitingSecondCorner
  | RegionPaintConfiguring

export interface GardenState {
  currentGardenId: Guid | null
  garden: Garden | null
  /** entityId -> entity. Drives R3F rendering. */
  entities: Record<Guid, GardenEntity>
  nudges: Nudge[]
  loading: boolean
  error: string | null

  /**
   * Currently selected entity ids — the EFFECTIVE selection. In default
   * "extend" selection mode this includes both the explicit picks
   * (`primarySelectedIds`) AND every transitive descendant of those picks
   * (m#7 hierarchy). In "self-only" mode (long-press) this equals
   * `primarySelectedIds`. Drives outline overlays + inspector visibility.
   * Empty array = nothing selected.
   */
  selectedEntityIds: Guid[]
  /**
   * Entities the user explicitly tapped / shift-clicked, in selection order.
   * Macro ops (Distribute, Align, Rotate, Normalize) read this so they don't
   * "double move" descendants — Three's scene graph already cascades parent
   * transforms onto children. m#10b fill-mode keys on
   * `primarySelectedIds.length === 1` so long-pressing a parent (which
   * collapses to self-only) still arms fill-container correctly.
   */
  primarySelectedIds: Guid[]
  /**
   * Whether the most recent selection action expanded primaries to include
   * their descendants ('extend', the default for taps and shift-taps) or kept
   * the selection narrow to the explicit picks ('self-only', triggered by
   * long-press). One global flag is sufficient because the next selection
   * action resets it. Stored on the store so consumers (outlines, ops) can
   * read it without prop-drilling. */
  selectionExtensionMode: 'extend' | 'self-only'
  /** Current placement mode (toolbar +Bed / +Plant / +Prefab) or null. */
  placement: PlacementState | null
  /** Transient error string surfaced as a toast in the edit panel. */
  toast: string | null

  /**
   * Entity currently being translated via the inspector's drag-to-move mode
   * (single-entity translate). While set, the matching entity component
   * installs drag handlers, the camera stops orbiting, and a status pill is
   * shown. Mutually exclusive with `groupTranslateActive`.
   */
  translateModeId: Guid | null

  /**
   * When true, a pointer-down on any selected entity drags the entire
   * selected group together (delta from the leader's snapped ground hit
   * applies uniformly to all). Set by MultiSelectInspector's ⇄ button.
   */
  groupTranslateActive: boolean

  /**
   * When true, the user is currently press-hold-dragging one of the inspector
   * ⇄ buttons (single OR group). The button itself acts as the drag handle so
   * the user's finger doesn't occlude the entity being moved. While active,
   * camera orbit is suspended (see App.tsx CameraControls.enabled). Cleared
   * on pointer-up regardless of whether the drag committed or reverted.
   */
  buttonDragActive: boolean

  /**
   * Snap distance in meters for translate / wall-corner placement, or null
   * for free movement. Persisted to localStorage.
   */
  snap: SnapValue

  /**
   * Snap mode — 'edge' (default, magnet to neighbor edges with `snap` gap)
   * or 'center' (quantize entity center to a fixed world grid). Persisted.
   */
  snapMode: SnapMode

  /** Active house-element placement mode, or null. */
  housePlacement: HousePlacementState | null

  /**
   * Drag-paint-region-of-beds state, or null when not active. Mutually
   * exclusive with `placement` and `housePlacement` — entering this mode
   * cancels the others (and vice versa) so we never have two pipelines
   * fighting for ground clicks.
   */
  regionPaint: RegionPaintState | null

  /** Currently selected Pascal wall id, or null. Drives the wall inspector. */
  selectedWallId: string | null

  /**
   * When true, finishing a placement (entity, wall, door, window) does NOT
   * exit placement mode — the toolbar stays armed for another placement.
   * Persisted to localStorage. Esc still cancels.
   */
  stickyPlacement: boolean

  /**
   * When true, every entity tap acts as additive multi-select (no shift
   * needed). Designed for touch devices that can't synthesize shift+click.
   * Persisted to localStorage. Empty-ground click does NOT clear selection
   * while this is on.
   */
  multiSelectMode: boolean

  /**
   * Active display unit system for length-bearing UI (snap chip, inspector
   * number fields, etc). Internal coordinates remain in meters; only the
   * display + parse layer reads this. Persisted to localStorage.
   */
  units: Units

  /**
   * Data-driven prefab catalog fetched once on app boot from
   * `GET /api/v1/prefabs`. Drives the prefab picker, default geometry, and
   * (in upcoming work) hierarchy / placement / AI rules. `null` while loading
   * or if the fetch failed — callers must tolerate the null state and fall
   * back to a sensible default.
   */
  prefabCatalog: PrefabCatalog | null

  /** Switch active garden, persist id, fetch garden + entities, replace state. */
  setCurrentGarden: (id: Guid) => Promise<void>
  /** REST or SignalR upsert path. Idempotent; replaces the whole entity by id. */
  addOrUpdateEntity: (e: GardenEntity) => void
  /** Remove an entity by id. No-op if missing. */
  removeEntity: (id: Guid) => void
  /** Append a new nudge. */
  addNudge: (n: Nudge) => void
  /** Drop a nudge by entityId. (Nudges don't have their own id on the wire.) */
  clearNudge: (entityId: Guid) => void

  /**
   * Select / clear / toggle an entity.
   *   - additive=false (default): replaces the selection with [id], or [] if
   *     id is null. Equivalent to a fresh single-click.
   *   - additive=true: toggles `id` in the selection (adding if absent,
   *     removing if present). Empty-input id is a no-op.
   *   - extension='extend' (default): the picked id is treated as a parent;
   *     its transitive descendants are auto-included in the effective
   *     selection (`selectedEntityIds`) so visuals + macro ops cascade. The
   *     `primarySelectedIds` list still records only the explicit pick.
   *   - extension='self-only': long-press behavior — descendants are NOT
   *     pulled in. Macro ops therefore stay scoped to the parent itself,
   *     useful for moving a bed without reflowing its plants visually-only.
   *
   * In additive mode, `extension` applies to the WHOLE selection (every
   * primary expands or stays narrow uniformly). This keeps the model simple
   * — the user can re-tap to flip the mode for the entire group.
   */
  selectEntity: (
    id: Guid | null,
    additive?: boolean,
    extension?: 'extend' | 'self-only',
  ) => void
  /** Replace the selection with an explicit array. Treats every id as a
   *  primary pick and applies the global `selectionExtensionMode` (defaults
   *  to 'extend' on a fresh array). Used by Duplicate-all to jump selection
   *  to the new copies. */
  selectEntities: (ids: Guid[]) => void
  /** Drop all selection (entity selection only — wall selection is separate). */
  clearSelection: () => void
  /**
   * Convenience: returns the unique selected entity if exactly one is
   * selected, else null. Used by the single-entity InspectorCard.
   */
  getSelected: () => GardenEntity | null
  /** Enter / exit placement mode. Pass null to exit. */
  setPlacement: (p: PlacementState | null) => void
  /** Set the transient toast message. */
  setToast: (msg: string | null) => void

  /** Enter / exit single-entity translate mode (or null to cancel). */
  setTranslateMode: (id: Guid | null) => void
  /** Enter / exit group translate mode (drags every selected entity by a uniform delta). */
  setGroupTranslateActive: (v: boolean) => void
  /** Set the button-drag-active flag (used to suspend camera orbit during ⇄-button drag). */
  setButtonDragActive: (v: boolean) => void
  /** Set the snap value, persist to localStorage. */
  setSnap: (v: SnapValue) => void
  /** Toggle / set snap mode (edge ↔ center), persist to localStorage. */
  setSnapMode: (v: SnapMode) => void
  /** Enter / update / exit house-element placement. */
  setHousePlacement: (p: HousePlacementState | null) => void
  /**
   * Enter / update / exit drag-paint-region mode. Passing null cancels.
   * Entering any non-null state cancels the other placement pipelines so the
   * three modes can't be armed simultaneously.
   */
  setRegionPaint: (s: RegionPaintState | null) => void
  /** Select / clear a Pascal wall (separate from garden entity selection). */
  selectWall: (id: string | null) => void
  /** Toggle / set sticky placement, persist to localStorage. */
  setStickyPlacement: (v: boolean) => void
  /** Toggle / set multi-select mode, persist to localStorage. */
  setMultiSelectMode: (v: boolean) => void
  /**
   * Set the display unit system. Snap value is migrated to the closest
   * neighbor in the new unit's snap cycle (or stays null if it was already
   * off). Persisted to localStorage.
   */
  setUnits: (v: Units) => void

  /**
   * Fetch the prefab catalog from the server and stash it in state. Called
   * once on app boot (see App.tsx). Idempotent: if the catalog is already
   * loaded, this is a no-op. Errors are logged but not surfaced — callers
   * fall back to defaults when `prefabCatalog` is null.
   */
  loadPrefabCatalog: () => Promise<void>
}

export const useGarden = create<GardenState>((set, get) => ({
  currentGardenId: readPersistedGardenId(),
  garden: null,
  entities: {},
  nudges: [],
  loading: false,
  error: null,
  selectedEntityIds: [],
  primarySelectedIds: [],
  selectionExtensionMode: 'extend',
  placement: null,
  toast: null,
  translateModeId: null,
  groupTranslateActive: false,
  buttonDragActive: false,
  snap: readPersistedSnap(),
  snapMode: readPersistedSnapMode(),
  housePlacement: null,
  regionPaint: null,
  selectedWallId: null,
  stickyPlacement: readPersistedSticky(),
  multiSelectMode: readPersistedMultiMode(),
  units: readPersistedUnits(),
  prefabCatalog: null,

  setCurrentGarden: async (id) => {
    if (!id) return
    set({
      currentGardenId: id,
      loading: true,
      error: null,
      // Wipe entities/garden on switch — we'll repopulate from the server.
      garden: null,
      entities: {},
      nudges: [],
      selectedEntityIds: [],
      primarySelectedIds: [],
      selectionExtensionMode: 'extend',
      placement: null,
      translateModeId: null,
      groupTranslateActive: false,
      housePlacement: null,
      regionPaint: null,
      selectedWallId: null,
    })
    writePersistedGardenId(id)

    try {
      const [garden, entityList] = await Promise.all([getGarden(id), listEntities(id)])
      // Bail if the user already switched away while we were waiting.
      if (get().currentGardenId !== id) return
      const entities: Record<Guid, GardenEntity> = {}
      for (const e of entityList) entities[e.id] = e
      set({ garden, entities, loading: false })
    } catch (err) {
      if (get().currentGardenId !== id) return
      const message = err instanceof Error ? err.message : String(err)
      set({ loading: false, error: message })
      console.error('[garden-store] failed to load garden', id, err)
    }
  },

  addOrUpdateEntity: (entity) => {
    set((s) => ({ entities: { ...s.entities, [entity.id]: entity } }))
  },

  removeEntity: (id) => {
    set((s) => {
      if (!(id in s.entities)) return s
      const next = { ...s.entities }
      delete next[id]
      // Drop the id from BOTH the primary list and the effective selection
      // list. We then re-expand primaries against the post-removal entities
      // map so a deleted parent's now-orphaned children stop appearing in the
      // effective selection. (`selectionExtensionMode` is preserved.)
      const primarySelectedIds = s.primarySelectedIds.includes(id)
        ? s.primarySelectedIds.filter((x) => x !== id)
        : s.primarySelectedIds
      const selectedEntityIds = expandSelection(
        primarySelectedIds,
        next,
        s.selectionExtensionMode,
      ).filter((x) => x !== id)
      // Cancel single-entity translate if the removed entity was its target.
      const translateModeId = s.translateModeId === id ? null : s.translateModeId
      // If the active group-translate target evaporated below 2 entities,
      // also exit group-translate.
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return {
        entities: next,
        primarySelectedIds,
        selectedEntityIds,
        translateModeId,
        groupTranslateActive,
      }
    })
  },

  addNudge: (n) => {
    set((s) => ({ nudges: [...s.nudges, n] }))
  },

  clearNudge: (entityId) => {
    set((s) => ({ nudges: s.nudges.filter((n) => n.entityId !== entityId) }))
  },

  selectEntity: (id, additive = false, extension = 'extend') => {
    // Selecting a garden entity clears any wall selection so we never show
    // two inspectors at once.
    set((s) => {
      let primarySelectedIds: Guid[]
      if (additive) {
        if (!id) return s // no-op: additive null is meaningless
        const i = s.primarySelectedIds.indexOf(id)
        if (i >= 0) {
          // Toggle off — remove from primaries; effective selection rebuilds.
          primarySelectedIds = s.primarySelectedIds.filter((x) => x !== id)
        } else {
          // Toggle on
          primarySelectedIds = [...s.primarySelectedIds, id]
        }
      } else {
        // Replace
        primarySelectedIds = id ? [id] : []
      }
      // Apply the new extension mode globally — every primary is expanded (or
      // not) under the same rule. The next select action will reset this
      // flag, so a user dragging a normal tap stays in extend even if the
      // previous selection was self-only.
      const selectedEntityIds = expandSelection(
        primarySelectedIds,
        s.entities,
        extension,
      )
      // Translate-mode cleanup: single-entity translate requires that exact
      // id to remain selected. Group translate requires >=2 selected.
      const translateModeId =
        s.translateModeId && !selectedEntityIds.includes(s.translateModeId)
          ? null
          : s.translateModeId
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return {
        primarySelectedIds,
        selectedEntityIds,
        selectionExtensionMode: extension,
        selectedWallId: id ? null : s.selectedWallId,
        translateModeId,
        groupTranslateActive,
      }
    })
  },

  selectEntities: (ids) => {
    set((s) => {
      // De-dup while preserving first-occurrence order. Each id becomes a
      // primary pick; reset extension mode to the default ('extend') so
      // descendants are pulled in for visuals (Three handles the cascade
      // automatically; macro ops still read primarySelectedIds and so won't
      // double-move children).
      const seen = new Set<Guid>()
      const primarySelectedIds: Guid[] = []
      for (const id of ids) {
        if (id && !seen.has(id)) {
          seen.add(id)
          primarySelectedIds.push(id)
        }
      }
      const selectedEntityIds = expandSelection(primarySelectedIds, s.entities, 'extend')
      const translateModeId =
        s.translateModeId && !selectedEntityIds.includes(s.translateModeId)
          ? null
          : s.translateModeId
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return {
        primarySelectedIds,
        selectedEntityIds,
        selectionExtensionMode: 'extend',
        selectedWallId: selectedEntityIds.length > 0 ? null : s.selectedWallId,
        translateModeId,
        groupTranslateActive,
      }
    })
  },

  clearSelection: () => {
    set((s) => ({
      selectedEntityIds: [],
      primarySelectedIds: [],
      selectionExtensionMode: 'extend',
      translateModeId: null,
      groupTranslateActive: false,
      // Wall selection is separate; leave it.
      selectedWallId: s.selectedWallId,
    }))
  },

  getSelected: () => {
    // "Exactly one selected" means exactly one explicit primary pick. With
    // extend-mode selections an effective selection of [bed, plant1, plant2]
    // still counts as a single primary pick of the bed — we want
    // InspectorCard to show the bed's pill, not the multi-inspector.
    const { primarySelectedIds, entities } = get()
    if (primarySelectedIds.length !== 1) return null
    return entities[primarySelectedIds[0]] ?? null
  },

  setPlacement: (p) => {
    set({ placement: p })
  },

  setToast: (msg) => {
    set({ toast: msg })
  },

  setTranslateMode: (id) => {
    // Single-entity translate requires that entity to be the sole selection
    // (or at minimum, present). If id is set, also ensure group translate is
    // off — they're mutually exclusive.
    set((s) => ({
      translateModeId: id,
      groupTranslateActive: id ? false : s.groupTranslateActive,
    }))
  },

  setGroupTranslateActive: (v) => {
    set((s) => ({
      groupTranslateActive: v && s.selectedEntityIds.length >= 2,
      translateModeId: v ? null : s.translateModeId,
    }))
  },

  setButtonDragActive: (v) => {
    set({ buttonDragActive: v })
  },

  setSnap: (v) => {
    writePersistedSnap(v)
    set({ snap: v })
  },

  setSnapMode: (v) => {
    writePersistedSnapMode(v)
    set({ snapMode: v })
  },

  setHousePlacement: (p) => {
    set({ housePlacement: p })
  },

  setRegionPaint: (s) => {
    // Region-paint is mutually exclusive with the other placement pipelines.
    // Arming it cancels both; clearing it (null) leaves them alone.
    if (s) {
      set({ regionPaint: s, placement: null, housePlacement: null })
    } else {
      set({ regionPaint: null })
    }
  },

  selectWall: (id) => {
    // Selecting a wall clears garden entity selection (and vice-versa) so we
    // never show two inspectors at once. We clear BOTH the primary list and
    // the effective selection so re-tapping an entity later starts fresh.
    set((s) => ({
      selectedWallId: id,
      selectedEntityIds: id ? [] : s.selectedEntityIds,
      primarySelectedIds: id ? [] : s.primarySelectedIds,
      selectionExtensionMode: id ? 'extend' : s.selectionExtensionMode,
      translateModeId: id ? null : s.translateModeId,
      groupTranslateActive: id ? false : s.groupTranslateActive,
    }))
  },

  setStickyPlacement: (v) => {
    writePersistedSticky(v)
    set({ stickyPlacement: v })
  },

  setMultiSelectMode: (v) => {
    writePersistedMultiMode(v)
    set({ multiSelectMode: v })
  },

  setUnits: (v) => {
    writePersistedUnits(v)
    set((s) => {
      // Migrate the snap value to the closest neighbor in the new unit
      // system's snap cycle. `null` (off) stays off.
      const targetList = v === 'metric' ? METRIC_SNAP_VALUES : IMPERIAL_SNAP_VALUES
      const nextSnap = closestSnap(s.snap, targetList)
      if (nextSnap !== s.snap) writePersistedSnap(nextSnap)
      return { units: v, snap: nextSnap }
    })
  },

  loadPrefabCatalog: async () => {
    // Idempotent: skip if already loaded. Catalog is immutable for the session.
    if (get().prefabCatalog) return
    try {
      const catalog = await fetchPrefabCatalog()
      // Bail out if a concurrent load already populated the slot.
      if (get().prefabCatalog) return
      set({ prefabCatalog: catalog })
    } catch (err) {
      // Don't surface a toast — the picker shows "Loading..." until catalog
      // arrives, and DemoGround.tsx falls back to a hardcoded default size
      // when null. Log so debugging is possible.
      console.error('[garden-store] failed to load prefab catalog', err)
    }
  },
}))
