using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Domain.Interfaces;

public interface IGardenRepository
{
    Task<Garden?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<GardenEntity>> GetEntitiesAsync(Guid gardenId, CancellationToken ct = default);
}
