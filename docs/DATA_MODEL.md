# OpenHarvest — Data Model

> Single entity type. Components attach lazily. The presence or absence of a component on an entity drives feature availability. No "data entry" mode — decoration *is* the data model.

---

## 1. Core Entity

```csharp
namespace OpenHarvest.Domain.Entities;

public class GardenEntity
{
    public Guid Id { get; set; }
    public Guid GardenId { get; set; }
    public Guid? ParentId { get; set; }       // plant -> bed -> garden

    public EntityKind Kind { get; set; }      // Bed | Plant | Structure | Label | Path
    public string Name { get; set; }          // free text; autocomplete suggests
    public string? CropRef { get; set; }      // OpenFarm slug if matched

    public Transform Transform { get; set; }  // pos, rot, scale
    public Geometry Geometry { get; set; }    // Box | Cylinder | Polygon | MeshRef

    public DateTime CreatedUtc { get; set; }
    public DateTime ModifiedUtc { get; set; }

    // All nullable. Presence = depth of engagement.
    public PhotoLog? Photos { get; set; }
    public GrowthLog? Growth { get; set; }
    public ScheduleComponent? Schedule { get; set; }
    public YieldLog? Yield { get; set; }
    public HealthLog? Health { get; set; }

    // Escape hatch for plugins, experiments, future components
    public Dictionary<string, JsonElement> Extensions { get; set; } = new();
}
```

The model is **flat**, not deep. There are no separate `Garden`, `GardenBed`, `Planting` tables. There are only entities with `Kind` and `ParentId`. A bed is an entity whose `Kind = Bed`. A plant is an entity whose `Kind = Plant` and `ParentId` points at its bed.

### `CropRef` — the magic field

When the canvas autocomplete suggests "Brandywine Tomato" and the user picks it, the entity binds silently to the OpenFarm CC0 record (slug as key). The user sees the friendly name. The advisor inherits days-to-maturity, spacing, sun and water requirements, companion data — none of which the user enters, all of which the platform uses.

`CropRef` is the bridge between casual decoration and intelligent advice. A plant with `CropRef = null` is a labeled shape; the advisor ignores it. A plant with `CropRef = "brandywine-tomato"` is a fully-specified crop the advisor can reason about.

---

## 2. Common Types

```csharp
public enum EntityKind { Bed, Plant, Structure, Label, Path }

public class Transform
{
    public Vector3 Position { get; set; }
    public Quaternion Rotation { get; set; }
    public Vector3 Scale { get; set; }
}

public abstract class Geometry { /* Box | Cylinder | Polygon | MeshRef */ }

public class BoxGeometry      : Geometry { public Vector3 Size { get; set; } }
public class CylinderGeometry : Geometry { public double Radius { get; set; } public double Height { get; set; } }
public class PolygonGeometry  : Geometry { public List<Vector2> Points { get; set; } }
public class MeshRefGeometry  : Geometry { public string AssetUrl { get; set; } }
```

---

## 3. Components

Each component is stored as a JSONB blob inside `GardenEntity` (or as a related row, depending on query patterns; tracked in ADRs). Only present when the user has touched that aspect of the entity.

### PhotoLog

Created on first photo tap. Lists all photos attached to this entity.

```csharp
public class PhotoLog
{
    public List<PhotoRef> Photos { get; set; } = new();
}

public class PhotoRef
{
    public Guid Id { get; set; }
    public string ObjectKey { get; set; }   // MinIO key
    public string ThumbnailKey { get; set; }
    public DateTime TakenUtc { get; set; }
    public Vector3? CapturePosition { get; set; } // optional position correction
    public string? Caption { get; set; }
}
```

### GrowthLog

Derived from `PhotoLog` plus optional manual notes. Stage transitions, height, leaf counts (when AI vision is enabled).

