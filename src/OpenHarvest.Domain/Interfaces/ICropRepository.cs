using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Domain.Interfaces;

public interface ICropRepository
{
    Task<List<Crop>> SearchAsync(string query, int limit, CancellationToken ct = default);
    Task<Crop?> GetBySlugAsync(string slug, CancellationToken ct = default);
}
