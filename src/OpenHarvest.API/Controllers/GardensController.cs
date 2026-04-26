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

    [HttpGet("{id:guid}/entities")]
    public async Task<ActionResult<List<GardenEntity>>> GetEntities(Guid id, CancellationToken ct)
    {
        var entities = await _repo.GetEntitiesAsync(id, ct);
        return Ok(entities);
    }

    [HttpPost("{id:guid}/entities")]
    public async Task<ActionResult<GardenEntity>> AddEntity(
        Guid id,
        [FromBody] CreateEntityRequest req,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var entity = new GardenEntity
        {
            Id = Guid.NewGuid(),
            GardenId = id,
            ParentId = req.ParentId,
            Kind = req.Kind,
            Name = req.Name?.Trim() ?? string.Empty,
            CropRef = string.IsNullOrWhiteSpace(req.CropRef) ? null : req.CropRef.Trim(),
            Transform = req.Transform ?? Transform.Identity,
            Geometry = req.Geometry ?? Geometry.Box(new Vector3(1, 1, 1)),
            CreatedUtc = now,
            ModifiedUtc = now,
        };
        await _repo.AddEntityAsync(entity, ct);
        await _broadcaster.EntityUpserted(id, entity, ct);
        return CreatedAtAction(nameof(GetEntity), new { id, entityId = entity.Id }, entity);
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

public record CreateEntityRequest(
    EntityKind Kind,
    string? Name,
    string? CropRef,
    Guid? ParentId,
    Transform? Transform,
    Geometry? Geometry);

public record UpdateEntityRequest(
    string? Name,
    string? CropRef,
    Guid? ParentId,
    Transform? Transform,
    Geometry? Geometry);
