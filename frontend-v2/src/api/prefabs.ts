/**
 * Prefab catalog REST surface — fetches the v2 data-driven prefab catalog
 * (`/api/v1/prefabs`) which the backend streams verbatim from
 * `Data/prefabs.json`.
 *
 * The catalog is the single source of truth for default sizes, geometry kind,
 * accepted children, and (eventually) hierarchy / placement / AI rules. The
 * `accepts` and `parentableTo` fields are exposed on the wire today but are
 * not yet enforced in the client — they're consumed by the upcoming hierarchy
 * / parented-placement work.
 *
 * The catalog never changes during a session, so callers can cache it once on
 * app boot (see `loadPrefabCatalog` in `store/garden.ts`).
 */
import type { Vector3 } from './types'

/** Server-defined prefab role buckets. Used for filtering in the picker UI
 * (e.g. only show `container` and `fixture` and `decoration` as user-creatable;
 * `plant` has its own button and isn't surfaced through the prefab picker).
 *
 * Keep the union open-ended via `string` fallback so adding a new server-side
 * category doesn't require a frontend type change before we redeploy. */
export type PrefabCategory = 'container' | 'fixture' | 'plant' | 'decoration' | (string & {})

/** Geometry kinds the renderer knows how to lay out. Mirrors the server's
 * `GeometryKind` enum but only the subset that prefabs declare today. */
export type PrefabGeometryKind = 'Box' | 'Cylinder' | 'Prefab'

export interface PrefabSurface {
  /** Y-offset (meters) of the prefab's "top surface" relative to its base —
   * children that sit ON the prefab use this to compute their Y. */
  y: number
  /** Snap grid (meters) for child placement on this prefab's surface. */
  snapGrid: number
}

export interface PrefabSpec {
  /** Human-readable name for the picker UI. */
  displayName: string
  /** Role bucket — see {@link PrefabCategory}. */
  category: PrefabCategory
  /** Default size in meters. x = width/diameter, y = height, z = depth
   * (z is ignored for cylindrical prefabs by convention, matching v1). */
  defaultSize: Vector3
  /** Categories that can be parented INTO this prefab (children). Consumed
   * by the upcoming hierarchy work; unused today. */
  accepts: string[]
  /** Categories this prefab can be parented to (parents). The literal
   * `"ground"` is the world top-level. Consumed by hierarchy work. */
  parentableTo: string[]
  /** Optional surface descriptor for child placement. Absent for prefabs
   * that don't host children (e.g. fences, doors). */
  surface?: PrefabSurface
  /** Named anchor sets for snapping / placement helpers. Consumed by the
   * upcoming hierarchy / placement work; unused today. */
  anchorPoints?: string[]
  /** True if this prefab can be stacked on top of another instance of itself. */
  stackable: boolean
  /** Geometry primitive the renderer should use. */
  geometryKind: PrefabGeometryKind
}

/**
 * Top-level catalog wire format. Keys are slugs (e.g. "raised-bed-wood").
 * The server may include keys prefixed with `_` (e.g. `_meta`) — consumers
 * should filter those out with {@link isPrefabSlug} before iterating.
 */
export type PrefabCatalog = Record<string, PrefabSpec>

/** True if the given key looks like a prefab slug (not a metadata field). */
export function isPrefabSlug(key: string): boolean {
  return key.length > 0 && !key.startsWith('_')
}

/** Iterate the catalog yielding only real prefab entries (skips `_meta` etc). */
export function listPrefabs(catalog: PrefabCatalog): Array<[string, PrefabSpec]> {
  return Object.entries(catalog).filter(([k]) => isPrefabSlug(k))
}

const RAW_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? '/openharvest/api/v1'
const API_BASE = RAW_BASE.replace(/\/+$/, '')

/**
 * GET /api/v1/prefabs — returns the full catalog. Throws on non-2xx so the
 * caller's `.catch` can surface a toast.
 */
export async function fetchPrefabCatalog(signal?: AbortSignal): Promise<PrefabCatalog> {
  const res = await fetch(`${API_BASE}/prefabs`, { signal })
  if (!res.ok) {
    throw new Error(`fetchPrefabCatalog -> ${res.status}`)
  }
  return (await res.json()) as PrefabCatalog
}
