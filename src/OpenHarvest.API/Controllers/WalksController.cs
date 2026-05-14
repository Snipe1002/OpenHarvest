using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Domain.ValueObjects;
using OpenHarvest.Infrastructure.AI;
using OpenHarvest.Infrastructure.Data;

namespace OpenHarvest.API.Controllers;

/// <summary>
/// Walk-mode v1 controller. Owns the lifecycle of a walk session: start, capture upload,
/// end-with-classification-trigger, review. Captures and proposals live in their own table set
/// because the existing photo pipeline targets per-entity <see cref="GardenEntity"/> rows, not
/// the floating "I haven't decided where this goes yet" staging state walk-mode introduces.
/// </summary>
[ApiController]
[Route("api/v1/walks")]
public class WalksController : ControllerBase
{
    private readonly OpenHarvestDbContext _db;
    private readonly IWalkPhotoStore _photos;
    private readonly ILogger<WalksController> _log;

    public WalksController(OpenHarvestDbContext db, IWalkPhotoStore photos, ILogger<WalksController> log)
    {
        _db = db;
        _photos = photos;
        _log = log;
    }

    /// <summary>
    /// Start a new walk session. Body identifies the target yard; on a single-yard install the
    /// frontend resolves "home" from <c>GET /api/v1/walks/yards</c> and passes that id.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<WalkSessionView>> Start([FromBody] StartWalkRequest req, CancellationToken ct)
    {
        var yard = await _db.Yards.FirstOrDefaultAsync(y => y.Id == req.YardId, ct);
        if (yard is null) return NotFound(new { error = "yard not found" });

        var session = new WalkSession
        {
            Id = Guid.NewGuid(),
            YardId = yard.Id,
            StartedUtc = req.StartedAt ?? DateTime.UtcNow,
            Status = WalkSessionStatus.Active,
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note!.Trim(),
        };
        _db.WalkSessions.Add(session);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetReview), new { id = session.Id }, WalkSessionView.From(session));
    }

    /// <summary>
    /// Upload one capture from the phone — photo bytes + GPS + manual readings + optional note.
    /// The capture lands in <see cref="CaptureStatus.Pending"/>; the classification worker picks
    /// it up on its next tick.
    /// </summary>
    [HttpPost("{id:guid}/captures")]
    [RequestSizeLimit(50_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 50_000_000)]
    public async Task<ActionResult<CaptureView>> AddCapture(
        Guid id,
        [FromForm] AddCaptureForm form,
        CancellationToken ct)
    {
        var session = await _db.WalkSessions.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session is null) return NotFound(new { error = "walk session not found" });
        if (session.Status != WalkSessionStatus.Active)
            return BadRequest(new { error = "walk session is not active" });
        if (form.Photo is null || form.Photo.Length == 0)
            return BadRequest(new { error = "photo file required" });
        if (!IsImage(form.Photo.ContentType))
            return BadRequest(new { error = "photo must be an image" });

        await using var stream = form.Photo.OpenReadStream();
        var key = await _photos.UploadAsync(stream, form.Photo.ContentType ?? "application/octet-stream", ct);

        var readings = ParseManualReadings(form.ManualReadings);

        var capture = new Capture
        {
            Id = Guid.NewGuid(),
            WalkSessionId = session.Id,
            YardId = session.YardId,
            PhotoObjectKey = key,
            CapturedUtc = DateTime.UtcNow,
            GpsLat = form.GpsLat,
            GpsLng = form.GpsLng,
            GpsAccuracyMeters = form.GpsAccuracyM,
            ManualReadings = readings,
            Note = string.IsNullOrWhiteSpace(form.Note) ? null : form.Note!.Trim(),
            Status = CaptureStatus.Pending,
        };
        _db.Captures.Add(capture);
        await _db.SaveChangesAsync(ct);

        var url = await _photos.GetUrlAsync(key, TimeSpan.FromHours(1), ct);
        return Ok(CaptureView.From(capture, url, Array.Empty<ClassificationProposal>()));
    }

    /// <summary>
    /// End the walk session. Marks the session ended; the classification worker is already
    /// polling so we don't need to actively kick it — its next tick (within 5s) will start
    /// draining this session's captures.
    /// </summary>
    [HttpPost("{id:guid}/end")]
    public async Task<ActionResult<WalkSessionView>> End(Guid id, CancellationToken ct)
    {
        var session = await _db.WalkSessions.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session is null) return NotFound(new { error = "walk session not found" });
        if (session.Status == WalkSessionStatus.Active)
        {
            session.Status = WalkSessionStatus.Ended;
            session.EndedUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        return Ok(WalkSessionView.From(session));
    }

    /// <summary>
    /// Review panel data source. Returns the session plus every capture with its current
    /// classification proposals attached. The frontend uses this to show thumbnails + AI
    /// suggestions side-by-side with accept/reject buttons.
    /// </summary>
    [HttpGet("{id:guid}/review")]
    public async Task<ActionResult<WalkReviewView>> GetReview(Guid id, CancellationToken ct)
    {
        var session = await _db.WalkSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session is null) return NotFound(new { error = "walk session not found" });

        var captures = await _db.Captures
            .AsNoTracking()
            .Where(c => c.WalkSessionId == id)
            .OrderBy(c => c.CapturedUtc)
            .ToListAsync(ct);

        var captureIds = captures.Select(c => c.Id).ToList();
        var proposalsByCapture = (await _db.ClassificationProposals
            .AsNoTracking()
            .Where(p => captureIds.Contains(p.CaptureId))
            .ToListAsync(ct))
            .GroupBy(p => p.CaptureId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var captureViews = new List<CaptureView>(captures.Count);
        foreach (var c in captures)
        {
            var url = await _photos.GetUrlAsync(c.PhotoObjectKey, TimeSpan.FromHours(1), ct);
            proposalsByCapture.TryGetValue(c.Id, out var proposals);
            captureViews.Add(CaptureView.From(c, url, proposals ?? new List<ClassificationProposal>()));
        }
        return Ok(new WalkReviewView(WalkSessionView.From(session), captureViews));
    }

    /// <summary>List yards. v1 returns just the default "home" yard, but the endpoint exists
    /// so the multi-property frontend has a stable place to discover them.</summary>
    [HttpGet("yards")]
    public async Task<ActionResult<List<YardView>>> ListYards(CancellationToken ct)
    {
        var yards = await _db.Yards.AsNoTracking().OrderBy(y => y.Slug).ToListAsync(ct);
        return Ok(yards.Select(YardView.From).ToList());
    }

    /// <summary>Serve a walk-mode photo blob. The filesystem store returns a key the browser
    /// fetches back through this route; MinIO-backed installs would return a presigned URL
    /// directly and not hit this route.</summary>
    [HttpGet("photos/{key}")]
    public async Task<IActionResult> GetPhoto(string key, CancellationToken ct)
    {
        try
        {
            var stream = await _photos.OpenReadAsync(key, ct);
            var contentType = await _photos.GetContentTypeAsync(key, ct) ?? "application/octet-stream";
            return File(stream, contentType);
        }
        catch (FileNotFoundException)
        {
            return NotFound();
        }
    }

    private static List<ManualReading> ParseManualReadings(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new List<ManualReading>();
        try
        {
            var parsed = JsonSerializer.Deserialize<List<ManualReading>>(raw, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            return parsed ?? new List<ManualReading>();
        }
        catch (JsonException)
        {
            // Malformed readings should fail soft — a bad JSON blob shouldn't lose the photo.
            return new List<ManualReading>();
        }
    }

    private static bool IsImage(string? ct) =>
        !string.IsNullOrEmpty(ct) && ct.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
}

