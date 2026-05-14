using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Domain.Entities;

/// <summary>
/// A single tap-to-capture event during a walk-mode session: photo bytes, GPS fix, and any
/// manual probe readings the operator typed. Each capture flows through the deferred
/// classification worker which writes zero or more <see cref="ClassificationProposal"/> rows
/// before the operator reviews them in the staging panel.
///
/// The photo is stored externally (under <see cref="PhotoObjectKey"/> via <see cref="OpenHarvest.Domain.Interfaces.IPhotoStore"/>);
/// only the key lives on this row.
/// </summary>
public class Capture
{
    public Guid Id { get; set; }
    public Guid WalkSessionId { get; set; }

    /// <summary>Multi-property seam. Denormalised from the walk session for cheap filtering.</summary>
    public Guid YardId { get; set; }

    /// <summary>Storage key returned by <see cref="OpenHarvest.Domain.Interfaces.IPhotoStore.UploadAsync"/>.</summary>
    public string PhotoObjectKey { get; set; } = string.Empty;

    public DateTime CapturedUtc { get; set; }

    // GPS — nullable because phones sometimes can't get a fix (indoors, dense canopy).
    public double? GpsLat { get; set; }
    public double? GpsLng { get; set; }

    /// <summary>Reported accuracy in meters from the browser geolocation API.</summary>
    public double? GpsAccuracyMeters { get; set; }

    /// <summary>Operator-typed analog tool readings. JSONB column.</summary>
    public List<ManualReading> ManualReadings { get; set; } = new();

    /// <summary>Optional free-form note attached to this single capture.</summary>
    public string? Note { get; set; }

    public CaptureStatus Status { get; set; } = CaptureStatus.Pending;

    /// <summary>
    /// Populated by the classification worker if the vision endpoint returns an error
    /// (e.g. unreachable, 5xx, malformed response). Operators can still manually promote
    /// a failed-classify capture from the staging panel.
    /// </summary>
    public string? ClassificationError { get; set; }

    public DateTime? ClassifiedUtc { get; set; }
}
