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

    public Task<List<GardenEntity>> GetEntitiesAsync(Guid gardenId, CancellationToken ct = default) =>
        _db.Entities
            .AsNoTracking()
            .Where(e => e.GardenId == gardenId)
            .OrderBy(e => e.CreatedUtc)
            .ToListAsync(ct);
}
