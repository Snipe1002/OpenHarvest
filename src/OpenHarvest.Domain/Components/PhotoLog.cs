using OpenHarvest.Domain.ValueObjects;

namespace OpenHarvest.Domain.Components;

public class PhotoLog
{
    public List<PhotoRef> Photos { get; set; } = new();
}

public class PhotoRef
{
    public Guid Id { get; set; }
    public string ObjectKey { get; set; } = string.Empty;     // MinIO key
    public string? ThumbnailKey { get; set; }
    public DateTime TakenUtc { get; set; }
    public Vector3? CapturePosition { get; set; }
    public string? Caption { get; set; }
}