```csharp
public class GrowthLog
{
    public List<GrowthEvent> Events { get; set; } = new();
}

public class GrowthEvent
{
    public DateTime Timestamp { get; set; }
    public GrowthStage Stage { get; set; }     // Seed, Seedling, Vegetative, Flowering, Fruiting, Mature, Spent
    public double? HeightInches { get; set; }
    public int? LeafCount { get; set; }
    public Guid? SourcePhotoId { get; set; }   // photo this was derived from, if any
    public string? Notes { get; set; }
}

public enum GrowthStage { Seed, Seedling, Vegetative, Flowering, Fruiting, Mature, Spent }
```

### ScheduleComponent

Pre-populated from `CropRef` when bound. The advisor uses this to issue nudges.

```csharp
public class ScheduleComponent
{
    public DateTime? SowDate { get; set; }
    public DateTime? TransplantDate { get; set; }
    public DateTime? ExpectedHarvestStart { get; set; }
    public DateTime? ExpectedHarvestEnd { get; set; }
    public DateTime? LastWateredUtc { get; set; }
    public DateTime? LastFertilizedUtc { get; set; }
    public List<ScheduledTask> UpcomingTasks { get; set; } = new();
}

public class ScheduledTask
{
    public Guid Id { get; set; }
    public TaskKind Kind { get; set; }     // Water, Fertilize, Prune, ThinSeedlings, Harvest, Inspect
    public DateTime DueUtc { get; set; }
    public string? Note { get; set; }
    public bool Completed { get; set; }
}
```

### YieldLog

Harvest entries with weight or count, date, quality notes.

```csharp
public class YieldLog
{
    public List<HarvestEvent> Harvests { get; set; } = new();
}

public class HarvestEvent
{
    public DateTime Timestamp { get; set; }
    public double? WeightLbs { get; set; }
    public int? Count { get; set; }
    public QualityRating? Quality { get; set; } // Excellent, Good, Fair, Poor
    public string? Notes { get; set; }
}

public enum QualityRating { Excellent, Good, Fair, Poor }
```

### HealthLog

Pest sightings, disease flags, treatment records.

```csharp
public class HealthLog
{
    public List<HealthEvent> Events { get; set; } = new();
}

public class HealthEvent
{
    public DateTime Timestamp { get; set; }
    public HealthEventKind Kind { get; set; }   // PestSpotted, DiseaseSpotted, Treated, Recovered
    public string? Description { get; set; }
    public string? IdentifiedProblem { get; set; } // e.g. "blossom-end-rot" — links to crop catalog
    public string? TreatmentApplied { get; set; }
    public Guid? SourcePhotoId { get; set; }
    public Guid? DiagnosisRequestId { get; set; }
}
```

---

## 4. Crop Catalog (OpenFarm-derived)

The crop catalog is **read-only reference data**. It seeds from OpenFarm's CC0 export and is mirrored locally; the worker periodically re-syncs. It is not part of the per-user entity store — it's a separate table queried via `CropRef` slugs.

```csharp
public class Crop
{
    public string Slug { get; set; }            // primary key — matches CropRef
    public string CommonName { get; set; }
    public string ScientificName { get; set; }
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }

    public int MinGrowingZone { get; set; }
    public int MaxGrowingZone { get; set; }
    public SunRequirement SunNeeds { get; set; }
    public WaterLevel WaterNeeds { get; set; }
    public SoilType PreferredSoil { get; set; }
    public decimal? SoilPhMin { get; set; }
    public decimal? SoilPhMax { get; set; }

    public int DaysToGermination { get; set; }
    public int DaysToMaturity { get; set; }
    public int? DaysToHarvest { get; set; }

    public double SeedDepthInches { get; set; }
    public double PlantSpacingInches { get; set; }
    public double RowSpacingInches { get; set; }

    public int WeeksBeforeLastFrost { get; set; }
    public int WeeksAfterLastFrost { get; set; }
    public bool CanDirectSow { get; set; }
    public DifficultyLevel Difficulty { get; set; }

    public List<CompanionPlanting> Companions { get; set; }
    public List<CropTag> Tags { get; set; }
    public List<PlantProblem> KnownProblems { get; set; }

    public DateTime LastSyncedUtc { get; set; }
}
```

