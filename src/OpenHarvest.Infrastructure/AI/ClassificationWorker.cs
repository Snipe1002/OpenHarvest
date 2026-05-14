using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenHarvest.Domain.Entities;
using OpenHarvest.Domain.Enums;
using OpenHarvest.Domain.Interfaces;
using OpenHarvest.Infrastructure.Data;

namespace OpenHarvest.Infrastructure.AI;

/// <summary>
/// Background worker that drains <see cref="CaptureStatus.Pending"/> captures by sending each
/// photo to the configured vision endpoint and writing zero or more
/// <see cref="ClassificationProposal"/> rows back. v1 polls — a tighter event-driven trigger
/// (signal-on-end-walk) is a v1.5 concern. Polling is cheap because the index on
/// <c>captures(status)</c> is small.
///
/// When the vision endpoint isn't configured the worker marks each pending capture as
/// <see cref="CaptureStatus.ClassificationFailed"/> with a clear error string so the operator
/// can promote captures manually from the staging panel.
/// </summary>
public class ClassificationWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<ClassificationWorker> _log;
    private readonly TimeSpan _idleDelay = TimeSpan.FromSeconds(5);
    private readonly TimeSpan _errorBackoff = TimeSpan.FromSeconds(30);

    public ClassificationWorker(IServiceScopeFactory scopes, ILogger<ClassificationWorker> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("ClassificationWorker started — poll interval {Interval}s", _idleDelay.TotalSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await TickAsync(stoppingToken);
                if (processed == 0)
                {
                    await Task.Delay(_idleDelay, stoppingToken);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "classification tick failed; backing off");
                try { await Task.Delay(_errorBackoff, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private async Task<int> TickAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OpenHarvestDbContext>();
        var vision = scope.ServiceProvider.GetRequiredService<IVisionClient>();
        var photos = scope.ServiceProvider.GetRequiredService<IWalkPhotoStore>();

        // Pull a small batch so a stuck endpoint can't lock the worker forever on one row.
        var pending = await db.Captures
            .Where(c => c.Status == CaptureStatus.Pending)
            .OrderBy(c => c.CapturedUtc)
            .Take(10)
            .ToListAsync(ct);

        if (pending.Count == 0) return 0;

        foreach (var capture in pending)
        {
            await ClassifyOneAsync(db, vision, photos, capture, ct);
        }

        return pending.Count;
    }

    internal static async Task ClassifyOneAsync(
        OpenHarvestDbContext db,
        IVisionClient vision,
        IWalkPhotoStore photos,
        Capture capture,
        CancellationToken ct)
    {
        if (!vision.IsConfigured)
        {
            capture.Status = CaptureStatus.ClassificationFailed;
            capture.ClassificationError = "vision endpoint not configured (set OPENHARVEST_VISION_URL)";
            capture.ClassifiedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return;
        }

        try
        {
            await using var stream = await photos.OpenReadAsync(capture.PhotoObjectKey, ct);
            var contentType = await photos.GetContentTypeAsync(capture.PhotoObjectKey, ct) ?? "application/octet-stream";
            var response = await vision.ClassifyAsync(stream, contentType, hint: null, ct);

            var now = DateTime.UtcNow;
            foreach (var p in response.Entities)
            {
                if (string.IsNullOrWhiteSpace(p.Kind)) continue;
                JsonElement? payload = null;
                if (p.Extra.Count > 0)
                {
                    var doc = JsonDocument.Parse(JsonSerializer.Serialize(p.Extra));
                    payload = doc.RootElement.Clone();
                }
                db.ClassificationProposals.Add(new ClassificationProposal
                {
                    Id = Guid.NewGuid(),
                    CaptureId = capture.Id,
                    YardId = capture.YardId,
                    Kind = p.Kind,
                    Confidence = p.Confidence,
                    Payload = payload,
                    CreatedUtc = now,
                });
            }
            capture.Status = CaptureStatus.Classified;
            capture.ClassifiedUtc = now;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            capture.Status = CaptureStatus.ClassificationFailed;
            capture.ClassificationError = ex.Message;
            capture.ClassifiedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
    }
}
