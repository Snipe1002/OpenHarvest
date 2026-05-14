using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpenHarvest.API.Hubs;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.ValueObjects;
using OpenHarvest.Infrastructure.Data;

namespace OpenHarvest.API.Controllers;

/// <summary>
/// Operator-facing actions on a single capture from the walk-mode staging panel: promote a
/// proposal into a real <see cref="GardenEntity"/>, or reject the capture entirely. v1 does
/// NOT auto-place — every promotion is an explicit operator decision. The promoted entity
/// lands in the yard's attached garden with a default Transform (origin) and a Box geometry
/// sized from the proposal payload if present, otherwise a 1m cube.
/// </summary>
[ApiController]
[Route("api/v1/captures")]
public class CapturesController : ControllerBase
{
    private readonly OpenHarvestDbContext _db;
    private readonly GardenBroadcaster _broadcaster;
    private readonly ILogger<CapturesController> _log;

    public CapturesController(OpenHarvestDbContext db, GardenBroadcaster broadcaster, ILogger<CapturesController> log)
    {
        _db = db;
        _broadcaster = broadcaster;
        _log = log;
    }

    /// <summary>
    /// Promote a proposal from this capture into a new <see cref="GardenEntity"/>. Overrides
    /// let the operator tweak the name / size before promotion. Multiple promotions from a
    /// single capture are allowed (e.g. a wide-frame photo with three proposals — promote two,
    /// reject one).
    /// </summary>
    [HttpPost("{id:guid}/promote")]
    public async Task<ActionResult<PromoteResultView>> Promote(
        Guid id,
        [FromBody] PromoteCaptureRequest req,
        CancellationToken ct)
    {
        var capture = await _db.Captures.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (capture is null) return NotFound(new { error = "capture not found" });
        if (capture.Status == CaptureStatus.Rejected)
            return BadRequest(new { error = "capture was rejected" });

        var proposal = await _db.ClassificationProposals
            .FirstOrDefaultAsync(p => p.Id == req.EntityProposalId && p.CaptureId == capture.Id, ct);
        if (proposal is null) return NotFound(new { error = "proposal not found for this capture" });
        if (proposal.PromotedEntityId.HasValue)
            return BadRequest(new { error = "proposal already promoted", entityId = proposal.PromotedEntityId.Value });

        var yard = await _db.Yards.FirstOrDefaultAsync(y => y.Id == capture.YardId, ct);
        if (yard is null || !yard.GardenId.HasValue)
        {
            return BadRequest(new { error = "yard has no attached garden — cannot promote" });
        }
        var gardenId = yard.GardenId.Value;

        var now = DateTime.UtcNow;
        var entity = BuildEntityFromProposal(gardenId, proposal, capture, req.Overrides, now);
        _db.Entities.Add(entity);

        proposal.PromotedEntityId = entity.Id;
        capture.Status = CaptureStatus.Promoted;
        await _db.SaveChangesAsync(ct);

        await _broadcaster.EntityUpserted(gardenId, entity, ct);

        return Ok(new PromoteResultView(entity.Id, gardenId, capture.Id, proposal.Id));
    }

