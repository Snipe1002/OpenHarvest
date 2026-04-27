/**
 * Wire-format types mirroring the v1 backend DTOs in
 * `src/OpenHarvest.Domain/...` and `src/OpenHarvest.API/Controllers/...`.
 *
 * The .NET API serializes with `PropertyNamingPolicy.CamelCase` (see
 * `Program.cs` line 13) and uses `JsonStringEnumConverter`, so enums arrive as
 * their PascalCase string names (e.g. "Plant", "Box").
 */

export type Guid = string

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Quaternion {
  x: number
  y: number
  z: number
  w: number
}

export interface Transform {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
}

export type GeometryKind = 'Box' | 'Cylinder' | 'Polygon' | 'MeshRef' | 'Prefab'

/**
 * Geometry is a discriminated union by `kind`, but the wire format puts every
 * variant's optional fields on the same object (matches the C# `Geometry`
 * class with all-nullable properties). Consumers narrow on `kind`.
 */
export interface Geometry {
  kind: GeometryKind
  size?: Vector3 | null
  radius?: number | null
  height?: number | null
  points?: Vector3[] | null
  assetUrl?: string | null
  prefabRef?: string | null
}

// ---------------------------------------------------------------------------
// Components (all optional on a GardenEntity — presence = engagement depth)
// ---------------------------------------------------------------------------

export type GrowthStage =
  | 'Seed'
  | 'Seedling'
  | 'Vegetative'
  | 'Flowering'
  | 'Fruiting'
  | 'Mature'
  | 'Spent'

export interface GrowthEvent {
  timestamp: string
  stage: GrowthStage
  heightInches?: number | null
  leafCount?: number | null
  sourcePhotoId?: Guid | null
  notes?: string | null
}

export interface GrowthLog {
  events: GrowthEvent[]
}

export interface PhotoRef {
  id: Guid
  objectKey: string
  thumbnailKey?: string | null
  takenUtc: string
  capturePosition?: Vector3 | null
  caption?: string | null
}

export interface PhotoLog {
  photos: PhotoRef[]
}

export type TaskKind =
  | 'Water'
  | 'Fertilize'
  | 'Prune'
  | 'ThinSeedlings'
  | 'Harvest'
  | 'Inspect'

export interface ScheduledTask {
  id: Guid
  kind: TaskKind
  dueUtc: string
  note?: string | null
  completed: boolean
}

export interface ScheduleComponent {
  sowDate?: string | null
  transplantDate?: string | null
  expectedHarvestStart?: string | null
  expectedHarvestEnd?: string | null
  lastWateredUtc?: string | null
  lastFertilizedUtc?: string | null
  upcomingTasks: ScheduledTask[]
}

export type QualityRating = 'Excellent' | 'Good' | 'Fair' | 'Poor'

export interface HarvestEvent {
  timestamp: string
  weightLbs?: number | null
  count?: number | null
  quality?: QualityRating | null
  notes?: string | null
}

export interface YieldLog {
  harvests: HarvestEvent[]
}

export type HealthEventKind =
  | 'PestSpotted'
  | 'DiseaseSpotted'
  | 'Treated'
  | 'Recovered'

export interface HealthEvent {
  timestamp: string
  kind: HealthEventKind
  description?: string | null
  identifiedProblem?: string | null
  treatmentApplied?: string | null
  sourcePhotoId?: Guid | null
  diagnosisRequestId?: Guid | null
}

export interface HealthLog {
  events: HealthEvent[]
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind = 'Bed' | 'Plant' | 'Structure' | 'Label' | 'Path'

export interface GardenEntity {
  id: Guid
  gardenId: Guid
  parentId?: Guid | null

  kind: EntityKind
  name: string
  cropRef?: string | null

  transform: Transform
  geometry: Geometry

  tags: string[]

  createdUtc: string
  modifiedUtc: string

  // Component bag — all optional, presence = depth of engagement.
  photos?: PhotoLog | null
  growth?: GrowthLog | null
  schedule?: ScheduleComponent | null
  yield?: YieldLog | null
  health?: HealthLog | null

  // Opaque per-entity bag for plugins / experiments (e.g. {"color": "#cabe8c"}).
  // Server stores raw JsonElements; the wire shape is just unknown JSON.
  extensions?: Record<string, unknown> | null
}

export interface Garden {
  id: Guid
  ownerUserId?: Guid | null
  name: string
  latitude?: number | null
  longitude?: number | null
  growingZone?: number | null
  lastFrostDate?: string | null
  firstFrostDate?: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface CreateGardenRequest {
  name?: string | null
}

export interface UpdateGardenRequest {
  name?: string | null
  latitude?: number | null
  longitude?: number | null
  growingZone?: number | null
}

export interface CreateEntityRequest {
  kind: EntityKind
  name?: string | null
  cropRef?: string | null
  parentId?: Guid | null
  transform?: Transform | null
  geometry?: Geometry | null
  tags?: string[] | null
  extensions?: Record<string, unknown> | null
}

export interface UpdateEntityRequest {
  name?: string | null
  cropRef?: string | null
  parentId?: Guid | null
  transform?: Transform | null
  geometry?: Geometry | null
  tags?: string[] | null
  extensions?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export interface PhotoView {
  id: Guid
  url: string
  takenUtc: string
  caption?: string | null
}

// ---------------------------------------------------------------------------
// Nudges (rule-based, broadcast over SignalR — NOT advisor / AI output)
// ---------------------------------------------------------------------------

export type NudgeKind =
  | 'WateringDue'
  | 'HarvestReady'
  | 'HealthAlert'
  | 'Other'

export interface Nudge {
  gardenId: Guid
  entityId: Guid
  entityName: string
  kind: NudgeKind
  message: string
  computedAt: string
}
