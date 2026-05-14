using OpenHarvest.Domain.Enums;

namespace OpenHarvest.Domain.Entities;

/// <summary>
/// A single walk-mode session: the operator opens the page on their phone, taps Start Walk,
/// wanders the yard taking photos and manual probe readings, then taps End Walk. The session
/// ID groups all <see cref="Capture"/> rows produced during that walk so the staging review
/// panel can present them together.
///
/// Sessions never delete their captures — even a rejected capture stays in the database so
/// the operator can reverse a misclick. Deletion is a future maintenance concern.
/// </summary>
public class WalkSession
{
    public Guid Id { get; set; }

    /// <summary>Multi-property seam. Every walk-mode row carries this from day one.</summary>
    public Guid YardId { get; set; }

    public DateTime StartedUtc { get; set; }
    public DateTime? EndedUtc { get; set; }

    public WalkSessionStatus Status { get; set; } = WalkSessionStatus.Active;

    /// <summary>
    /// Optional free-form note the operator typed before/during the walk. Useful for tagging
    /// "after the spring rain" or "with the new soil probe" so future analysis can stratify.
    /// </summary>
    public string? Note { get; set; }
}
