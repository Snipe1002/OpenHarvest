namespace OpenHarvest.Domain.Components;

public class ScheduleComponent
{
    public DateTime? SowDate { get; set; }
    public DateTime? TransplantDate { get; set; }
    public DateTime? ExpectedHarvestStart { get; set; }
    public DateTime? ExpectedHarvestEnd { get; set; }
    public DateTime? LastWateredUtc { get; set; }
    public DateTime? LastFertilizedUtc { get; set; }
    public List<ScheduledTask> UpcomingTasks { get; set; } = new();
}

public class ScheduledTask
{
    public Guid Id { get; set; }
    public TaskKind Kind { get; set; }
    public DateTime DueUtc { get; set; }
    public string? Note { get; set; }
    public bool Completed { get; set; }
}

public enum TaskKind
{
    Water,
    Fertilize,
    Prune,
    ThinSeedlings,
    Harvest,
    Inspect
}