// ---------------------------------------------------------------------------
// Requests / views
// ---------------------------------------------------------------------------

public record StartWalkRequest(Guid YardId, DateTime? StartedAt, string? Note);

/// <summary>
/// Multipart form for capture upload. Manual readings arrive as a JSON-encoded string field
/// rather than nested form fields so the schema can evolve without renaming form keys.
/// </summary>
public class AddCaptureForm
{
    public IFormFile? Photo { get; set; }
    public double? GpsLat { get; set; }
    public double? GpsLng { get; set; }
    public double? GpsAccuracyM { get; set; }
    public string? ManualReadings { get; set; }
    public string? Note { get; set; }
}

public record YardView(Guid Id, string Slug, string Name, Guid? GardenId, double? CentroidLat, double? CentroidLng)
{
    public static YardView From(Yard y) => new(y.Id, y.Slug, y.Name, y.GardenId, y.CentroidLat, y.CentroidLng);
}

public record WalkSessionView(
    Guid Id,
    Guid YardId,
    DateTime StartedUtc,
    DateTime? EndedUtc,
    string Status,
    string? Note)
{
    public static WalkSessionView From(WalkSession s) =>
        new(s.Id, s.YardId, s.StartedUtc, s.EndedUtc, s.Status.ToString(), s.Note);
}

public record ClassificationProposalView(
    Guid Id,
    Guid CaptureId,
    string Kind,
    double Confidence,
    JsonElement? Payload,
    Guid? PromotedEntityId,
    DateTime CreatedUtc)
{
    public static ClassificationProposalView From(ClassificationProposal p) =>
        new(p.Id, p.CaptureId, p.Kind, p.Confidence, p.Payload, p.PromotedEntityId, p.CreatedUtc);
}

public record CaptureView(
    Guid Id,
    Guid WalkSessionId,
    Guid YardId,
    string PhotoUrl,
    DateTime CapturedUtc,
    double? GpsLat,
    double? GpsLng,
    double? GpsAccuracyMeters,
    List<ManualReading> ManualReadings,
    string? Note,
    string Status,
    string? ClassificationError,
    DateTime? ClassifiedUtc,
    List<ClassificationProposalView> Proposals)
{
    public static CaptureView From(Capture c, string photoUrl, IEnumerable<ClassificationProposal> proposals) =>
        new(c.Id, c.WalkSessionId, c.YardId, photoUrl, c.CapturedUtc, c.GpsLat, c.GpsLng,
            c.GpsAccuracyMeters, c.ManualReadings ?? new List<ManualReading>(), c.Note,
            c.Status.ToString(), c.ClassificationError, c.ClassifiedUtc,
            proposals.Select(ClassificationProposalView.From).ToList());
}

public record WalkReviewView(WalkSessionView Session, List<CaptureView> Captures);
