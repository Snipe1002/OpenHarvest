using Microsoft.AspNetCore.Mvc;
using OpenHarvest.API.Hubs;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.API.Controllers;

[ApiController]
[Route("api/v1/gardens")]
public class GardensController : ControllerBase
{
    private readonly IGardenRepository _repo;
    private readonly GardenBroadcaster _broadcaster;

    public GardensController(IGardenRepository repo, GardenBroadcaster broadcaster)
    {
        _repo = repo;
        _broadcaster = broadcaster;
    }

    [HttpPost]
    public async Task<ActionResult<Garden>> Create([FromBody] CreateGardenRequest req, CancellationToken ct)
    {
        var garden = new Garden
        {
            Id = Guid.NewGuid(),
            Name = string.IsNullOrWhiteSpace(req.Name) ? "My Garden" : req.Name.Trim(),
            CreatedAt = DateTime.UtcNow,
        };
        await _repo.CreateAsync(garden, ct);
        return CreatedAtAction(nameof(Get), new { id = garden.Id }, garden);
    }

    [HttpGet("ids")]
    public async Task<ActionResult<List<Guid>>> ListIds(CancellationToken ct)
    {
        var ids = await _repo.ListGardenIdsAsync(ct);
        return Ok(ids);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<Garden>> Get(Guid id, CancellationToken ct)
    {
        var garden = await _repo.GetByIdAsync(id, ct);
        return garden is null ? NotFound() : Ok(garden);
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<Garden>> UpdateGarden(
        Guid id,
        [FromBody] UpdateGardenRequest req,
        CancellationToken ct)
    {
        var garden = await _repo.GetByIdAsync(id, ct);
        if (garden is null) return NotFound();

        if (req.Name is not null) garden.Name = req.Name.Trim();
        if (req.Latitude.HasValue) garden.Latitude = req.Latitude;
        if (req.Longitude.HasValue) garden.Longitude = req.Longitude;
        if (req.GrowingZone.HasValue) garden.GrowingZone = req.GrowingZone;

        await _repo.UpdateAsync(garden, ct);
        return Ok(garden);
    }

    [HttpGet("{id:guid}/entities")]
    public async Task<ActionResult<List<GardenEntity>>> GetEntities(Guid id, CancellationToken ct)
    {
        var entities = await _repo.GetEntitiesAsync(id, ct);
        return Ok(entities);
    }

    // Phase 5.3 — auto-tag map for prefab placements. When a user drops a prefab from the
    // picker, the body's geometry.kind is "Prefab" and geometry.prefabRef carries the slug.
    // This map seeds the entity's tags so AI guidance immediately reflects the structure type
    // ("raised", "container", "greenhouse") without forcing the user into the tag editor.
    // Anything not in the map gets an empty seed; the user can still hand-tag via the toolbar.
    private static readonly IReadOnlyDictionary<string, string[]> PrefabAutoTags =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["raised-bed-wood"]  = new[] { "raised" },
            ["square-planter"]   = new[] { "container" },
            ["terracotta-pot"]   = new[] { "container" },
            ["greenhouse-arch"]  = new[] { "greenhouse" },
        };

    [HttpPost("{id:guid}/entities")]
    public async Task<ActionResult<GardenEntity>> AddEntity(
        Guid id,
        [FromBody] CreateEntityRequest req,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var geometry = req.Geometry ?? Geometry.Box(new Vector3(1, 1, 1));

        // Merge auto-tags-from-prefab with whatever the client supplied. Client tags win on
        // duplicates (case-insensitive) so an explicit tag set isn't silently doubled by the
        // auto-seed. Result is normalized: trimmed, non-empty, deduped.
        var tags = NormalizeTags(req.Tags);
        if (geometry is { Kind: GeometryKind.Prefab, PrefabRef: { } slug }
            && PrefabAutoTags.TryGetValue(slug, out var auto))
        {
            tags = MergeTags(tags, auto);
        }

        var entity = new GardenEntity
        {
            Id = Guid.NewGuid(),
            GardenId = id,
            ParentId = req.ParentId,
            Kind = req.Kind,
            Name = req.Name?.Trim() ?? string.Empty,
            CropRef = string.IsNullOrWhiteSpace(req.CropRef) ? null : req.CropRef.Trim(),
            Transform = req.Transform ?? Transform.Identity,
            Geometry = geometry,
            Tags = tags,
            CreatedUtc = now,
            ModifiedUtc = now,
        };
        await _repo.AddEntityAsync(entity, ct);
        await _broadcaster.EntityUpserted(id, entity, ct);
        return CreatedAtAction(nameof(GetEntity), new { id, entityId = entity.Id }, entity);
    }

    private static string[] NormalizeTags(string[]? tags)
    {
        if (tags is null || tags.Length == 0) return Array.Empty<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ordered = new List<string>(tags.Length);
        foreach (var raw in tags)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var t = raw.Trim();
            if (seen.Add(t)) ordered.Add(t);
        }
        return ordered.ToArray();
    }

