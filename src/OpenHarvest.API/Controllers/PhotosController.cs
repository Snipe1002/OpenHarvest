using Microsoft.AspNetCore.Mvc;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.API.Controllers;

[ApiController]
[Route("api/v1/gardens/{gardenId:guid}/entities/{entityId:guid}/photos")]
public class PhotosController : ControllerBase
{
    private readonly IGardenRepository _gardens;
    private readonly IPhotoStore _photos;

    public PhotosController(IGardenRepository gardens, IPhotoStore photos)
    {
        _gardens = gardens;
        _photos = photos;
    }

    private static readonly TimeSpan PresignedUrlLifetime = TimeSpan.FromHours(1);

    [HttpGet]
    public async Task<ActionResult<List<PhotoView>>> List(Guid gardenId, Guid entityId, CancellationToken ct)
    {
        var entity = await _gardens.GetEntityAsync(gardenId, entityId, ct);
        if (entity is null) return NotFound();
        var photos = entity.Photos?.Photos ?? new List<PhotoRef>();

        var views = new List<PhotoView>(photos.Count);
        foreach (var p in photos.OrderByDescending(p => p.TakenUtc))
        {
            var url = await _photos.GetUrlAsync(p.ObjectKey, PresignedUrlLifetime, ct);
            views.Add(new PhotoView(p.Id, url, p.TakenUtc, p.Caption));
        }
        return Ok(views);
    }

    [HttpPost]
    [RequestSizeLimit(50_000_000)] // 50 MB
    public async Task<ActionResult<PhotoView>> Upload(
        Guid gardenId, Guid entityId, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return BadRequest("missing file");
        if (!IsImage(file.ContentType)) return BadRequest("file must be an image");

        var entity = await _gardens.GetEntityAsync(gardenId, entityId, ct);
        if (entity is null) return NotFound();

        await using var stream = file.OpenReadStream();
        var objectKey = await _photos.UploadAsync(stream, file.ContentType, ct);

        var photo = new PhotoRef
        {
            Id = Guid.NewGuid(),
            ObjectKey = objectKey,
            TakenUtc = DateTime.UtcNow,
        };

        entity.Photos ??= new PhotoLog();
        entity.Photos.Photos.Add(photo);
        entity.ModifiedUtc = DateTime.UtcNow;
        await _gardens.UpdateEntityAsync(entity, ct);

        var url = await _photos.GetUrlAsync(objectKey, PresignedUrlLifetime, ct);
        return Ok(new PhotoView(photo.Id, url, photo.TakenUtc, photo.Caption));
    }

    [HttpDelete("{photoId:guid}")]
    public async Task<ActionResult> Delete(Guid gardenId, Guid entityId, Guid photoId, CancellationToken ct)
    {
        var entity = await _gardens.GetEntityAsync(gardenId, entityId, ct);
        if (entity is null || entity.Photos is null) return NotFound();

        var photo = entity.Photos.Photos.FirstOrDefault(p => p.Id == photoId);
        if (photo is null) return NotFound();

        entity.Photos.Photos.Remove(photo);
        entity.ModifiedUtc = DateTime.UtcNow;
        await _gardens.UpdateEntityAsync(entity, ct);

        try { await _photos.DeleteAsync(photo.ObjectKey, ct); }
        catch { /* best effort — orphaned blob is acceptable */ }

        return NoContent();
    }

    private static bool IsImage(string? contentType) =>
        !string.IsNullOrEmpty(contentType) &&
        (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase));
}

public record PhotoView(Guid Id, string Url, DateTime TakenUtc, string? Caption);
