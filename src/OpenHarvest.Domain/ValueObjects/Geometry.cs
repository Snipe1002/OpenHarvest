using OpenHarvest.Domain.Enums;

namespace OpenHarvest.Domain.ValueObjects;

/// <summary>
/// Discriminated by <see cref="Kind"/>. Only one set of fields is meaningful at a time.
/// Stored as JSON in Postgres so adding new kinds is non-breaking.
/// </summary>
public class Geometry
{
    public GeometryKind Kind { get; init; }

    // Box: width / height / depth via Size
    public Vector3? Size { get; init; }

    // Cylinder: Radius + Height
    public double? Radius { get; init; }
    public double? Height { get; init; }

    // Polygon: list of 2D points (x, z planar)
    public List<Vector3>? Points { get; init; }

    // MeshRef: external asset key
    public string? AssetUrl { get; init; }

    public static Geometry Box(Vector3 size) => new() { Kind = GeometryKind.Box, Size = size };
    public static Geometry Cylinder(double radius, double height) =>
        new() { Kind = GeometryKind.Cylinder, Radius = radius, Height = height };
}
