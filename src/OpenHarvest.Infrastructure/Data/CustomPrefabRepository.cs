using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.Data;

public class CustomPrefabRepository : ICustomPrefabRepository
{
    private readonly OpenHarvestDbContext _db;

    public CustomPrefabRepository(OpenHarvestDbContext db) => _db = db;

    public Task<List<CustomPrefab>> ListByGardenAsync(Guid gardenId, CancellationToken ct = default) =>
        _db.CustomPrefabs
            .AsNoTracking()
            .Where(p => p.GardenId == gardenId)
            .OrderBy(p => p.CreatedAt)
            .ToListAsync(ct);

    public Task<CustomPrefab?> GetAsync(Guid id, CancellationToken ct = default) =>
        _db.CustomPrefabs.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<CustomPrefab> AddAsync(CustomPrefab prefab, CancellationToken ct = default)
    {
        _db.CustomPrefabs.Add(prefab);
        await _db.SaveChangesAsync(ct);
        return prefab;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var prefab = await _db.CustomPrefabs.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (prefab is null) return;
        _db.CustomPrefabs.Remove(prefab);
        await _db.SaveChangesAsync(ct);
    }
}
