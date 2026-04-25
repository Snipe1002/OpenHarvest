using Microsoft.AspNetCore.Mvc;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.API.Controllers;

[ApiController]
[Route("api/v1/gardens")]
public class GardensController : ControllerBase
{
    private readonly IGardenRepository _repo;

    public GardensController(IGardenRepository repo) => _repo = repo;

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
}
