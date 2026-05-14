using System.Text.Json;

namespace OpenHarvest.Domain.Entities;

/// <summary>
/// One AI-proposed entity (raised bed, planter, plant, structure, etc.) extracted from a
/// <see cref="Capture"/>'s photo by the classification worker. A single capture may produce
/// multiple proposals (e.g. a wide-frame photo of three raised beds yields three proposals).
///
/// Proposals are not auto-placed in v1. The operator reviews them in the staging panel and
/// either promotes (creating a <see cref="GardenEntity"/>) or rejects (no entity created).
/// </summary>
public class ClassificationProposal
{
    public Guid Id { get; set; }
    public Guid CaptureId { get; set; }

    /// <summary>Multi-property seam. Denormalised for cheap filtering.</summary>
    public Guid YardId { get; set; }

    /// <summary>
    /// Free-form kind label from the vision response (e.g. "raised_bed", "container", "plant",
    /// "structure"). The promote endpoint maps this onto a domain <see cref="OpenHarvest.Domain.Enums.EntityKind"/>.
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>0.0–1.0 confidence as reported by the vision endpoint.</summary>
    public double Confidence { get; set; }

    /// <summary>
    /// Suggested size, plant list, color, and any other free-form payload from the vision
    /// response. Stored as JSONB so future vision-model versions can add fields without a
    /// schema migration.
    /// </summary>
    public JsonElement? Payload { get; set; }

    /// <summary>If the operator already promoted this proposal, the entity it became.</summary>
    public Guid? PromotedEntityId { get; set; }

    public DateTime CreatedUtc { get; set; }
}
