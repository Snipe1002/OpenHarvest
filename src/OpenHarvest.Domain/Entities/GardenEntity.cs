using System.Text.Json;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Domain.Entities;

/// <summary>
/// The single entity type for everything in a garden — beds, plants, structures, labels, paths.
/// Required fields are minimal. All component fields are nullable; their presence drives feature
/// availability. The user gets full features for entities they've engaged with, and zero nag for
/// entities they have not.
/// </summary>
public class GardenEntity
{
    public Guid Id { get; set; }
    public Guid GardenId { get; set; }
    public Guid? ParentId { get; set; }      // plant -> bed -> garden

    public EntityKind Kind { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? CropRef { get; set; }     // OpenFarm slug if matched

    public Transform Transform { get; set; } = Transform.Identity;
    public Geometry Geometry { get; set; } = Geometry.Box(new Vector3(1, 1, 1));

    public DateTime CreatedUtc { get; set; }
    public DateTime ModifiedUtc { get; set; }

    // All nullable. Presence = depth of engagement.
    public PhotoLog? Photos { get; set; }
    public GrowthLog? Growth { get; set; }
    public ScheduleComponent? Schedule { get; set; }
    public YieldLog? Yield { get; set; }
    public HealthLog? Health { get; set; }

    // Escape hatch for plugins, experiments, future components.
    public Dictionary<string, JsonElement> Extensions { get; set; } = new();
}
