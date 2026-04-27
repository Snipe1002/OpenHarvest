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
    public string Name { get; set; } = string.Empty;
    public string? CropRef { get; set; }

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
