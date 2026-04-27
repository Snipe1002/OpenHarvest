using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OpenHarvest.API.Hubs;
using OpenHarvest.Application.Nudges;
using OpenHarvest.Domain.Components;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Domain.Nudges;

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
    private readonly NudgeScanner _nudges;

    public AdvisorController(
        IAiProvider ai,
        IGardenRepository gardens,
        ICropRepository crops,
        IPhotoStore photos,
        GardenBroadcaster broadcaster,
        NudgeScanner nudges)
    {
        _ai = ai;
        _gardens = gardens;
        _crops = crops;
        _photos = photos;
        _broadcaster = broadcaster;
        _nudges = nudges;
    }

    [HttpGet("status")]
    public ActionResult<object> Status() => Ok(new { configured = _ai.IsConfigured, provider = _ai.Name });

    [HttpGet("nudges/{gardenId:guid}")]
    [EnableRateLimiting("advisor")]
    public async Task<ActionResult<List<Nudge>>> Nudges(Guid gardenId, CancellationToken ct)
    {
        var nudges = await _nudges.ScanAsync(gardenId, DateTime.UtcNow, ct);
        // Best-effort broadcast so other devices on the garden see the same nudges.
        foreach (var n in nudges)
        {
            try { await _broadcaster.Nudge(gardenId, n, ct); } catch { /* ignore */ }
        }
        return Ok(nudges);
    }

    [HttpPost("ask")]
    [EnableRateLimiting("advisor")]
    public async Task<ActionResult<AdvisorAnswer>> Ask([FromBody] AskRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Question)) return BadRequest("missing question");

        var context = await BuildGardenContext(req.GardenId, ct);
        var answer = await _ai.AskGardeningQuestion(req.Question.Trim(), context, ct);
        return Ok(answer);
    }

    [HttpGet("calendar/{gardenId:guid}")]
    [EnableRateLimiting("advisor")]
    public async Task<ActionResult<PlantingCalendar>> Calendar(Guid gardenId, CancellationToken ct)
    {
        var context = await BuildGardenContext(gardenId, ct);
        // Pull only the catalog rows for slugs we're actually growing — keeps the prompt small.
        var slugs = context.Plantings
            .Where(p => !string.IsNullOrWhiteSpace(p.CropRef))
            .Select(p => p.CropRef!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var crops = new List<Domain.Entities.Crop>();
        foreach (var s in slugs)
        {
            var c = await _crops.GetBySlugAsync(s, ct);
            if (c is not null) crops.Add(c);
        }
        var calendar = await _ai.GeneratePlantingCalendar(context, crops, ct);
        return Ok(calendar);
    }

    [HttpPost("plan/{gardenId:guid}")]
    [EnableRateLimiting("advisor")]
    public async Task<ActionResult<PlacementPlan>> Plan(Guid gardenId, [FromBody] PlanRequest req, CancellationToken ct)
    {
        if (req?.Crops is null || req.Crops.Count == 0) return BadRequest("no crops requested");

        var context = await BuildGardenContext(gardenId, ct);
        // Phase 5.5 — pull EVERY entity (beds, walls, shelves, plants...) so the planner can
        // reason about containers and obstructions, not just current plantings.
        var allEntities = await _gardens.GetEntitiesAsync(gardenId, ct);
        var summaries = allEntities.Select(e => new EntitySummary
        {
            Id = e.Id.ToString(),
            Name = e.Name,
            Kind = e.Kind.ToString(),
            CropRef = e.CropRef,
            X = e.Transform.Position.X,
            Y = e.Transform.Position.Y,
            Z = e.Transform.Position.Z,
            // Same parent-tag-merge trick we already use for the calendar/Ask paths so a plant in
            // a tagged raised bed is treated as "raised" even when the bed carries the tag.
            Tags = MergeTagsWithParent(e, allEntities),
        }).ToList();

        // Resolve catalog rows for the requested slugs. Unknown slugs are silently dropped — the
        // planner can still suggest something meaningful as long as at least one slug resolves.
        var crops = new List<Domain.Entities.Crop>();
        foreach (var slug in req.Crops.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(slug)) continue;
            var c = await _crops.GetBySlugAsync(slug, ct);
            if (c is not null) crops.Add(c);
        }

        var plan = await _ai.SuggestPlacements(context, summaries, crops, ct);
        return Ok(plan);
    }

    [HttpPost("diagnose/{gardenId:guid}/{entityId:guid}")]
    [EnableRateLimiting("advisor-vision")]
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
                .Select(e => new EntitySummary
                {
                    Name = e.Name,
                    CropRef = e.CropRef,
                    // Phase 5.3 — surface user tags AND any tags inherited from a parent
                    // container (raised bed, pot, greenhouse). The user expects a plant in a
                    // raised bed to be treated as "raised" even if they only tagged the bed,
                    // and this is the cheapest place to merge that signal in.
                    Tags = MergeTagsWithParent(e, entities),
                })
                .ToList(),
        };
    }

    private static List<string> MergeTagsWithParent(GardenEntity entity, IEnumerable<GardenEntity> all)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ordered = new List<string>();
        void Add(IEnumerable<string>? src)
        {
            if (src is null) return;
            foreach (var t in src)
            {
                if (string.IsNullOrWhiteSpace(t)) continue;
                var trimmed = t.Trim();
                if (seen.Add(trimmed)) ordered.Add(trimmed);
            }
        }
        Add(entity.Tags);
        if (entity.ParentId is { } pid)
        {
            var parent = all.FirstOrDefault(e => e.Id == pid);
            Add(parent?.Tags);
        }
        return ordered;
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

public record PlanRequest(List<string> Crops);
