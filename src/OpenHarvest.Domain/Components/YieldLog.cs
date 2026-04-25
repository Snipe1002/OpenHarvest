namespace OpenHarvest.Domain.Components;

public class YieldLog
{
    public List<HarvestEvent> Harvests { get; set; } = new();
}

public class HarvestEvent
{
    public DateTime Timestamp { get; set; }
    public double? WeightLbs { get; set; }
    public int? Count { get; set; }
    public QualityRating? Quality { get; set; }
    public string? Notes { get; set; }
}

public enum QualityRating
{
    Excellent,
    Good,
    Fair,
    Poor
}
