namespace OpenHarvest.Domain.Nudges;

public record Nudge(
    Guid GardenId,
    Guid EntityId,
    string EntityName,
    NudgeKind Kind,
    string Message,
    DateTime ComputedAt);

public enum NudgeKind
{
    /// <summary>The entity hasn't been watered in long enough to risk drought stress.</summary>
    WateringDue,
    /// <summary>Harvest window is open — pick now.</summary>
    HarvestReady,
    /// <summary>Suspected pest / disease event needs attention.</summary>
    HealthAlert,
    /// <summary>Generic nudge surfaced by the advisor (extension point).</summary>
    Other,
}
