namespace OpenHarvest.Domain.Entities;

/// <summary>
/// A yard is a physical property the operator captures via walk-mode. v1 supports a single
/// yard, but every walk-mode row carries a <c>YardId</c> from day one so the multi-property
/// schema seam exists before multi-property UI lands.
///
/// Yards are distinct from <see cref="Garden"/>: a yard is the real-world coordinate space
/// (with a known centroid lat/lng), and may be associated with one or more gardens that share
/// that physical space. A default yard with slug <c>home</c> is seeded so existing single-user
/// installs have a destination for walk-mode captures.
/// </summary>
public class Yard
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    /// <summary>Optional centroid for the property — used for the walk-mode UI's "you are here" hint.</summary>
    public double? CentroidLat { get; set; }
    public double? CentroidLng { get; set; }

    /// <summary>
    /// Garden this yard is attached to. v1 wires one yard to one garden so promoted captures
    /// can target the garden's entity table. Multi-yard layouts will relax this in a later phase.
    /// </summary>
    public Guid? GardenId { get; set; }

    public DateTime CreatedUtc { get; set; }
}
