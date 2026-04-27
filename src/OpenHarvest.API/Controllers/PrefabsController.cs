using Microsoft.AspNetCore.Mvc;

namespace OpenHarvest.API.Controllers;

/// <summary>
/// Phase v2 — data-driven prefab catalog. Serves the contents of
/// <c>Data/prefabs.json</c> verbatim so the frontend can drive the prefab picker,
/// default geometry, and (later) hierarchy / placement / AI off a single source
/// of truth shared with the server. We intentionally stream the raw JSON instead
/// of deserializing through a strongly-typed DTO: the catalog is consumed entry-by-entry
/// by the client and adding a new prefab field shouldn't require a server-side
/// schema bump. The file is added as a Content item in the csproj so it ships
/// alongside the assembly in publish output.
/// </summary>
[ApiController]
[Route("api/v1/prefabs")]
public class PrefabsController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public PrefabsController(IWebHostEnvironment env) => _env = env;

    [HttpGet]
    public IActionResult GetCatalog()
    {
        var path = Path.Combine(_env.ContentRootPath, "Data", "prefabs.json");
        if (!System.IO.File.Exists(path)) return NotFound();
        var raw = System.IO.File.ReadAllText(path);
        return Content(raw, "application/json");
    }
}
