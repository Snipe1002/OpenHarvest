namespace OpenHarvest.Domain.Enums;

public enum GeometryKind
{
    Box,
    Cylinder,
    Polygon,
    MeshRef,
    /// <summary>
    /// Phase 5.2: a frontend-rendered prefab from <c>wwwroot/lib/prefabs.js</c>.
    /// <see cref="ValueObjects.Geometry.PrefabRef"/> picks which prefab; the optional
    /// <see cref="ValueObjects.Geometry.Size"/> overrides the prefab's default footprint.
    /// </summary>
    Prefab,
}
