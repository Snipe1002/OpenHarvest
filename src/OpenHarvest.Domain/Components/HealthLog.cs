namespace OpenHarvest.Domain.Components;

public class HealthLog
{
    public List<HealthEvent> Events { get; set; } = new();
}

public class HealthEvent
{
    public DateTime Timestamp { get; set; }
    public HealthEventKind Kind { get; set; }
    public string? Description { get; set; }
    public string? IdentifiedProblem { get; set; }
    public string? TreatmentApplied { get; set; }
    public Guid? SourcePhotoId { get; set; }
    public Guid? DiagnosisRequestId { get; set; }
}

public enum HealthEventKind
{
    PestSpotted,
    DiseaseSpotted,
    Treated,
    Recovered
}
