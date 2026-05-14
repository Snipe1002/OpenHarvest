namespace OpenHarvest.Domain.ValueObjects;

/// <summary>
/// One analog tool reading the operator typed into the capture form (e.g. a soil-probe pH
/// dial, a moisture meter needle). Stored as part of a <see cref="OpenHarvest.Domain.Entities.Capture"/>'s
/// JSON readings list so the column shape doesn't have to change every time a new tool joins
/// the fleet.
/// </summary>
public class ManualReading
{
    /// <summary>Operator-facing tool label (e.g. "soil-probe-ph", "moisture-needle", "luxmeter").</summary>
    public string Tool { get; set; } = string.Empty;

    public double Value { get; set; }

    /// <summary>Free-form unit string (e.g. "pH", "%", "lux"). Not validated against a registry yet.</summary>
    public string Unit { get; set; } = string.Empty;
}
