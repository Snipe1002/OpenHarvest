using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.API.Controllers;

/// <summary>
/// Phase 5.4 — CRUD for user-saved single-entity prefab templates ("My Prefabs"). Templates are
/// scoped per garden: list / create / delete are all routed under /api/v1/gardens/{gardenId}.
/// We don't load the parent garden for ownership checks (yet) — the API is anonymous and the
/// gardenId in the URL is treated as the auth claim. When auth lands, a per-user filter will
/// slot in front of <see cref="ICustomPrefabRepository.ListByGardenAsync"/>.
/// </summary>
[ApiController]
[Route("api/v1/gardens/{gardenId:guid}/prefabs")]
public class CustomPrefabsController : ControllerBase
{
    private readonly ICustomPrefabRepository _repo;

    public CustomPrefabsController(ICustomPrefabRepository repo) => _repo = repo;

    [HttpGet]
    public async Task<ActionResult<List<CustomPrefab>>> List(Guid gardenId, CancellationToken ct)
    {
        var items = await _repo.ListByGardenAsync(gardenId, ct);
        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<CustomPrefab>> Create(
        Guid gardenId,
        [FromBody] CreateCustomPrefabRequest req,
        CancellationToken ct)
    {
        if (req is null) return BadRequest("body required");
        var name = (req.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) return BadRequest("name required");
        var entityKind = (req.EntityKind ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(entityKind)) return BadRequest("entityKind required");

        var prefab = new CustomPrefab
        {
            Id = Guid.NewGuid(),
            GardenId = gardenId,
            Name = name,
            // Slug is server-generated from the name. We tack a short id suffix to avoid
            // collisions across templates the user might name identically ("Bed", "Bed").
            Slug = BuildSlug(name),
            Icon = string.IsNullOrWhiteSpace(req.Icon) ? "📦" : req.Icon!.Trim(),
            EntityKind = entityKind,
            CropRef = string.IsNullOrWhiteSpace(req.CropRef) ? null : req.CropRef!.Trim(),
            // Empty / whitespace inputs become safe defaults. The server doesn't try to parse
            // these — that's the client's job — so a malformed body just means a tile that
            // builds a 1×1×1 box, which is the same recovery path as a removed prefabRef.
            GeometryJson = string.IsNullOrWhiteSpace(req.GeometryJson) ? "{}" : req.GeometryJson!,
            TagsJson = string.IsNullOrWhiteSpace(req.TagsJson) ? "[]" : req.TagsJson!,
            CreatedAt = DateTime.UtcNow,
        };
        await _repo.AddAsync(prefab, ct);
        return CreatedAtAction(nameof(List), new { gardenId }, prefab);
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid gardenId, Guid id, CancellationToken ct)
    {
        var existing = await _repo.GetAsync(id, ct);
        if (existing is null || existing.GardenId != gardenId) return NotFound();
        await _repo.DeleteAsync(id, ct);
        return NoContent();
    }

    /// <summary>
    /// Build a kebab-case slug from a display name plus a short hex suffix for uniqueness.
    /// Keeps things URL-friendly even when the user types emoji or punctuation. Length-capped
    /// at 80 so the (gardenId, slug) index entries stay compact.
    /// </summary>
    private static string BuildSlug(string name)
    {
        var sb = new StringBuilder(name.Length);
        var prevDash = false;
        foreach (var ch in name.Normalize(NormalizationForm.FormKD))
        {
            // Filter combining marks introduced by FormKD so accented characters reduce to
            // their base letter rather than being dropped.
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(char.ToLowerInvariant(ch));
                prevDash = false;
            }
            else if (!prevDash && sb.Length > 0)
            {
                sb.Append('-');
                prevDash = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        if (slug.Length == 0) slug = "prefab";
        if (slug.Length > 64) slug = slug[..64].TrimEnd('-');
        // 6 hex chars from a fresh GUID — enough to keep collisions astronomically unlikely
        // without bloating the URL.
        var suffix = Guid.NewGuid().ToString("N")[..6];
        return $"{slug}-{suffix}";
    }
}

public record CreateCustomPrefabRequest(
    string? Name,
    string? Icon,
    string? EntityKind,
    string? CropRef,
    string? GeometryJson,
    string? TagsJson);
