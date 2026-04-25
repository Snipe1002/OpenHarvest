using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenHarvest.Domain.Interfaces;

namespace OpenHarvest.Infrastructure.AI;

public class ClaudeOptions
{
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "claude-sonnet-4-6";
    public int MaxTokens { get; set; } = 1024;
    public string ApiBase { get; set; } = "https://api.anthropic.com";
    public string AnthropicVersion { get; set; } = "2023-06-01";
}

/// <summary>
/// Anthropic Messages API client. Uses HttpClient directly to avoid SDK lock-in.
/// </summary>
public class ClaudeProvider : IAiProvider
{
    private readonly HttpClient _http;
    private readonly ClaudeOptions _opts;
    private readonly ILogger<ClaudeProvider> _log;

    public ClaudeProvider(HttpClient http, IOptions<ClaudeOptions> opts, ILogger<ClaudeProvider> log)
    {
        _opts = opts.Value;
        _log = log;
        _http = http;
        _http.BaseAddress = new Uri(_opts.ApiBase);
        _http.DefaultRequestHeaders.Add("anthropic-version", _opts.AnthropicVersion);
        if (!string.IsNullOrWhiteSpace(_opts.ApiKey))
        {
            _http.DefaultRequestHeaders.Add("x-api-key", _opts.ApiKey);
        }
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_opts.ApiKey);
    public string Name => "claude";

    private const string GardeningSystemPrompt = """
        You are an experienced organic gardener helping a user with their personal vegetable
        and herb garden. Be friendly, concrete, and concise. When the user has a specific
        zone, frost dates, or current plantings, ground your advice in those. Prefer
        organic / low-input solutions before chemical ones. If you do not know something,
        say so. Avoid disclaimers that the user can already figure out (e.g. "consult a
        local extension service if symptoms persist") unless the situation actually
        warrants it.
        """;

    public async Task<AdvisorAnswer> AskGardeningQuestion(
        string question, GardenContext context, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return new AdvisorAnswer(
                "AI advisor not configured. Set CLAUDE_API_KEY in the environment to enable the master gardener.",
                Name, "(unconfigured)", 0, 0);
        }

        var userText = $"Garden context:\n{ContextSummary(context)}\n\nQuestion: {question}";
        var body = new
        {
            model = _opts.Model,
            max_tokens = _opts.MaxTokens,
            system = GardeningSystemPrompt,
            messages = new[]
            {
                new { role = "user", content = userText }
            }
        };

        var (text, model, input, output) = await CallMessages(body, ct);
        return new AdvisorAnswer(text, Name, model, input, output);
    }

    public async Task<DiagnosisResult> DiagnosePlantIssue(
        Stream photo, string photoMimeType, string? userDescription,
        EntityContext context, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return new DiagnosisResult(
                "AI advisor not configured. Set CLAUDE_API_KEY in the environment to enable diagnosis.",
                null, null, Name, "(unconfigured)");
        }

        // Read photo and base64-encode for the Messages API.
        await using var ms = new MemoryStream();
        await photo.CopyToAsync(ms, ct);
        var b64 = Convert.ToBase64String(ms.ToArray());

        var prompt =
            $"Identify what's wrong with this plant if anything. The user describes it as: " +
            $"{(string.IsNullOrWhiteSpace(userDescription) ? "(no description)" : userDescription)}.\n" +
            $"Plant: {context.EntityName}{(context.CropRef is not null ? $" ({context.CropRef})" : "")}.\n" +
            $"{ContextSummary(context.Garden)}\n\n" +
            "Reply in this exact format on three lines:\n" +
            "DIAGNOSIS: short summary in one sentence.\n" +
            "PROBLEM: a short kebab-case slug for the identified issue, or 'unknown' if not sure.\n" +
            "TREATMENT: one or two sentences of organic-first treatment advice.";

        var body = new
        {
            model = _opts.Model,
            max_tokens = _opts.MaxTokens,
            system = GardeningSystemPrompt,
            messages = new object[]
            {
                new { role = "user", content = new object[]
                    {
                        new { type = "image", source = new { type = "base64", media_type = photoMimeType, data = b64 } },
                        new { type = "text",  text = prompt }
                    }
                }
            }
        };

        var (text, model, _, _) = await CallMessages(body, ct);

        var (diagnosis, problem, treatment) = ParseDiagnosis(text);
        return new DiagnosisResult(diagnosis, problem, treatment, Name, model);
    }

    private async Task<(string text, string model, int input, int output)> CallMessages(object body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/v1/messages")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };

        using var resp = await _http.SendAsync(req, ct);
        var raw = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("Claude error {Status}: {Body}", (int)resp.StatusCode, raw);
            return ($"AI request failed ({(int)resp.StatusCode}). Try again in a moment.", _opts.Model, 0, 0);
        }

        var doc = JsonNode.Parse(raw);
        var content = doc?["content"]?.AsArray();
        var text = string.Empty;
        if (content is not null)
        {
            foreach (var part in content)
            {
                if (part?["type"]?.GetValue<string>() == "text")
                {
                    text += part["text"]?.GetValue<string>() ?? "";
                }
            }
        }
        var model = doc?["model"]?.GetValue<string>() ?? _opts.Model;
        var input = doc?["usage"]?["input_tokens"]?.GetValue<int>() ?? 0;
        var output = doc?["usage"]?["output_tokens"]?.GetValue<int>() ?? 0;
        return (text.Trim(), model, input, output);
    }

    private static string ContextSummary(GardenContext c)
    {
        var sb = new StringBuilder();
        if (c.GrowingZone.HasValue) sb.AppendLine($"  zone: USDA {c.GrowingZone.Value}");
        if (c.Latitude.HasValue && c.Longitude.HasValue) sb.AppendLine($"  location: {c.Latitude.Value:0.##}, {c.Longitude.Value:0.##}");
        if (c.LastFrostDate.HasValue) sb.AppendLine($"  last frost: {c.LastFrostDate.Value:yyyy-MM-dd}");
        if (c.FirstFrostDate.HasValue) sb.AppendLine($"  first frost: {c.FirstFrostDate.Value:yyyy-MM-dd}");
        sb.AppendLine($"  season: {c.CurrentSeason}");
        sb.AppendLine($"  experience: {c.UserExperience}");
        if (c.Plantings.Count > 0)
        {
            sb.AppendLine("  plantings:");
            foreach (var p in c.Plantings.Take(40))
                sb.AppendLine($"    - {p.Name}{(p.CropRef is not null ? $" ({p.CropRef})" : "")}");
        }
        return sb.ToString().TrimEnd();
    }

    private static (string diagnosis, string? problem, string? treatment) ParseDiagnosis(string text)
    {
        string? d = null, p = null, t = null;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimStart('-', '*', ' ').Trim();
            if (line.StartsWith("DIAGNOSIS:", StringComparison.OrdinalIgnoreCase)) d = line["DIAGNOSIS:".Length..].Trim();
            else if (line.StartsWith("PROBLEM:", StringComparison.OrdinalIgnoreCase)) p = line["PROBLEM:".Length..].Trim();
            else if (line.StartsWith("TREATMENT:", StringComparison.OrdinalIgnoreCase)) t = line["TREATMENT:".Length..].Trim();
        }
        if (string.Equals(p, "unknown", StringComparison.OrdinalIgnoreCase)) p = null;
        return (d ?? text, p, t);
    }
}
