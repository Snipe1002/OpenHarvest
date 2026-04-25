using Microsoft.AspNetCore.Mvc;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.API.Controllers;

[ApiController]
[Route("api/v1/crops")]
public class CropsController : ControllerBase
{
    private readonly ICropRepository _repo;

    public CropsController(ICropRepository repo) => _repo = repo;

    /// <summary>
    /// Autocomplete search. Used by the canvas when the user types into the Plant rename field.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<Crop>>> Search(
        [FromQuery] string? q,
        [FromQuery] int limit = 10,
        CancellationToken ct = default)
    {
        if (limit is < 1 or > 50) limit = 10;
        var results = await _repo.SearchAsync(q ?? string.Empty, limit, ct);
        return Ok(results);
    }

    [HttpGet("{slug}")]
    public async Task<ActionResult<Crop>> Get(string slug, CancellationToken ct)
    {
        var crop = await _repo.GetBySlugAsync(slug, ct);
        return crop is null ? NotFound() : Ok(crop);
    }
}
