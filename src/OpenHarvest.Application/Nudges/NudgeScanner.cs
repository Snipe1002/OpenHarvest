using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Domain.Nudges;

namespace OpenHarvest.Application.Nudges;

/// <summary>
/// Stateless scan over a garden's entities. Pulls entities + their CropRef metadata,
/// runs a small set of rules, returns the list of nudges that are currently due.
/// </summary>
public class NudgeScanner
{
    private readonly IGardenRepository _gardens;
    private readonly ICropRepository _crops;

    public NudgeScanner(IGardenRepository gardens, ICropRepository crops)
    {
        _gardens = gardens;
        _crops = crops;
    }

    public async Task<List<Nudge>> ScanAsync(Guid gardenId, DateTime nowUtc, CancellationToken ct = default)
    {
        var entities = await _gardens.GetEntitiesAsync(gardenId, ct);
        var nudges = new List<Nudge>();

        foreach (var e in entities.Where(e => e.Kind == EntityKind.Plant))
        {
            // Watering due
            if (e.Schedule?.LastWateredUtc is { } lastWatered && !string.IsNullOrWhiteSpace(e.CropRef))
            {
                var crop = await _crops.GetBySlugAsync(e.CropRef, ct);
                var interval = WateringInterval(crop);
                if (nowUtc - lastWatered > interval)
                {
                    var hours = (int)(nowUtc - lastWatered).TotalHours;
                    var days = hours / 24;
                    var ago = days >= 1 ? $"{days} day{(days == 1 ? "" : "s")}" : $"{hours} hour{(hours == 1 ? "" : "s")}";
                    nudges.Add(new Nudge(
                        gardenId, e.Id, e.Name,
                        NudgeKind.WateringDue,
                        $"💧 {e.Name} is thirsty — last watered {ago} ago.",
                        nowUtc));
                }
            }

            // Harvest window open
            if (e.Schedule?.ExpectedHarvestStart is { } harvestStart &&
                e.Schedule?.ExpectedHarvestEnd is { } harvestEnd &&
                nowUtc >= harvestStart && nowUtc <= harvestEnd)
            {
                nudges.Add(new Nudge(
                    gardenId, e.Id, e.Name,
                    NudgeKind.HarvestReady,
                    $"🧺 {e.Name} is in its harvest window.",
                    nowUtc));
            }

            // Recent unresolved health event
            if (e.Health?.Events is { Count: > 0 } events)
            {
                var lastDisease = events
                    .Where(ev => ev.Kind == Domain.Components.HealthEventKind.DiseaseSpotted ||
                                 ev.Kind == Domain.Components.HealthEventKind.PestSpotted)
                    .OrderByDescending(ev => ev.Timestamp)
                    .FirstOrDefault();
                var lastResolution = events
                    .Where(ev => ev.Kind == Domain.Components.HealthEventKind.Treated ||
                                 ev.Kind == Domain.Components.HealthEventKind.Recovered)
                    .OrderByDescending(ev => ev.Timestamp)
                    .FirstOrDefault();
                if (lastDisease is not null && (lastResolution is null || lastResolution.Timestamp < lastDisease.Timestamp))
                {
                    nudges.Add(new Nudge(
                        gardenId, e.Id, e.Name,
                        NudgeKind.HealthAlert,
                        $"⚠️ {e.Name}: {lastDisease.Description ?? "unresolved health event"}.",
                        nowUtc));
                }
            }
        }

        return nudges;
    }

    /// <summary>
    /// Heuristic: low-water crops can wait ~5 days, medium 3 days, high 2 days.
    /// </summary>
    private static TimeSpan WateringInterval(Crop? crop)
    {
        if (crop is null) return TimeSpan.FromDays(3);
        // Crop doesn't carry a numeric WaterNeeds yet; this is a placeholder until the
        // OpenFarm sync (Phase 5) populates the column. Defer to spacing as a rough
        // proxy: tighter spacing → smaller plants → more frequent watering.
        if (crop.PlantSpacingInches is { } s)
        {
            if (s < 6) return TimeSpan.FromDays(2);
            if (s < 24) return TimeSpan.FromDays(3);
            return TimeSpan.FromDays(5);
        }
        return TimeSpan.FromDays(3);
    }
}
