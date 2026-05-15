using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace OpenHarvest.Infrastructure.AI;

public class VisionClientOptions
{
    /// <summary>
    /// Operator-configured vision-inference endpoint. The vendor / host is intentionally not
    /// pinned: any service that follows the contract documented in the README under "Walk Mode
    /// → Vision endpoint contract" works. Set via <c>OPENHARVEST_VISION_URL</c> env var or
    /// <c>OpenHarvest:VisionUrl</c> config key. If null/empty, the classification worker writes
    /// <see cref="OpenHarvest.Domain.Enums.CaptureStatus.ClassificationFailed"/> for every
    /// capture with a clear "not configured" error string so the staging review panel can show
    /// the message to the operator.
    /// </summary>
    public string? Url { get; set; }

    /// <summary>Optional bearer token if the vision endpoint requires one.</summary>
    public string? AuthToken { get; set; }

    /// <summary>Hard timeout for the initial submit POST. Submit returns quickly (the endpoint
    /// only enqueues), so this can stay short.</summary>
    public int SubmitTimeoutSeconds { get; set; } = 15;

    /// <summary>Maximum total wall time we'll spend polling for a job to complete before giving
    /// up. Vision models on commodity hardware are slow on full-resolution inputs (tens of
    /// seconds is normal), so the default is comfortably bigger than the inline-blocking-call
    /// budget we used to have.</summary>
    public int PollTimeoutSeconds { get; set; } = 60;

    /// <summary>Interval between status polls.</summary>
    public int PollIntervalMilliseconds { get; set; } = 1000;
}

/// <summary>
/// One proposal entry as returned by the vision endpoint. The wire shape is intentionally
/// open: the only required field is <see cref="Kind"/>, the rest are passed through into the
/// proposal's JSON payload so future model versions can add structure without a contract
/// renegotiation.
/// </summary>
public class VisionProposal
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    /// <summary>Free-form extra fields (size_m, plants, color, ...). Kept as a raw element so
    /// callers can serialize the original shape into the proposal row without flattening it.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement> Extra { get; set; } = new();
}

public class VisionResponse
{
    [JsonPropertyName("entities")]
    public List<VisionProposal> Entities { get; set; } = new();

    [JsonPropertyName("detected_at")]
    public DateTime? DetectedAt { get; set; }
}

/// <summary>Wire shape for the 202 ack returned by the submit endpoint.</summary>
internal class VisionSubmitAck
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("job_id")]
    public string? JobId { get; set; }

    [JsonPropertyName("status_url")]
    public string? StatusUrl { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>Wire shape for the poll endpoint.</summary>
internal class VisionStatusEnvelope
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("job_id")]
    public string? JobId { get; set; }

    [JsonPropertyName("elapsed_s")]
    public double? ElapsedSeconds { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("result")]
    public VisionStatusResult? Result { get; set; }
}

internal class VisionStatusResult
{
    [JsonPropertyName("entities")]
    public List<VisionProposal> Entities { get; set; } = new();

    [JsonPropertyName("detected_at")]
    public DateTime? DetectedAt { get; set; }

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("elapsed_s")]
    public double? ElapsedSeconds { get; set; }
}

public interface IVisionClient
{
    bool IsConfigured { get; }

    /// <summary>POST the photo to the configured endpoint. The endpoint follows an async job
    /// pattern: submit returns a job id, then we poll status until done. Throws on transport
    /// / decode / timeout errors; returns a populated <see cref="VisionResponse"/> on success
    /// (which may include zero proposals — that's a valid "I don't see anything" answer, not
    /// an error).</summary>
    Task<VisionResponse> ClassifyAsync(Stream photo, string contentType, string? hint, CancellationToken ct);
}

/// <summary>
/// Thrown when the vision endpoint accepted the job but didn't complete within
/// <see cref="VisionClientOptions.PollTimeoutSeconds"/>. The job may still complete on the
/// server — the caller is responsible for deciding whether to retry, mark the capture
/// <c>ClassificationFailed</c>, or surface a "still processing" state to the operator.
/// </summary>
public class VisionTimeoutException : Exception
{
    public string? JobId { get; }

    public VisionTimeoutException(string message, string? jobId = null) : base(message)
    {
        JobId = jobId;
    }
}

/// <summary>
/// Vision-inference client.
///
/// Wire flow: POST multipart photo to <c>{base}/classify</c> with bearer auth → expect
/// <c>202 Accepted</c> with <c>{job_id, status_url}</c> → GET <c>{base}{status_url}</c> on a
/// fixed interval until <c>status == "done"</c> (success), <c>"failed"</c> (server error), or
/// the local poll budget runs out (<see cref="VisionTimeoutException"/>).
///
/// Rationale for async-first: full-resolution camera uploads can take tens of seconds to
/// classify on commodity GPUs. An inline POST would tie up the HTTP connection (and the
/// classification worker's thread) for that whole window, and any reverse proxy between the
/// API and the vision endpoint could time out the connection mid-flight. The async pattern
/// decouples upload turnaround from inference latency at the cost of two extra GET/s.
/// </summary>
public class VisionClient : IVisionClient
{
    private readonly HttpClient _http;
    private readonly VisionClientOptions _opts;
    private readonly ILogger<VisionClient> _log;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public VisionClient(HttpClient http, IOptions<VisionClientOptions> opts, ILogger<VisionClient> log)
    {
        _http = http;
        _opts = opts.Value;
        _log = log;

        // Per-request timeouts via CancellationTokenSource; we leave HttpClient.Timeout at
        // Infinite so a slow poll cycle doesn't get axed by the underlying handler.
        _http.Timeout = Timeout.InfiniteTimeSpan;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_opts.Url);

