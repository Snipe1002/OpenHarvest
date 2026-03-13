# OpenHarvest — Data Model

> All entities use `Guid` primary keys for distributed-friendly IDs. The model is organized around four domains: **Crops**, **Gardens**, **Activity**, and **Community**.

---

## Entity Relationship Overview

```
User ───┬─── Garden ─── GardenBed ─── Planting ─── PlantingLog
        │                                   │
        ├─── DiagnosisRequest               ├─── PlantingPhoto
        │                                   │
        ├─── HarvestShare                   └─── Crop ─┬─ CompanionPlanting
        │                                          ├─ PlantProblem
        └─── GrowingTip                           └─ CropTag
```

---

## 1. Crop Domain

The heart of the system — the structured knowledge base that replaces OpenFarm's crowdsourced wiki with a curated, AI-queryable dataset. OpenFarm's CC0 data seeds this initially.

```csharp
public class Crop
{
    public Guid Id { get; set; }
    public string CommonName { get; set; }        // "Tomato"
    public string ScientificName { get; set; }    // "Solanum lycopersicum"
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }

    // Growing Requirements
    public int MinGrowingZone { get; set; }       // USDA hardiness zone 3–13
    public int MaxGrowingZone { get; set; }
    public SunRequirement SunNeeds { get; set; }  // FullSun, PartialShade, FullShade
    public WaterLevel WaterNeeds { get; set; }    // Low, Medium, High
    public SoilType PreferredSoil { get; set; }   // Sandy, Loamy, Clay, Any
    public decimal? SoilPhMin { get; set; }
    public decimal? SoilPhMax { get; set; }

    // Timing (days)
    public int DaysToGermination { get; set; }
    public int DaysToMaturity { get; set; }
    public int? DaysToHarvest { get; set; }

    // Spacing (inches)
    public double SeedDepthInches { get; set; }
    public double PlantSpacingInches { get; set; }
    public double RowSpacingInches { get; set; }

    // Planning
    public int WeeksBeforeLastFrost { get; set; } // Start indoors X weeks before
    public int WeeksAfterLastFrost { get; set; }  // Transplant X weeks after
    public bool CanDirectSow { get; set; }
    public DifficultyLevel Difficulty { get; set; } // Beginner, Intermediate, Expert

    // Navigation Properties
    public List<CompanionPlanting> Companions { get; set; }
    public List<CropTag> Tags { get; set; }       // "vegetable", "herb", "fruit"
    public List<PlantProblem> KnownProblems { get; set; }
}

public class CompanionPlanting
{
    public Guid Id { get; set; }
    public Guid CropId { get; set; }
    public Guid CompanionCropId { get; set; }
    public CompanionType Type { get; set; }       // Beneficial, Antagonistic
    public string? Reason { get; set; }           // "Repels aphids", "Inhibits growth"
}

public class PlantProblem
{
    public Guid Id { get; set; }
    public string Name { get; set; }              // "Blossom End Rot"
    public string Symptoms { get; set; }
    public string Causes { get; set; }
    public string OrganicTreatment { get; set; }
    public string Prevention { get; set; }
    public string? ImageUrl { get; set; }
    public List<Crop> AffectedCrops { get; set; }
}
```

---

## 2. Garden Domain

Each user can have multiple gardens (backyard, balcony, community plot). Gardens contain beds/zones, which contain plantings. This is the personalization layer OpenFarm never had.

```csharp
public class Garden
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; }              // "Backyard Garden"
    public GardenType Type { get; set; }          // Backyard, Balcony, RaisedBed,
                                                  // CommunityPlot, Greenhouse, Indoor
    public double? AreaSqFt { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public int GrowingZone { get; set; }          // Auto-detected from lat/lng
    public DateTime? LastFrostDate { get; set; }  // Auto-populated from weather API
    public DateTime? FirstFrostDate { get; set; }
    public List<GardenBed> Beds { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class GardenBed
{
    public Guid Id { get; set; }
    public Guid GardenId { get; set; }
    public string Name { get; set; }              // "Bed A", "North Planter"
    public double? LengthFt { get; set; }
    public double? WidthFt { get; set; }
    public SunExposure SunExposure { get; set; }  // FullSun, PartSun, Shade
    public SoilType SoilType { get; set; }
    public List<Planting> Plantings { get; set; }
}

public class Planting
{
    public Guid Id { get; set; }
    public Guid GardenBedId { get; set; }
    public Guid CropId { get; set; }
    public DateTime PlantedDate { get; set; }
    public PlantingMethod Method { get; set; }    // DirectSow, Transplant, Cutting
    public PlantingStatus Status { get; set; }    // Planned, Planted, Growing,
                                                  // Harvesting, Finished, Failed
    public int Quantity { get; set; }
    public DateTime? ExpectedHarvestDate { get; set; } // AI-calculated
    public DateTime? HarvestedDate { get; set; }
    public double? YieldLbs { get; set; }
    public string? Notes { get; set; }
    public List<PlantingLog> Logs { get; set; }
    public List<PlantingPhoto> Photos { get; set; }
}
```

