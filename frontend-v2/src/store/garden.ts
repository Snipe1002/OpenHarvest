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

  /** Currently selected entity id, or null. Drives the edit panel + outline. */
  selectedEntityId: Guid | null
  /** Current placement mode (toolbar +Bed / +Plant / +Prefab) or null. */
  placement: PlacementState | null
  /** Transient error string surfaced as a toast in the edit panel. */
  toast: string | null

  /**
   * Entity currently being translated via the inspector's drag-to-move mode.
   * While set, the matching entity component installs drag handlers, the
   * camera stops orbiting, and a status pill is shown.
   */
  translateModeId: Guid | null

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

  /** Set or clear the selected entity. */
  selectEntity: (id: Guid | null) => void
  /** Look up the selected entity (or null if none / not present). */
  getSelected: () => GardenEntity | null
  /** Enter / exit placement mode. Pass null to exit. */
  setPlacement: (p: PlacementState | null) => void
  /** Set the transient toast message. */
  setToast: (msg: string | null) => void

  /** Enter / exit translate mode for an entity (or null to cancel). */
  setTranslateMode: (id: Guid | null) => void
  /** Set the snap value, persist to localStorage. */
  setSnap: (v: SnapValue) => void
  /** Enter / update / exit house-element placement. */
  setHousePlacement: (p: HousePlacementState | null) => void
  /** Select / clear a Pascal wall (separate from garden entity selection). */
  selectWall: (id: string | null) => void
  /** Toggle / set sticky placement, persist to localStorage. */
  setStickyPlacement: (v: boolean) => void
}

export const useGarden = create<GardenState>((set, get) => ({
  currentGardenId: readPersistedGardenId(),
  garden: null,
  entities: {},
  nudges: [],
  loading: false,
  error: null,
  selectedEntityId: null,
  placement: null,
  toast: null,
  translateModeId: null,
  snap: readPersistedSnap(),
  housePlacement: null,
  selectedWallId: null,
  stickyPlacement: readPersistedSticky(),

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
      selectedEntityId: null,
      placement: null,
      translateModeId: null,
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
      // If the removed entity was selected, drop the selection too.
      const selectedEntityId = s.selectedEntityId === id ? null : s.selectedEntityId
      return { entities: next, selectedEntityId }
    })
  },

  addNudge: (n) => {
    set((s) => ({ nudges: [...s.nudges, n] }))
  },

  clearNudge: (entityId) => {
    set((s) => ({ nudges: s.nudges.filter((n) => n.entityId !== entityId) }))
  },

  selectEntity: (id) => {
    // Selecting a garden entity clears any wall selection so we never show
    // two inspectors at once. Switching away from (or de-selecting) the
    // entity also exits translate mode — translate without a target makes
    // no sense.
    set((s) => ({
      selectedEntityId: id,
      selectedWallId: id ? null : s.selectedWallId,
      translateModeId:
        s.translateModeId && s.translateModeId !== id ? null : s.translateModeId,
    }))
  },

  getSelected: () => {
    const { selectedEntityId, entities } = get()
    if (!selectedEntityId) return null
    return entities[selectedEntityId] ?? null
  },

  setPlacement: (p) => {
    set({ placement: p })
  },

  setToast: (msg) => {
    set({ toast: msg })
  },

  setTranslateMode: (id) => {
    set({ translateModeId: id })
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
      selectedEntityId: id ? null : s.selectedEntityId,
    }))
  },

  setStickyPlacement: (v) => {
    writePersistedSticky(v)
    set({ stickyPlacement: v })
  },
}))
