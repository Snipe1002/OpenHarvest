/**
 * SignalR client for the GardenHub at `/openharvest/hubs/garden`.
 *
 * The v1 hub (`src/OpenHarvest.API/Hubs/GardenHub.cs`) exposes:
 *   - client -> server: `Join(Guid gardenId)` to subscribe to a garden's group
 *                       `Leave(Guid gardenId)` to unsubscribe
 *   - server -> client: `entityUpserted` (full GardenEntity payload)
 *                       `entityDeleted`  (Guid entityId as a string)
 *                       `nudge`          (Nudge payload)
 *
 * On connect we wire those three events directly into the Zustand store so
 * any component reading the store sees live updates without further plumbing.
 *
 * Connection lifecycle is owned by the caller (App.tsx) — this module just
 * builds, starts, joins, and exposes a `disconnect()` for cleanup.
 */
import {
  HubConnection,
  HubConnectionBuilder,
  LogLevel,
} from '@microsoft/signalr'
import { useGarden } from '../store/garden'
import type { GardenEntity, Guid, Nudge } from './types'

const DEFAULT_HUB_URL = '/openharvest/hubs/garden'

function resolveHubUrl(): string {
  const fromEnv = import.meta.env.VITE_HUB_URL as string | undefined
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_HUB_URL).replace(/\/+$/, '')
}

let activeConnection: HubConnection | null = null
let activeGardenId: Guid | null = null

/**
 * Build + start a HubConnection and join the given garden's group.
 * If a connection already exists for a different garden, we leave the old
 * group, join the new one, and keep the same connection.
 */
export async function connect(gardenId: Guid): Promise<HubConnection> {
  if (activeConnection && activeConnection.state === 'Connected') {
    if (activeGardenId === gardenId) return activeConnection
    // Switch groups on the existing connection.
    if (activeGardenId) {
      try {
        await activeConnection.invoke('Leave', activeGardenId)
      } catch (e) {
        console.warn('[signalr] Leave failed', e)
      }
    }
    await activeConnection.invoke('Join', gardenId)
    activeGardenId = gardenId
    return activeConnection
  }

  const conn = new HubConnectionBuilder()
    .withUrl(resolveHubUrl())
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()

  // Wire events directly into the Zustand store — no callback plumbing needed.
  conn.on('entityUpserted', (entity: GardenEntity) => {
    if (!entity || typeof entity.id !== 'string') {
      console.warn('[signalr] entityUpserted: malformed payload', entity)
      return
    }
    useGarden.getState().addOrUpdateEntity(entity)
  })

  conn.on('entityDeleted', (entityId: Guid) => {
    if (typeof entityId !== 'string') {
      console.warn('[signalr] entityDeleted: malformed payload', entityId)
      return
    }
    useGarden.getState().removeEntity(entityId)
  })

  conn.on('nudge', (nudge: Nudge) => {
    if (!nudge || typeof nudge.entityId !== 'string') {
      console.warn('[signalr] nudge: malformed payload', nudge)
      return
    }
    useGarden.getState().addNudge(nudge)
  })

  // Auto-rejoin after a reconnect.
  conn.onreconnected(async () => {
    if (activeGardenId) {
      try {
        await conn.invoke('Join', activeGardenId)
      } catch (e) {
        console.warn('[signalr] rejoin failed', e)
      }
    }
  })

  await conn.start()
  await conn.invoke('Join', gardenId)
  activeConnection = conn
  activeGardenId = gardenId
  return conn
}

/** Stop and clear the shared connection. Safe to call multiple times. */
export async function disconnect(): Promise<void> {
  const conn = activeConnection
  activeConnection = null
  activeGardenId = null
  if (!conn) return
  try {
    await conn.stop()
  } catch (e) {
    console.warn('[signalr] disconnect failed', e)
  }
}
