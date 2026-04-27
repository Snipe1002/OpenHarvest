using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Domain.Interfaces;

/// <summary>
/// Phase 5.4 — persistence for user-saved prefab templates. CRUD is intentionally minimal:
/// list-by-garden, get-by-id, add, delete. Update isn't part of v1 (the user's flow is
/// "save a new template" → "delete the old one" rather than in-place edits) and can be added
/// later without changing the existing surface.
/// </summary>
public interface ICustomPrefabRepository
{
    Task<List<CustomPrefab>> ListByGardenAsync(Guid gardenId, CancellationToken ct = default);
    Task<CustomPrefab?> GetAsync(Guid id, CancellationToken ct = default);
    Task<CustomPrefab> AddAsync(CustomPrefab prefab, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