---

## 3. Activity & Knowledge Domain

This is what makes OpenHarvest a living system. Every interaction generates data that improves recommendations for everyone. Users contribute passively just by gardening.

```csharp
public class PlantingLog
{
    public Guid Id { get; set; }
    public Guid PlantingId { get; set; }
    public DateTime Timestamp { get; set; }
    public LogType Type { get; set; }             // Watered, Fertilized, Pruned,
                                                  // PestSpotted, Harvested, Note,
                                                  // Thinned, Transplanted
    public string? Notes { get; set; }
    public string? PhotoUrl { get; set; }
}

public class DiagnosisRequest
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? PlantingId { get; set; }         // Optional link to specific plant
    public string PhotoUrl { get; set; }
    public string? UserDescription { get; set; }  // "Leaves turning yellow"
    public string AiDiagnosis { get; set; }       // Full AI response
    public Guid? MatchedProblemId { get; set; }   // Link to PlantProblem if matched
    public DiagnosisRating? UserRating { get; set; } // Helpful, NotHelpful
    public DateTime CreatedAt { get; set; }
}
```

---

## 4. Community Domain

The community layer enables knowledge sharing and surplus distribution — turning individual gardens into a local food network.

```csharp
public class HarvestShare
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CropId { get; set; }
    public double QuantityLbs { get; set; }
    public string Description { get; set; }       // "10 lbs fresh tomatoes"
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public ShareStatus Status { get; set; }       // Available, Claimed, Completed
    public DateTime PostedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public class GrowingTip
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CropId { get; set; }
    public int GrowingZone { get; set; }
    public string Content { get; set; }           // "In zone 7b, start tomatoes
                                                  //  indoors by March 1"
    public int Upvotes { get; set; }
    public int Season { get; set; }               // Year of observation
    public DateTime CreatedAt { get; set; }
}
```

---

## 5. Enumerations

```csharp
public enum SunRequirement    { FullSun, PartialShade, FullShade }
public enum WaterLevel        { Low, Medium, High }
public enum SoilType          { Sandy, Loamy, Clay, Chalky, Peaty, Any }
public enum DifficultyLevel   { Beginner, Intermediate, Expert }
public enum GardenType        { Backyard, Balcony, RaisedBed, CommunityPlot, Greenhouse, Indoor }
public enum SunExposure       { FullSun, PartSun, DappledShade, FullShade }
public enum PlantingMethod    { DirectSow, Transplant, Cutting, Division, Layering }
public enum PlantingStatus    { Planned, Planted, Germinating, Growing, Harvesting, Finished, Failed }
public enum LogType           { Watered, Fertilized, Pruned, PestSpotted, Diseased, Harvested, Thinned, Transplanted, Note }
public enum CompanionType     { Beneficial, Antagonistic }
public enum ShareStatus       { Available, Claimed, Completed, Expired }
public enum DiagnosisRating   { Helpful, NotHelpful }
public enum ExperienceLevel   { FirstTimer, Beginner, Intermediate, Experienced, Expert }
```

---

## 6. Database Indexing Strategy

| Table | Index | Reason |
|---|---|---|
| `Crops` | `(CommonName)` | Full-text search |
| `Crops` | `(MinGrowingZone, MaxGrowingZone)` | Zone filtering |
| `Plantings` | `(GardenBedId, Status)` | Dashboard query |
| `PlantingLogs` | `(PlantingId, Timestamp DESC)` | Activity feed |
| `HarvestShares` | `(Latitude, Longitude)` | Geospatial proximity |
| `GrowingTips` | `(CropId, GrowingZone)` | Zone-specific tips |
| `DiagnosisRequests` | `(UserId, CreatedAt DESC)` | User history |

---

*See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.*
