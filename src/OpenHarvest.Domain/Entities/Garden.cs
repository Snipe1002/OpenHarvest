namespace OpenHarvest.Domain.Entities;

public class Garden
{
    public Guid Id { get; set; }
    public Guid? OwnerUserId { get; set; }   // null for anonymous local-only gardens
    public string Name { get; set; } = string.Empty;
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public int? GrowingZone { get; set; }
    public DateTime? LastFrostDate { get; set; }
    public DateTime? FirstFrostDate { get; set; }
    public DateTime CreatedAt { get; set; }
}
