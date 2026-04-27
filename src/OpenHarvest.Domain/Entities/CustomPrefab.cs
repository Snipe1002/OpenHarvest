namespace OpenHarvest.Domain.Entities;

/// <summary>
/// Phase 5.4 — a user-saved single-entity template ("My Prefabs"). The user configures an entity
/// (size, prefab style, tags, name) the way they like, hits "Save as template", and gets a
/// reusable tile in the picker that stamps out copies on tap.
///
/// v1 is single-entity by design. Capturing groups (e.g. "save this raised bed AND the plants
/// inside it") is deferred — see ROADMAP. The captured shape is intentionally narrow: kind,
/// geometry, tags, optional cropRef, plus a display label / icon for the picker.
///
/// Geometry and Tags are serialized to JSON / array text and stored as opaque strings here so
/// the schema doesn't have to ratchet every time we add a geometry kind. The frontend
/// JSON.parse()s GeometryJson directly into a <see cref="ValueObjects.Geometry"/> shape and
/// TagsJson into a string[] — same on-the-wire format as <c>CreateEntityRequest</c>.
/// </summary>
public class CustomPrefab
{
    public Guid Id { get; set; }
    public Guid GardenId { get; set; }            // owner garden
    public string Slug { get; set; } = "";        // url-friendly id ("my-3x6-raised-bed")
    public string Name { get; set; } = "";        // display name ("3×6 Raised Bed")
    public string Icon { get; set; } = "📦";       // emoji icon for the picker tile

    // String per JsonStringEnumConverter convention (matches GardenEntity.Kind serialization).
    // Stored as a string so we don't have to migrate when the EntityKind enum gains values.
    public string EntityKind { get; set; } = "";

    public string? CropRef { get; set; }

    // Serialized Geometry (kind, size, prefabRef) — opaque JSON blob. The client owns the schema;
    // server treats this as a string and round-trips it on POST/GET.
    public string GeometryJson { get; set; } = "{}";

    // Serialized string[] of tags — same opaque-blob philosophy. Empty templates have "[]".
    public string TagsJson { get; set; } = "[]";

    public DateTime CreatedAt { get; set; }
}
