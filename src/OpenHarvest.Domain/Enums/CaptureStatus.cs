namespace OpenHarvest.Domain.Enums;

/// <summary>
/// Lifecycle of an individual walk-mode capture. The classification worker advances captures
/// from <c>Pending</c> to <c>Classified</c> by writing zero or more <see cref="OpenHarvest.Domain.Entities.ClassificationProposal"/>
/// rows. Operator action in the staging review panel advances to <c>Promoted</c> (an entity was
/// created from a proposal) or <c>Rejected</c> (the capture is dismissed; no entity created).
/// <c>ClassificationFailed</c> is a terminal-but-non-fatal state when the vision endpoint errored
/// or wasn't configured; the photo + reading + GPS are still retained so the operator can
/// review and manually promote.
/// </summary>
public enum CaptureStatus
{
    Pending = 0,
    Classified = 1,
    ClassificationFailed = 2,
    Promoted = 3,
    Rejected = 4,
}
