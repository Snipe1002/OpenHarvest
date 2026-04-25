namespace OpenHarvest.Domain.Entities;

/// <summary>
/// Read-only crop catalog entry. Seeded from OpenFarm CC0 export and queried via the
/// autocomplete in the canvas. The entity that the user places carries a <c>CropRef</c>
/// that matches a <see cref="Slug"/> here, binding the user's plant to all this metadata
/// without them ever entering it themselves.
/// </summary>
public class Crop
{
    public string Slug { get; set; } = string.Empty;          // primary key, OpenFarm-style
    public string CommonName { get; set; } = string.Empty;
    public string? ScientificName { get; set; }
    public string? Description { get; set; }

    public int? MinGrowingZone { get; set; }
    public int? MaxGrowingZone { get; set; }

    public int? DaysToGermination { get; set; }
    public int? DaysToMaturity { get; set; }

    public double? PlantSpacingInches { get; set; }
    public double? RowSpacingInches { get; set; }

    public bool CanDirectSow { get; set; }
    public string[] Tags { get; set; } = Array.Empty<string>();   // "vegetable", "herb", "fruit"

    public DateTime LastSyncedUtc { get; set; }
}
