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

export interface GardenState {
  currentGardenId: Guid | null
  garden: Garden | null
  /** entityId -> entity. Drives R3F rendering. */
  entities: Record<Guid, GardenEntity>
  nudges: Nudge[]
  loading: boolean
  error: string | null

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
}

export const useGarden = create<GardenState>((set, get) => ({
  currentGardenId: readPersistedGardenId(),
  garden: null,
  entities: {},
  nudges: [],
  loading: false,
  error: null,

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
      return { entities: next }
    })
  },

  addNudge: (n) => {
    set((s) => ({ nudges: [...s.nudges, n] }))
  },

  clearNudge: (entityId) => {
    set((s) => ({ nudges: s.nudges.filter((n) => n.entityId !== entityId) }))
  },
}))
