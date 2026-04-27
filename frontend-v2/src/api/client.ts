/**
 * Typed REST client for the OpenHarvest v1 backend.
 *
 * Base URL resolves from `VITE_API_BASE` so dev can override; defaults to
 * `/openharvest/api/v1` to match the deployed Caddy route. The API itself is
 * unauthenticated (Tailscale-fronted), so no auth headers.
 *
 * Advisor / AI endpoints (`/advisor/*`) are deliberately NOT exposed — that
 * surface is deferred to a separate phase per the v2 milestone scope.
 */
import type {
  CreateEntityRequest,
  CreateGardenRequest,
  Garden,
  GardenEntity,
  Guid,
  PhotoView,
  UpdateEntityRequest,
  UpdateGardenRequest,
} from './types'

const RAW_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? '/openharvest/api/v1'
// Strip trailing slash so callers can compose with a leading slash safely.
const API_BASE = RAW_BASE.replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    signal: opts.signal,
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }

  const res = await fetch(url, init)
  if (!res.ok) {
    let body: unknown = null
    try {
      const text = await res.text()
      body = text ? safeParseJson(text) ?? text : null
    } catch {
      /* swallow — keep body null */
    }
    throw new ApiError(res.status, body, `${init.method} ${path} -> ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  // Some endpoints (DELETE photo) return JSON; others return 204.  Detect by content-length / type.
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Gardens
// ---------------------------------------------------------------------------

export const listGardenIds = (signal?: AbortSignal): Promise<Guid[]> =>
  request<Guid[]>('/gardens/ids', { signal })

export const getGarden = (id: Guid, signal?: AbortSignal): Promise<Garden> =>
  request<Garden>(`/gardens/${id}`, { signal })

export const createGarden = (
  body: CreateGardenRequest,
  signal?: AbortSignal,
): Promise<Garden> => request<Garden>('/gardens', { method: 'POST', body, signal })

export const updateGarden = (
  id: Guid,
  body: UpdateGardenRequest,
  signal?: AbortSignal,
): Promise<Garden> =>
  request<Garden>(`/gardens/${id}`, { method: 'PATCH', body, signal })

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const listEntities = (
  gardenId: Guid,
  signal?: AbortSignal,
): Promise<GardenEntity[]> =>
  request<GardenEntity[]>(`/gardens/${gardenId}/entities`, { signal })

export const getEntity = (
  gardenId: Guid,
  entityId: Guid,
  signal?: AbortSignal,
): Promise<GardenEntity> =>
  request<GardenEntity>(`/gardens/${gardenId}/entities/${entityId}`, { signal })

export const createEntity = (
  gardenId: Guid,
  body: CreateEntityRequest,
  signal?: AbortSignal,
): Promise<GardenEntity> =>
  request<GardenEntity>(`/gardens/${gardenId}/entities`, { method: 'POST', body, signal })

export const updateEntity = (
  gardenId: Guid,
  entityId: Guid,
  body: UpdateEntityRequest,
  signal?: AbortSignal,
): Promise<GardenEntity> =>
  request<GardenEntity>(`/gardens/${gardenId}/entities/${entityId}`, {
    method: 'PATCH',
    body,
    signal,
  })

export const deleteEntity = (
  gardenId: Guid,
  entityId: Guid,
  signal?: AbortSignal,
): Promise<void> =>
  request<void>(`/gardens/${gardenId}/entities/${entityId}`, {
    method: 'DELETE',
    signal,
  })

// ---------------------------------------------------------------------------
// Photos (REST list / delete; upload is multipart so handled separately)
// ---------------------------------------------------------------------------

export const listPhotos = (
  gardenId: Guid,
  entityId: Guid,
  signal?: AbortSignal,
): Promise<PhotoView[]> =>
  request<PhotoView[]>(`/gardens/${gardenId}/entities/${entityId}/photos`, { signal })

export const deletePhoto = (
  gardenId: Guid,
  entityId: Guid,
  photoId: Guid,
  signal?: AbortSignal,
): Promise<void> =>
  request<void>(`/gardens/${gardenId}/entities/${entityId}/photos/${photoId}`, {
    method: 'DELETE',
    signal,
  })

/**
 * Multipart upload — returns the created PhotoView. Uses fetch directly
 * because `request` JSON-encodes its body.
 */
export async function uploadPhoto(
  gardenId: Guid,
  entityId: Guid,
  file: File,
  signal?: AbortSignal,
): Promise<PhotoView> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(
    `${API_BASE}/gardens/${gardenId}/entities/${entityId}/photos`,
    { method: 'POST', body: form, signal },
  )
  if (!res.ok) {
    let body: unknown = null
    try { body = await res.text() } catch { /* */ }
    throw new ApiError(res.status, body, `upload photo -> ${res.status}`)
  }
  return (await res.json()) as PhotoView
}

/** Exposed for the SignalR client to derive its hub URL from the same env. */
export const apiBase = API_BASE
