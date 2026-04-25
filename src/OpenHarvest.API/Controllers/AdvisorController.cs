using Microsoft.AspNetCore.Mvc;
using OpenHarvest.API.Hubs;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.API.Controllers;

[ApiController]
[Route("api/v1/advisor")]
public class AdvisorController : ControllerBase
{
    private readonly IAiProvider _ai;
    private readonly IGardenRepository _gardens;
    private readonly ICropRepository _crops;
    private readonly IPhotoStore _photos;
    private readonly GardenBroadcaster _broadcaster;

    public AdvisorController(
        IAiProvider ai,
        IGardenRepository gardens,
        ICropRepository crops,
        IPhotoStore photos,
        GardenBroadcaster broadcaster)
    {
        _ai = ai;
        _gardens = gardens;
        _crops = crops;
        _photos = photos;
        _broadcaster = broadcaster;
    }

    [HttpGet("status")]
    public ActionResult<object> Status() => Ok(new { configured = _ai.IsConfigured, provider = _ai.Name });

    [HttpPost("ask")]
    public async Task<ActionResult<AdvisorAnswer>> Ask([FromBody] AskRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Question)) return BadRequest("missing question");

        var context = await BuildGardenContext(req.GardenId, ct);
        var answer = await _ai.AskGardeningQuestion(req.Question.Trim(), context, ct);
        return Ok(answer);
    }

    [HttpPost("diagnose/{gardenId:guid}/{entityId:guid}")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<DiagnosisResult>> Diagnose(
        Guid gardenId,
        Guid entityId,
        [FromForm] IFormFile file,
        [FromForm] string? description,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0) return BadRequest("missing file");
        if (!file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ?? true)
            return BadRequest("file must be an image");

        var entity = await _gardens.GetEntityAsync(gardenId, entityId, ct);
        if (entity is null) return NotFound();

        var crop = entity.CropRef is null ? null : await _crops.GetBySlugAsync(entity.CropRef, ct);
        var entityCtx = new EntityContext
        {
            EntityId = entity.Id,
            EntityName = entity.Name,
            CropRef = entity.CropRef,
            Crop = crop,
            Garden = await BuildGardenContext(gardenId, ct),
        };

        // Persist the photo first (so the user has a record), then run diagnosis.
        await using var stream = file.OpenReadStream();
        var key = await _photos.UploadAsync(stream, file.ContentType ?? "application/octet-stream", ct);
        var photoRef = new PhotoRef
        {
            Id = Guid.NewGuid(),
            ObjectKey = key,
            TakenUtc = DateTime.UtcNow,
            Caption = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
        };
        entity.Photos ??= new PhotoLog();
        entity.Photos.Photos.Add(photoRef);

        // Re-open the file for the AI call (we already drained it for upload).
        await using var aiStream = file.OpenReadStream();
        var diagnosis = await _ai.DiagnosePlantIssue(aiStream, file.ContentType ?? "image/jpeg",
            description, entityCtx, ct);

        // Record the result on the entity's HealthLog.
        entity.Health ??= new HealthLog();
        entity.Health.Events.Add(new HealthEvent
        {
            Timestamp = DateTime.UtcNow,
            Kind = HealthEventKind.DiseaseSpotted,
            Description = diagnosis.Diagnosis,
            IdentifiedProblem = diagnosis.IdentifiedProblem,
            TreatmentApplied = diagnosis.Treatment,
            SourcePhotoId = photoRef.Id,
        });
        entity.ModifiedUtc = DateTime.UtcNow;
        await _gardens.UpdateEntityAsync(entity, ct);
        await _broadcaster.EntityUpserted(gardenId, entity, ct);

        return Ok(diagnosis);
    }

    private async Task<GardenContext> BuildGardenContext(Guid gardenId, CancellationToken ct)
    {
        var garden = await _gardens.GetByIdAsync(gardenId, ct);
        var entities = await _gardens.GetEntitiesAsync(gardenId, ct);
        return new GardenContext
        {
            GrowingZone = garden?.GrowingZone,
            Latitude = garden?.Latitude,
            Longitude = garden?.Longitude,
            LastFrostDate = garden?.LastFrostDate,
            FirstFrostDate = garden?.FirstFrostDate,
            CurrentSeason = SeasonOf(DateTime.UtcNow),
            Plantings = entities
                .Where(e => e.Kind == Domain.Enums.EntityKind.Plant)
                .Select(e => new EntitySummary { Name = e.Name, CropRef = e.CropRef })
                .ToList(),
        };
    }

    private static string SeasonOf(DateTime utc)
    {
        var m = utc.Month;
        return m switch
        {
            12 or 1 or 2 => "winter",
            3 or 4 or 5 => "spring",
            6 or 7 or 8 => "summer",
            _ => "fall",
        };
    }
}

public record AskRequest(Guid GardenId, string Question);
