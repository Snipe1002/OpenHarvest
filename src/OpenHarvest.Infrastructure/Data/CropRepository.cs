using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.Data;

public class CropRepository : ICropRepository
{
    private readonly OpenHarvestDbContext _db;

    public CropRepository(OpenHarvestDbContext db) => _db = db;

    public async Task<List<Crop>> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var trimmed = (query ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return await _db.Crops.AsNoTracking().OrderBy(c => c.CommonName).Take(limit).ToListAsync(ct);

        var pattern = $"%{trimmed}%";
        return await _db.Crops
            .AsNoTracking()
            .Where(c => EF.Functions.ILike(c.CommonName, pattern) || EF.Functions.ILike(c.Slug, pattern))
            .OrderBy(c => c.CommonName)
            .Take(limit)
            .ToListAsync(ct);
    }

    public Task<Crop?> GetBySlugAsync(string slug, CancellationToken ct = default) =>
        _db.Crops.AsNoTracking().FirstOrDefaultAsync(c => c.Slug == slug, ct);
}
