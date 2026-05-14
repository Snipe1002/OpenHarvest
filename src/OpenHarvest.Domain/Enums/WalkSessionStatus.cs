namespace OpenHarvest.Domain.Enums;

/// <summary>
/// Lifecycle of a walk-mode session. A walk transitions strictly forward:
/// Active → Ended → Classified (the last hop is driven by the deferred classification worker).
/// </summary>
public enum WalkSessionStatus
{
    Active = 0,
    Ended = 1,
    Classified = 2,
}