    /// <summary>Reject a capture: no entity is created, the capture flips to
    /// <see cref="CaptureStatus.Rejected"/>, the photo + readings remain in the database so
    /// the operator can reverse a misclick.</summary>
    [HttpPost("{id:guid}/reject")]
    public async Task<ActionResult> Reject(Guid id, CancellationToken ct)
    {
        var capture = await _db.Captures.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (capture is null) return NotFound(new { error = "capture not found" });
        if (capture.Status == CaptureStatus.Promoted)
            return BadRequest(new { error = "capture already promoted — cannot reject" });
        capture.Status = CaptureStatus.Rejected;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static GardenEntity BuildEntityFromProposal(
        Guid gardenId,
        ClassificationProposal proposal,
        Capture capture,
        PromoteOverrides? overrides,
        DateTime now)
    {
        var kind = MapKind(proposal.Kind);
        var name = !string.IsNullOrWhiteSpace(overrides?.Name)
            ? overrides!.Name!.Trim()
            : DefaultNameFor(proposal.Kind);

        var size = ResolveSize(proposal.Payload, overrides?.SizeM);
        var geometry = Geometry.Box(size);

        var entity = new GardenEntity
        {
            Id = Guid.NewGuid(),
            GardenId = gardenId,
            ParentId = null,
            Kind = kind,
            Name = name,
            Transform = Transform.Identity,
            Geometry = geometry,
            Tags = ProposedTags(proposal.Kind),
            CreatedUtc = now,
            ModifiedUtc = now,
        };
        // Stash provenance in the entity extensions bag so the UI can show "promoted from
        // walk capture X" later without joining tables. The bag is opaque to the server.
        var payloadJson = proposal.Payload?.GetRawText();
        var bag = new Dictionary<string, JsonElement>
        {
            ["walkCaptureId"] = JsonDocument.Parse(JsonSerializer.Serialize(capture.Id)).RootElement.Clone(),
            ["walkProposalId"] = JsonDocument.Parse(JsonSerializer.Serialize(proposal.Id)).RootElement.Clone(),
            ["proposedKind"] = JsonDocument.Parse(JsonSerializer.Serialize(proposal.Kind)).RootElement.Clone(),
            ["proposedConfidence"] = JsonDocument.Parse(JsonSerializer.Serialize(proposal.Confidence)).RootElement.Clone(),
        };
        if (!string.IsNullOrWhiteSpace(payloadJson))
        {
            bag["proposalPayload"] = JsonDocument.Parse(payloadJson).RootElement.Clone();
        }
        entity.Extensions = bag;
        return entity;
    }

    private static EntityKind MapKind(string visionKind) =>
        visionKind?.ToLowerInvariant() switch
        {
            "raised_bed" or "bed" or "garden_bed" => EntityKind.Bed,
            "plant" or "seedling" or "tree" or "shrub" => EntityKind.Plant,
            "label" or "sign" => EntityKind.Label,
            "path" or "walkway" => EntityKind.Path,
            // Greenhouse, planter, shed, fence, container, etc. all flow into the generic
            // Structure kind. The proposed-kind string is preserved verbatim in
            // Extensions["proposedKind"] so future passes can refine the mapping.
            _ => EntityKind.Structure,
        };

    private static string DefaultNameFor(string visionKind) =>
        visionKind?.ToLowerInvariant() switch
        {
            "raised_bed" or "bed" or "garden_bed" => "Raised Bed",
            "plant" => "Plant",
            "seedling" => "Seedling",
            "tree" => "Tree",
            "shrub" => "Shrub",
            "container" => "Container",
            "greenhouse" => "Greenhouse",
            "shed" => "Shed",
            "fence" => "Fence",
            "label" => "Label",
            "sign" => "Sign",
            "path" or "walkway" => "Path",
            _ => string.IsNullOrWhiteSpace(visionKind) ? "Proposed entity" : visionKind!,
        };

    private static string[] ProposedTags(string visionKind) =>
        visionKind?.ToLowerInvariant() switch
        {
            "raised_bed" or "bed" or "garden_bed" => new[] { "raised", "walk-proposed" },
            "container" => new[] { "container", "walk-proposed" },
            "greenhouse" => new[] { "greenhouse", "walk-proposed" },
            _ => new[] { "walk-proposed" },
        };

    /// <summary>Pull a size from the proposal payload's <c>size_m</c> field (w/h/d are typical
    /// keys) and fall back to a 1m cube. Overrides win when present.</summary>
    private static Vector3 ResolveSize(JsonElement? payload, SizeOverride? overrides)
    {
        if (overrides is { } o)
        {
            return new Vector3(NonZero(o.W, 1), NonZero(o.H, 0.5), NonZero(o.D, 1));
        }
        if (payload is { } el && el.ValueKind == JsonValueKind.Object && el.TryGetProperty("size_m", out var sizeEl))
        {
            var w = ReadDouble(sizeEl, "w") ?? ReadDouble(sizeEl, "width") ?? 1.0;
            var h = ReadDouble(sizeEl, "h") ?? ReadDouble(sizeEl, "height") ?? 0.5;
            var d = ReadDouble(sizeEl, "d") ?? ReadDouble(sizeEl, "depth") ?? ReadDouble(sizeEl, "length") ?? 1.0;
            return new Vector3(w, h, d);
        }
        return new Vector3(1, 0.5, 1);
    }

    private static double? ReadDouble(JsonElement obj, string key)
    {
        if (obj.ValueKind != JsonValueKind.Object) return null;
        if (!obj.TryGetProperty(key, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String when double.TryParse(v.GetString(), out var d) => d,
            _ => null,
        };
    }

    private static double NonZero(double? candidate, double fallback) =>
        candidate is { } c && c > 0 ? c : fallback;
}

public record PromoteCaptureRequest(Guid EntityProposalId, PromoteOverrides? Overrides);

public record PromoteOverrides(string? Name, SizeOverride? SizeM);

public record SizeOverride(double? W, double? H, double? D);

public record PromoteResultView(Guid EntityId, Guid GardenId, Guid CaptureId, Guid ProposalId);
