namespace OpenHarvest.Domain.Components;

public class GrowthLog
{
    public List<GrowthEvent> Events { get; set; } = new();
}

public class GrowthEvent
{
    public DateTime Timestamp { get; set; }
    public GrowthStage Stage { get; set; }
    public double? HeightInches { get; set; }
    public int? LeafCount { get; set; }
    public Guid? SourcePhotoId { get; set; }
    public string? Notes { get; set; }
}

public enum GrowthStage
{
    Seed,
    Seedling,
    Vegetative,
    Flowering,
    Fruiting,
    Mature,
    Spent
}
