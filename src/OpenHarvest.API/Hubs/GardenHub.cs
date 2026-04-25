using Microsoft.AspNetCore.SignalR;

namespace OpenHarvest.API.Hubs;

/// <summary>
/// One SignalR hub per server, but each garden is its own group. Clients call
/// <see cref="Join"/> with their garden id on connect; server broadcasts entity-mutation
/// events to that group from <see cref="GardenBroadcaster"/>.
/// </summary>
public class GardenHub : Hub
{
    public Task Join(Guid gardenId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupName(gardenId));

    public Task Leave(Guid gardenId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(gardenId));

    public static string GroupName(Guid gardenId) => $"garden:{gardenId:N}";
}

/// <summary>
/// Server-side helper that lets controllers broadcast deltas to a garden group without
/// taking a direct dependency on the SignalR hub context type.
/// </summary>
public class GardenBroadcaster
{
    private readonly IHubContext<GardenHub> _hub;

    public GardenBroadcaster(IHubContext<GardenHub> hub) => _hub = hub;

    public Task EntityUpserted(Guid gardenId, object entity, CancellationToken ct = default) =>
        _hub.Clients.Group(GardenHub.GroupName(gardenId))
            .SendAsync("entityUpserted", entity, ct);

    public Task EntityDeleted(Guid gardenId, Guid entityId, CancellationToken ct = default) =>
        _hub.Clients.Group(GardenHub.GroupName(gardenId))
            .SendAsync("entityDeleted", entityId, ct);

    public Task Nudge(Guid gardenId, object nudge, CancellationToken ct = default) =>
        _hub.Clients.Group(GardenHub.GroupName(gardenId))
            .SendAsync("nudge", nudge, ct);
}
