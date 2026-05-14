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

    /// <summary>Hard timeout per request — vision models can be slow, but we don't want
    /// a stuck request to back up the worker indefinitely.</summary>
    public int TimeoutSeconds { get; set; } = 60;
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

public interface IVisionClient
{
    bool IsConfigured { get; }

    /// <summary>POST the photo to the configured endpoint. Throws on transport / decode errors;
    /// returns a populated <see cref="VisionResponse"/> on success (which may include zero
    /// proposals — that's a valid "I don't see anything" answer, not an error).</summary>
    Task<VisionResponse> ClassifyAsync(Stream photo, string contentType, string? hint, CancellationToken ct);
}

public class VisionClient : IVisionClient
{
    private readonly HttpClient _http;
    private readonly VisionClientOptions _opts;
    private readonly ILogger<VisionClient> _log;

    public VisionClient(HttpClient http, IOptions<VisionClientOptions> opts, ILogger<VisionClient> log)
    {
        _http = http;
        _opts = opts.Value;
        _log = log;
        _http.Timeout = TimeSpan.FromSeconds(Math.Max(1, _opts.TimeoutSeconds));
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_opts.Url);

    public async Task<VisionResponse> ClassifyAsync(Stream photo, string contentType, string? hint, CancellationToken ct)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("vision endpoint not configured (set OPENHARVEST_VISION_URL)");
        }

        var url = _opts.Url!.TrimEnd('/') + "/classify";

        using var form = new MultipartFormDataContent();
        var photoContent = new StreamContent(photo);
        photoContent.Headers.ContentType = MediaTypeHeaderValue.Parse(string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType);
        form.Add(photoContent, "photo", "capture");
        if (!string.IsNullOrWhiteSpace(hint))
        {
            form.Add(new StringContent(hint), "hint");
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = form };
        if (!string.IsNullOrWhiteSpace(_opts.AuthToken))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opts.AuthToken);
        }

        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"vision endpoint returned {(int)res.StatusCode}: {Truncate(body, 500)}");
        }

        var json = await res.Content.ReadAsStringAsync(ct);
        var parsed = JsonSerializer.Deserialize<VisionResponse>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        if (parsed is null)
        {
            throw new InvalidOperationException("vision endpoint returned empty or malformed JSON");
        }
        return parsed;
    }

    private static string Truncate(string? s, int max) =>
        string.IsNullOrEmpty(s) ? string.Empty :
        s.Length <= max ? s : s.Substring(0, max) + "…";
}
