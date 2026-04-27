using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Domain.Interfaces;

public interface IAiProvider
{
    /// <summary>
    /// Returns true when a real provider is configured (API key set, etc.). Falls back to
    /// a graceful "not configured" message if false.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Provider identifier ("claude" / "openai" / "ollama") for telemetry.
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Answer a natural-language gardening question, enriched with the user's context.
    /// </summary>
    Task<AdvisorAnswer> AskGardeningQuestion(
        string question,
        GardenContext context,
        CancellationToken ct = default);

    /// <summary>
    /// Diagnose a plant issue from a photo + optional user description.
    /// </summary>
    Task<DiagnosisResult> DiagnosePlantIssue(
        Stream photo,
        string photoMimeType,
        string? userDescription,
        EntityContext context,
        CancellationToken ct = default);

    /// <summary>
    /// Generate a per-crop planting calendar from the user's garden context.
    /// Each crop the user is growing gets a list of dated tasks (sow, transplant,
    /// expected harvest window) tailored to their zone + frost dates.
    /// </summary>
    Task<PlantingCalendar> GeneratePlantingCalendar(
        GardenContext context,
        IReadOnlyList<Crop> cropCatalog,
        CancellationToken ct = default);

    /// <summary>
    /// Phase 5.5 — propose where to plant the requested crops within the user's existing scene.
    /// Suggestions carry a world-space (X, Z) coordinate plus an optional parent entity id when
    /// the planner thinks the crop should sit inside a raised bed / shelf / pot. Each suggestion
    /// also carries a 1-2 sentence rationale grounded in concrete scene features so the user can
    /// decide whether to commit it.
    /// </summary>
    Task<PlacementPlan> SuggestPlacements(
        GardenContext context,
        IReadOnlyList<EntitySummary> existing,
        IReadOnlyList<Crop> requested,
        CancellationToken ct = default);
}

/// <summary>The user's garden state at the moment of an AI request.</summary>
public class GardenContext
{
    public int? GrowingZone { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime? LastFrostDate { get; set; }
    public DateTime? FirstFrostDate { get; set; }
    public string CurrentSeason { get; set; } = "unknown";
    public List<EntitySummary> Plantings { get; set; } = new();
    public ExperienceLevel UserExperience { get; set; } = ExperienceLevel.FirstTimer;
}

public class EntityContext
{
    public Guid EntityId { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string? CropRef { get; set; }
    public Crop? Crop { get; set; }
    public GardenContext Garden { get; set; } = new();
}

public class EntitySummary
{
    /// <summary>
    /// Phase 5.5 — entity GUID (string-encoded). Required so the placement planner can hand
    /// back a `parentEntityId` referencing one of these rows; older callers that don't care
    /// about identity can leave this empty.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Phase 5.5 — `EntityKind` as a string ("Bed", "Plant", "Structure"...). Lets the
    /// advisor reason about scene topology (which entities can act as containers, which are
    /// walls that block sun, etc.) without coupling the Domain to the prompt.
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    public string? CropRef { get; set; }

    /// <summary>Phase 5.5 — world-space east coordinate in feet.</summary>
    public double X { get; set; }

    /// <summary>Phase 5.5 — world-space up coordinate in feet (usually 0 for ground entities).</summary>
    public double Y { get; set; }

    /// <summary>Phase 5.5 — world-space north coordinate in feet.</summary>
    public double Z { get; set; }

    /// <summary>
    /// Phase 5.3 — user-supplied tags propagated to the advisor so guidance can ground in
    /// container type, exposure, watering style, etc. ("raised", "south-facing", "high-water").
    /// Empty array when the user hasn't tagged the entity. Must remain a flat string list:
    /// nothing in the prompt assumes structure.
    /// </summary>
    public List<string> Tags { get; set; } = new();
}

public enum ExperienceLevel { FirstTimer, Beginner, Intermediate, Experienced, Expert }

public record AdvisorAnswer(string Text, string Provider, string Model, int InputTokens, int OutputTokens);

public record DiagnosisResult(
    string Diagnosis,
    string? IdentifiedProblem,
    string? Treatment,
    string Provider,
    string Model);

public record PlantingCalendar(
    string Provider,
    string Model,
    List<CalendarEntry> Entries,
    string? Summary);

public record CalendarEntry(
    DateOnly Date,
    string CropName,
    string? CropRef,
    CalendarTaskKind Kind,
    string? Note);

public enum CalendarTaskKind
{
    StartIndoors,
    DirectSow,
    Transplant,
    HarvestWindowStart,
    HarvestWindowEnd,
    Other,
}

// Phase 5.5 — AI-assisted placement.
//
// PlacementPlan is the response wrapper; each PlacementSuggestion is a single ghost-pin the
// PWA renders in the 3D scene. Coordinates are world-space feet (x = east, z = north, y is
// up but we don't return y here — the PWA puts ghost markers at ground level). The
// `parentEntityId` field is OPTIONAL: null = in-ground / free-standing, otherwise a GUID
// (string-encoded so the JSON shape matches what the PWA already expects).
public record PlacementPlan(
    string Provider,
    string Model,
    List<PlacementSuggestion> Suggestions,
    string? Summary);

public record PlacementSuggestion(
    string CropRef,
    string CropName,
    Coord Position,
    string? ParentEntityId,
    string Rationale);

public record Coord(double X, double Z);
