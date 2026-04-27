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
import type { Garden, GardenEntity, Guid, Nudge } from '../api/types'

const STORAGE_KEY = 'openharvest:v2:currentGardenId'
const SNAP_STORAGE_KEY = 'openharvest:v2:snap'
const STICKY_STORAGE_KEY = 'openharvest:v2:stickyPlacement'
const MULTI_STORAGE_KEY = 'openharvest:v2:multiSelectMode'

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

/** Allowed snap values in meters. `null` means snap is off. */
export type SnapValue = null | 0.1 | 0.5 | 1.0

function readPersistedSnap(): SnapValue {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(SNAP_STORAGE_KEY)
    if (v === '0.1') return 0.1
    if (v === '0.5') return 0.5
    if (v === '1' || v === '1.0') return 1.0
    return null
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
 * Active "place house element" mode driven by the HouseToolbar. Walls need
 * two ground clicks (corners), so `pendingFirstCorner` holds the first hit
 * while we wait for the second. Doors / windows take a single click on a
 * wall mesh and don't use `pendingFirstCorner`.
 */
export type HousePlacementType = 'wall' | 'door' | 'window'
export interface HousePlacementState {
  type: HousePlacementType
  pendingFirstCorner?: [number, number] | null
}

export interface GardenState {
  currentGardenId: Guid | null
  garden: Garden | null
  /** entityId -> entity. Drives R3F rendering. */
  entities: Record<Guid, GardenEntity>
  nudges: Nudge[]
  loading: boolean
  error: string | null

  /**
   * Currently selected entity ids, in selection order. Drives the inspector
   * (single-selection InspectorCard for length===1, MultiSelectInspector for
   * length>=2) and outline overlays. Empty array = nothing selected.
   */
  selectedEntityIds: Guid[]
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
   * Snap distance in meters for translate / wall-corner placement, or null
   * for free movement. Persisted to localStorage.
   */
  snap: SnapValue

  /** Active house-element placement mode, or null. */
  housePlacement: HousePlacementState | null

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
   */
  selectEntity: (id: Guid | null, additive?: boolean) => void
  /** Replace the selection with an explicit array. */
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
  /** Set the snap value, persist to localStorage. */
  setSnap: (v: SnapValue) => void
  /** Enter / update / exit house-element placement. */
  setHousePlacement: (p: HousePlacementState | null) => void
  /** Select / clear a Pascal wall (separate from garden entity selection). */
  selectWall: (id: string | null) => void
  /** Toggle / set sticky placement, persist to localStorage. */
  setStickyPlacement: (v: boolean) => void
  /** Toggle / set multi-select mode, persist to localStorage. */
  setMultiSelectMode: (v: boolean) => void
}

export const useGarden = create<GardenState>((set, get) => ({
  currentGardenId: readPersistedGardenId(),
  garden: null,
  entities: {},
  nudges: [],
  loading: false,
  error: null,
  selectedEntityIds: [],
  placement: null,
  toast: null,
  translateModeId: null,
  groupTranslateActive: false,
  snap: readPersistedSnap(),
  housePlacement: null,
  selectedWallId: null,
  stickyPlacement: readPersistedSticky(),
  multiSelectMode: readPersistedMultiMode(),

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
      placement: null,
      translateModeId: null,
      groupTranslateActive: false,
      housePlacement: null,
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
      // Drop the id from the selection list if present.
      const selectedEntityIds = s.selectedEntityIds.includes(id)
        ? s.selectedEntityIds.filter((x) => x !== id)
        : s.selectedEntityIds
      // Cancel single-entity translate if the removed entity was its target.
      const translateModeId = s.translateModeId === id ? null : s.translateModeId
      // If the active group-translate target evaporated below 2 entities,
      // also exit group-translate.
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return { entities: next, selectedEntityIds, translateModeId, groupTranslateActive }
    })
  },

  addNudge: (n) => {
    set((s) => ({ nudges: [...s.nudges, n] }))
  },

  clearNudge: (entityId) => {
    set((s) => ({ nudges: s.nudges.filter((n) => n.entityId !== entityId) }))
  },

  selectEntity: (id, additive = false) => {
    // Selecting a garden entity clears any wall selection so we never show
    // two inspectors at once.
    set((s) => {
      let selectedEntityIds: Guid[]
      if (additive) {
        if (!id) return s // no-op: additive null is meaningless
        const i = s.selectedEntityIds.indexOf(id)
        if (i >= 0) {
          // Toggle off
          selectedEntityIds = s.selectedEntityIds.filter((x) => x !== id)
        } else {
          // Toggle on
          selectedEntityIds = [...s.selectedEntityIds, id]
        }
      } else {
        // Replace
        selectedEntityIds = id ? [id] : []
      }
      // Translate-mode cleanup: single-entity translate requires that exact
      // id to remain selected. Group translate requires >=2 selected.
      const translateModeId =
        s.translateModeId && !selectedEntityIds.includes(s.translateModeId)
          ? null
          : s.translateModeId
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return {
        selectedEntityIds,
        selectedWallId: id ? null : s.selectedWallId,
        translateModeId,
        groupTranslateActive,
      }
    })
  },

  selectEntities: (ids) => {
    set((s) => {
      // De-dup while preserving first-occurrence order.
      const seen = new Set<Guid>()
      const selectedEntityIds: Guid[] = []
      for (const id of ids) {
        if (id && !seen.has(id)) {
          seen.add(id)
          selectedEntityIds.push(id)
        }
      }
      const translateModeId =
        s.translateModeId && !selectedEntityIds.includes(s.translateModeId)
          ? null
          : s.translateModeId
      const groupTranslateActive =
        s.groupTranslateActive && selectedEntityIds.length >= 2 ? s.groupTranslateActive : false
      return {
        selectedEntityIds,
        selectedWallId: selectedEntityIds.length > 0 ? null : s.selectedWallId,
        translateModeId,
        groupTranslateActive,
      }
    })
  },

  clearSelection: () => {
    set((s) => ({
      selectedEntityIds: [],
      translateModeId: null,
      groupTranslateActive: false,
      // Wall selection is separate; leave it.
      selectedWallId: s.selectedWallId,
    }))
  },

  getSelected: () => {
    const { selectedEntityIds, entities } = get()
    if (selectedEntityIds.length !== 1) return null
    return entities[selectedEntityIds[0]] ?? null
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

  setSnap: (v) => {
    writePersistedSnap(v)
    set({ snap: v })
  },

  setHousePlacement: (p) => {
    set({ housePlacement: p })
  },

  selectWall: (id) => {
    // Selecting a wall clears garden entity selection (and vice-versa) so we
    // never show two inspectors at once.
    set((s) => ({
      selectedWallId: id,
      selectedEntityIds: id ? [] : s.selectedEntityIds,
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
}))
