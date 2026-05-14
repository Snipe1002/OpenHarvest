/**
 * Zustand store for the walk-mode flow. Holds the in-flight session, GPS
 * subscription state, and a local cache of captures so the operator sees their
 * tap-to-capture count tick up immediately even before the review panel loads.
 *
 * GPS lives here (not at component scope) because every capture needs the
 * most-recent fix and an unmount/remount of the WalkMode page during a walk
 * shouldn't restart the geolocation subscription. The store owns the watcher
 * and cleans it up on `endWalk`.
 */
import { create } from 'zustand'
import {
  addCapture,
  endWalk,
  startWalk,
  type CaptureView,
  type ManualReading,
  type WalkSessionView,
  type YardView,
} from '../api/walkMode'

const ACTIVE_SESSION_STORAGE_KEY = 'openharvest:v2:walkSession'

export interface GpsFix {
  lat: number
  lng: number
  accuracyMeters: number
  capturedAt: number
}

export interface WalkModeState {
  currentSession: WalkSessionView | null
  yards: YardView[]
  /** Captures uploaded during this session, newest-last. */
  captures: CaptureView[]
  /** Most-recent GPS fix from the geolocation API. null = no fix yet. */
  gps: GpsFix | null
  /** Whether the geolocation watcher is currently active. */
  gpsActive: boolean
  /** Most recent error string from the geolocation API. */
  gpsError: string | null
  /** UI flag — `addCapture` is in flight. Prevents double-tap submissions. */
  capturing: boolean
  /** Last error string for the operator-facing banner. Cleared on next action. */
  lastError: string | null

  setYards: (yards: YardView[]) => void
  startWalkAction: (yardId: string, note?: string) => Promise<WalkSessionView>
  addCaptureAction: (photo: Blob, readings: ManualReading[], note?: string) => Promise<CaptureView>
  endWalkAction: () => Promise<WalkSessionView | null>
  clearError: () => void

  /** Subscribe to geolocation. Called when WalkMode page mounts. Idempotent. */
  startGps: () => void
  /** Stop the geolocation subscription. Called on session end or unmount. */
  stopGps: () => void

  /** Hydrate from localStorage (called at app boot). */
  hydrate: () => void
}

function readPersisted(): WalkSessionView | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
    return v ? (JSON.parse(v) as WalkSessionView) : null
  } catch {
    return null
  }
}

function writePersisted(session: WalkSessionView | null): void {
  if (typeof window === 'undefined') return
  try {
    if (session && session.status === 'Active') {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
    }
  } catch {
    /* no-op */
  }
}

// Module-scope geolocation watch id so the watcher survives store reads.
let watchId: number | null = null

export const useWalkMode = create<WalkModeState>((set, get) => ({
  currentSession: null,
  yards: [],
  captures: [],
  gps: null,
  gpsActive: false,
  gpsError: null,
  capturing: false,
  lastError: null,

  setYards: (yards) => set({ yards }),

  startWalkAction: async (yardId, note) => {
    try {
      const session = await startWalk(yardId, note)
      writePersisted(session)
      set({ currentSession: session, captures: [], lastError: null })
      get().startGps()
      return session
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ lastError: `start-walk failed: ${msg}` })
      throw err
    }
  },

  addCaptureAction: async (photo, readings, note) => {
    const session = get().currentSession
    if (!session) {
      throw new Error('no active walk session')
    }
    if (get().capturing) {
      throw new Error('capture already in flight')
    }
    set({ capturing: true, lastError: null })
    try {
      const gps = get().gps
      const capture = await addCapture(session.id, {
        photo,
        gpsLat: gps?.lat ?? null,
        gpsLng: gps?.lng ?? null,
        gpsAccuracyM: gps?.accuracyMeters ?? null,
        manualReadings: readings,
        note: note ?? null,
      })
      set((s) => ({ captures: [...s.captures, capture], capturing: false }))
      return capture
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ capturing: false, lastError: `capture failed: ${msg}` })
      throw err
    }
  },

  endWalkAction: async () => {
    const session = get().currentSession
    if (!session) return null
    try {
      const ended = await endWalk(session.id)
      writePersisted(null)
      get().stopGps()
      set({ currentSession: ended })
      return ended
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ lastError: `end-walk failed: ${msg}` })
      throw err
    }
  },

  clearError: () => set({ lastError: null }),

  startGps: () => {
    if (get().gpsActive || typeof navigator === 'undefined' || !navigator.geolocation) {
      return
    }
    set({ gpsActive: true, gpsError: null })
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          set({
            gps: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyMeters: pos.coords.accuracy,
              capturedAt: pos.timestamp,
            },
            gpsError: null,
          })
        },
        (err) => {
          set({ gpsError: err.message })
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ gpsError: msg, gpsActive: false })
    }
  },

  stopGps: () => {
    if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(watchId) } catch { /* */ }
    }
    watchId = null
    set({ gpsActive: false })
  },

  hydrate: () => {
    const session = readPersisted()
    if (session) {
      set({ currentSession: session })
    }
  },
}))