`CompanionPlanting`, `PlantProblem`, etc. carry the same intent as in OpenFarm's data — see [`REFERENCES.md`](REFERENCES.md) for the source schema.

---

## 5. Community Layer (Network)

The community layer is part of Layer 4 (Network). It is opt-in and physically deployed only on federated public instances — self-hosters can disable it entirely. These records are not nullable components; they're standalone tables.

```csharp
public class HarvestShare
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? SourceEntityId { get; set; }   // optional link to the GardenEntity that produced it
    public string CropRef { get; set; }
    public double QuantityLbs { get; set; }
    public string Description { get; set; }
    public double Latitude { get; set; }        // coarsened to ~10 km in public APIs
    public double Longitude { get; set; }
    public ShareStatus Status { get; set; }
    public DateTime PostedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public class GrowingTip
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string CropRef { get; set; }
    public int GrowingZone { get; set; }
    public string Content { get; set; }
    public int Upvotes { get; set; }
    public int Season { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

---

## 6. User & Garden

Auth is anonymous-first. A `User` record only exists when the user opts in to syncing — local PWA state is the source of truth until then.

```csharp
public class User
{
    public Guid Id { get; set; }
    public string? Email { get; set; }          // null for fully anonymous
    public string? DisplayName { get; set; }
    public ExperienceLevel ExperienceLevel { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Garden
{
    public Guid Id { get; set; }
    public Guid? OwnerUserId { get; set; }      // null for anonymous local-only gardens
    public string Name { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public int? GrowingZone { get; set; }       // auto-detected from lat/lng
    public DateTime? LastFrostDate { get; set; }
    public DateTime? FirstFrostDate { get; set; }
    public DateTime CreatedAt { get; set; }

    // Entities live in their own table, joined by GardenId
}
```

When an anonymous user upgrades to an account, all `GardenEntity` rows for the local garden id are reassigned to the new server-issued garden id, and a `User` row is minted.

---

## 7. Enumerations

```csharp
public enum SunRequirement   { FullSun, PartialShade, FullShade }
public enum WaterLevel       { Low, Medium, High }
public enum SoilType         { Sandy, Loamy, Clay, Chalky, Peaty, Any }
public enum DifficultyLevel  { Beginner, Intermediate, Expert }
public enum ExperienceLevel  { FirstTimer, Beginner, Intermediate, Experienced, Expert }
public enum ShareStatus      { Available, Claimed, Completed, Expired }
public enum DiagnosisRating  { Helpful, NotHelpful }
```

---

## 8. Persistence Strategy

Postgres with EF Core. `GardenEntity` rows live in a single table with a JSONB column for components and `Extensions`. Components can be lifted into typed projections via EF value converters.

| Table | Index | Reason |
|---|---|---|
| `GardenEntities` | `(GardenId, ModifiedUtc DESC)` | live-sync delta query |
| `GardenEntities` | `(GardenId, Kind)` | render plant/bed lists |
| `GardenEntities` | `(ParentId)` | hierarchical fetch (bed -> plants) |
| `GardenEntities` | GIN on JSONB `Components` | component-presence queries |
| `Crops` | `(Slug)` UNIQUE | catalog lookup by `CropRef` |
| `Crops` | `(MinGrowingZone, MaxGrowingZone)` | zone filtering |
| `HarvestShares` | `(Latitude, Longitude)` | geospatial proximity |
| `GrowingTips` | `(CropRef, GrowingZone)` | zone-specific tips |

---

## 9. Pricing Alignment (deferred decision)

If a paid tier ships, the boundary aligns naturally with components:

- **Free** writes: `Name`, `Transform`, `Geometry`, `Photos`
- **Paid** writes: `Schedule`, `Growth`, `Yield`, `Health`, advisor output

Entire components are absent for free users — not half-disabled. No broken UI, no "upgrade to unlock" stubs. The casual user never knows the upgrade exists.

The preferred path is to keep tracking free and find another sustainability model (donations, hosted-instance fees, hardware add-ons). Decision deferred.

---

*See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system design and [`UX.md`](UX.md) for how this model maps to the user experience.*