    public async Task<VisionResponse> ClassifyAsync(Stream photo, string contentType, string? hint, CancellationToken ct)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("vision endpoint not configured (set OPENHARVEST_VISION_URL)");
        }

        var baseUrl = _opts.Url!.TrimEnd('/');
        var submitUrl = baseUrl + "/classify";

        // ----- Step 1: submit -----
        // Photo stream is passed through as-is; no client-side downscaling. The remote
        // endpoint is responsible for any size handling it needs.
        var ack = await SubmitAsync(submitUrl, photo, contentType, hint, ct);
        if (string.IsNullOrWhiteSpace(ack.JobId))
        {
            throw new InvalidOperationException("vision endpoint accepted the request but returned no job_id");
        }

        var statusPath = string.IsNullOrWhiteSpace(ack.StatusUrl)
            ? $"/vision-status/{ack.JobId}"
            : ack.StatusUrl!;
        var statusUrl = statusPath.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? statusPath
            : baseUrl + (statusPath.StartsWith("/") ? statusPath : "/" + statusPath);

        // ----- Step 2: poll -----
        var pollInterval = TimeSpan.FromMilliseconds(Math.Max(100, _opts.PollIntervalMilliseconds));
        var pollDeadline = DateTime.UtcNow.AddSeconds(Math.Max(1, _opts.PollTimeoutSeconds));
        var attempts = 0;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            if (DateTime.UtcNow >= pollDeadline)
            {
                _log.LogWarning(
                    "vision job {JobId} still {LastStatus} after {Seconds}s — surfacing timeout",
                    ack.JobId, "queued/running", _opts.PollTimeoutSeconds);
                throw new VisionTimeoutException(
                    $"vision job did not complete within {_opts.PollTimeoutSeconds}s",
                    ack.JobId);
            }

            attempts++;
            var status = await PollAsync(statusUrl, ct);
            var verdict = status.Status?.ToLowerInvariant();

            if (verdict == "done")
            {
                if (status.Result is null)
                {
                    throw new InvalidOperationException("vision endpoint reported done but returned no result");
                }
                _log.LogInformation(
                    "vision job {JobId} done after {Attempts} polls, {Elapsed:F1}s inference",
                    ack.JobId, attempts, status.Result.ElapsedSeconds ?? -1);
                return new VisionResponse
                {
                    Entities = status.Result.Entities,
                    DetectedAt = status.Result.DetectedAt,
                };
            }
            if (verdict == "failed")
            {
                throw new HttpRequestException(
                    $"vision endpoint reported job failure: {status.Error ?? "unknown error"}");
            }

            // queued / running / unknown — keep polling.
            await Task.Delay(pollInterval, ct);
        }
    }

    private async Task<VisionSubmitAck> SubmitAsync(
        string url, Stream photo, string contentType, string? hint, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        var photoContent = new StreamContent(photo);
        photoContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
            string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType);
        form.Add(photoContent, "photo", "capture");
        if (!string.IsNullOrWhiteSpace(hint))
        {
            form.Add(new StringContent(hint), "hint");
        }
        // Pin the worker to its garden-tuned system prompt. As of the
        // multi-mode refactor (gpu-worker 2026-05-15) the default mode is
        // `none` — a generic visual-analyst prompt with no domain bias —
        // and OpenHarvest must opt in to garden mode explicitly to keep
        // the constrained `kind` enum (raised_bed | plant | container |
        // structure | unknown) plus `size_m` / `plants` fields. Older
        // gpu-worker builds (pre-multi-mode) ignore unknown form fields,
        // so this is forward-only safe.
        form.Add(new StringContent("garden"), "mode");

        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = form };
        if (!string.IsNullOrWhiteSpace(_opts.AuthToken))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opts.AuthToken);
        }

        using var submitCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        submitCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, _opts.SubmitTimeoutSeconds)));

        HttpResponseMessage res;
        try
        {
            res = await _http.SendAsync(req, submitCts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new HttpRequestException(
                $"vision endpoint submit timed out after {_opts.SubmitTimeoutSeconds}s");
        }

        using (res)
        {
            // 202 is the expected success path; 200 is also accepted in case a future server
            // variant chooses to return success on accept rather than the strictly-correct 202.
            if (res.StatusCode != HttpStatusCode.Accepted && res.StatusCode != HttpStatusCode.OK)
            {
                var body = await res.Content.ReadAsStringAsync(ct);
                throw new HttpRequestException(
                    $"vision endpoint returned {(int)res.StatusCode} on submit: {Truncate(body, 500)}");
            }

            var json = await res.Content.ReadAsStringAsync(ct);
            var ack = JsonSerializer.Deserialize<VisionSubmitAck>(json, JsonOpts)
                ?? throw new InvalidOperationException("vision endpoint returned malformed JSON on submit");
            if (!ack.Ok)
            {
                throw new HttpRequestException(
                    $"vision endpoint rejected submit: {ack.Error ?? "unknown error"}");
            }
            return ack;
        }
    }

    private async Task<VisionStatusEnvelope> PollAsync(string url, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrWhiteSpace(_opts.AuthToken))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opts.AuthToken);
        }

        // Bound an individual poll request so a stuck network doesn't burn the whole poll
        // budget on one GET.
        using var pollCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        pollCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(2, _opts.SubmitTimeoutSeconds)));

        using var res = await _http.SendAsync(req, pollCts.Token);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"vision endpoint returned {(int)res.StatusCode} on poll: {Truncate(body, 300)}");
        }

        var json = await res.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<VisionStatusEnvelope>(json, JsonOpts)
            ?? throw new InvalidOperationException("vision endpoint returned malformed JSON on poll");
    }

    private static string Truncate(string? s, int max) =>
        string.IsNullOrEmpty(s) ? string.Empty :
        s.Length <= max ? s : s.Substring(0, max) + "…";
}
