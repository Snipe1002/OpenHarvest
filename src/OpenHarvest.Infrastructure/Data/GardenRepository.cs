using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.Data;

public class GardenRepository : IGardenRepository
{
    private readonly OpenHarvestDbContext _db;

    public GardenRepository(OpenHarvestDbContext db) => _db = db;

    public Task<Garden?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        _db.Gardens.AsNoTracking().FirstOrDefaultAsync(g => g.Id == id, ct);

    public async Task<Garden> CreateAsync(Garden garden, CancellationToken ct = default)
    {
        _db.Gardens.Add(garden);
        await _db.SaveChangesAsync(ct);
        return garden;
    }

    public Task<List<GardenEntity>> GetEntitiesAsync(Guid gardenId, CancellationToken ct = default) =>
        _db.Entities
            .AsNoTracking()
            .Where(e => e.GardenId == gardenId)
            .OrderBy(e => e.CreatedUtc)
            .ToListAsync(ct);

    public Task<GardenEntity?> GetEntityAsync(Guid gardenId, Guid entityId, CancellationToken ct = default) =>
        _db.Entities
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.GardenId == gardenId && e.Id == entityId, ct);

    public async Task<GardenEntity> AddEntityAsync(GardenEntity entity, CancellationToken ct = default)
    {
        _db.Entities.Add(entity);
        await _db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task<GardenEntity> UpdateEntityAsync(GardenEntity entity, CancellationToken ct = default)
    {
        _db.Entities.Update(entity);
        await _db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task<bool> DeleteEntityAsync(Guid gardenId, Guid entityId, CancellationToken ct = default)
    {
        var entity = await _db.Entities.FirstOrDefaultAsync(e => e.GardenId == gardenId && e.Id == entityId, ct);
        if (entity is null) return false;
        _db.Entities.Remove(entity);
        await _db.SaveChangesAsync(ct);
        return true;
    }
}