    private static string[] MergeTags(string[] primary, string[] secondary)
    {
        var seen = new HashSet<string>(primary, StringComparer.OrdinalIgnoreCase);
        var ordered = new List<string>(primary);
        foreach (var t in secondary)
        {
            if (string.IsNullOrWhiteSpace(t)) continue;
            var trimmed = t.Trim();
            if (seen.Add(trimmed)) ordered.Add(trimmed);
        }
        return ordered.ToArray();
    }

    [HttpGet("{id:guid}/entities/{entityId:guid}")]
    public async Task<ActionResult<GardenEntity>> GetEntity(Guid id, Guid entityId, CancellationToken ct)
    {
        var entity = await _repo.GetEntityAsync(id, entityId, ct);
        return entity is null ? NotFound() : Ok(entity);
    }

    [HttpPatch("{id:guid}/entities/{entityId:guid}")]
    public async Task<ActionResult<GardenEntity>> UpdateEntity(
        Guid id,
        Guid entityId,
        [FromBody] UpdateEntityRequest req,
        CancellationToken ct)
    {
        var entity = await _repo.GetEntityAsync(id, entityId, ct);
        if (entity is null) return NotFound();

        if (req.Name is not null) entity.Name = req.Name.Trim();
        if (req.CropRef is not null) entity.CropRef = string.IsNullOrWhiteSpace(req.CropRef) ? null : req.CropRef.Trim();
        if (req.Transform is not null) entity.Transform = req.Transform;
        if (req.Geometry is not null) entity.Geometry = req.Geometry;
        if (req.ParentId.HasValue) entity.ParentId = req.ParentId.Value == Guid.Empty ? null : req.ParentId.Value;
        // Phase 5.3 — only touch tags when the caller actually sent the field. Sending an empty
        // array IS meaningful (the user cleared all tags), so we treat null vs [] differently.
        if (req.Tags is not null) entity.Tags = NormalizeTags(req.Tags);

        entity.ModifiedUtc = DateTime.UtcNow;
        await _repo.UpdateEntityAsync(entity, ct);
        await _broadcaster.EntityUpserted(id, entity, ct);
        return Ok(entity);
    }

    [HttpDelete("{id:guid}/entities/{entityId:guid}")]
    public async Task<ActionResult> DeleteEntity(Guid id, Guid entityId, CancellationToken ct)
    {
        var ok = await _repo.DeleteEntityAsync(id, entityId, ct);
        if (!ok) return NotFound();
        await _broadcaster.EntityDeleted(id, entityId, ct);
        return NoContent();
    }
}

public record CreateGardenRequest(string? Name);

public record UpdateGardenRequest(
    string? Name,
    double? Latitude,
    double? Longitude,
    int? GrowingZone);

public record CreateEntityRequest(
    EntityKind Kind,
    string? Name,
    string? CropRef,
    Guid? ParentId,
    Transform? Transform,
    Geometry? Geometry,
    string[]? Tags);

public record UpdateEntityRequest(
    string? Name,
    string? CropRef,
    Guid? ParentId,
    Transform? Transform,
    Geometry? Geometry,
    string[]? Tags);
