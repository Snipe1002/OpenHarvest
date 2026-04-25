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
}

public enum ExperienceLevel { FirstTimer, Beginner, Intermediate, Experienced, Expert }

public record AdvisorAnswer(string Text, string Provider, string Model, int InputTokens, int OutputTokens);

public record DiagnosisResult(
    string Diagnosis,
    string? IdentifiedProblem,
    string? Treatment,
    string Provider,
    string Model);
