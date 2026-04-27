using OpenHarvest.Domain.Entities;

namespace OpenHarvest.Domain.Interfaces;

public interface IGardenRepository
{
    Task<Garden?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Garden> CreateAsync(Garden garden, CancellationToken ct = default);
    Task<Garden> UpdateAsync(Garden garden, CancellationToken ct = default);
    Task<List<Guid>> ListGardenIdsAsync(CancellationToken ct = default);

    Task<List<GardenEntity>> GetEntitiesAsync(Guid gardenId, CancellationToken ct = default);
    Task<GardenEntity?> GetEntityAsync(Guid gardenId, Guid entityId, CancellationToken ct = default);
    Task<GardenEntity> AddEntityAsync(GardenEntity entity, CancellationToken ct = default);
    Task<GardenEntity> UpdateEntityAsync(GardenEntity entity, CancellationToken ct = default);
    Task<bool> DeleteEntityAsync(Guid gardenId, Guid entityId, CancellationToken ct = default);
}
