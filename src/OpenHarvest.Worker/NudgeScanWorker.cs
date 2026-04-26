using System.Net.Http.Json;

namespace OpenHarvest.Worker;

/// <summary>
/// Periodically asks the API to run a nudge scan on every garden. The API broadcasts the
/// nudges over SignalR to any device on each garden's group — so users get watering /
/// harvest / health alerts even when their tab is closed (other devices that DO have the
/// tab open will see them).
///
/// Implementation note: the worker calls the API's existing GET /api/v1/advisor/nudges/{id}
/// endpoint instead of running NudgeScanner locally + broadcasting via a shared SignalR
/// hub. That keeps the Worker decoupled from the SignalR infrastructure (no IHubContext,
/// no Redis backplane wiring on this side) at the cost of a small HTTP round-trip per
/// garden every cycle.
/// </summary>
public class NudgeScanWorker : BackgroundService
{
    private readonly IHttpClientFactory _http;
    private readonly ILogger<NudgeScanWorker> _log;
    private readonly TimeSpan _interval;

    public NudgeScanWorker(IHttpClientFactory http, IConfiguration config, ILogger<NudgeScanWorker> log)
    {
        _http = http;
        _log = log;
        var seconds = config.GetValue("Worker:NudgeScanIntervalSeconds", 300);
        _interval = TimeSpan.FromSeconds(seconds);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Initial delay so the API has time to come up + apply migrations.
        await Task.Delay(TimeSpan.FromSeconds(15), ct);

        while (!ct.IsCancellationRequested)
        {
            try { await RunScanAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "nudge scan cycle failed");
            }

            try { await Task.Delay(_interval, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RunScanAsync(CancellationToken ct)
    {
        var client = _http.CreateClient("api");
        var ids = await client.GetFromJsonAsync<List<Guid>>("/api/v1/gardens/ids", ct);
        if (ids is null || ids.Count == 0)
        {
            _log.LogDebug("no gardens to scan");
            return;
        }

        _log.LogInformation("scanning {Count} gardens for nudges", ids.Count);
        foreach (var id in ids)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var resp = await client.GetAsync($"/api/v1/advisor/nudges/{id}", ct);
                if (!resp.IsSuccessStatusCode)
                    _log.LogWarning("nudge scan for {Id} returned {Status}", id, (int)resp.StatusCode);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "nudge scan for {Id} threw", id);
            }
            // Gentle pacing so we don't melt the API rate-limiter on a big tenant list.
            await Task.Delay(TimeSpan.FromMilliseconds(250), ct);
        }
    }
}
