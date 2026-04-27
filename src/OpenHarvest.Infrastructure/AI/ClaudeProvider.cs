using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenHarvest.Domain.Entities;
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

    public async Task<PlantingCalendar> GeneratePlantingCalendar(
        GardenContext context, IReadOnlyList<Crop> cropCatalog, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return new PlantingCalendar(Name, "(unconfigured)", new List<CalendarEntry>(),
                "AI advisor not configured. Set CLAUDE_API_KEY in the environment to generate a calendar.");
        }

        // Pull just the crops the user is actually growing.
        var refSlugs = context.Plantings
            .Where(p => !string.IsNullOrWhiteSpace(p.CropRef))
            .Select(p => p.CropRef!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToHashSet();
        var relevant = cropCatalog.Where(c => refSlugs.Contains(c.Slug)).ToList();

        if (relevant.Count == 0)
        {
            return new PlantingCalendar(Name, "(skipped)", new List<CalendarEntry>(),
                "No plantings with a CropRef yet — add some plants first, then generate a calendar.");
        }

        var cropSummary = new StringBuilder();
        foreach (var c in relevant)
        {
            cropSummary.Append("- ").Append(c.Slug).Append(": ");
            if (c.DaysToMaturity.HasValue) cropSummary.Append("matures in ").Append(c.DaysToMaturity).Append(" days; ");
            if (c.CanDirectSow) cropSummary.Append("direct-sow OK; ");
            else cropSummary.Append("start indoors; ");
            cropSummary.Append("zones ");
            cropSummary.Append(c.MinGrowingZone?.ToString() ?? "?");
            cropSummary.Append('-');
            cropSummary.Append(c.MaxGrowingZone?.ToString() ?? "?");
            cropSummary.AppendLine();
        }

        var prompt =
            $"Garden context:\n{ContextSummary(context)}\n\n" +
            $"Crop facts (use these — don't invent days-to-maturity):\n{cropSummary}\n" +
            "Produce a 12-month planting calendar from the user's location and frost dates. " +
            "Reply ONLY with a JSON object — no prose, no code fences. Schema:\n" +
            "{ \"summary\": \"one paragraph plain-text overview\", \"entries\": [{ \"date\": \"YYYY-MM-DD\", \"cropName\": \"…\", \"cropRef\": \"slug-or-null\", \"kind\": \"StartIndoors|DirectSow|Transplant|HarvestWindowStart|HarvestWindowEnd|Other\", \"note\": \"…\" } ] }\n" +
            "Sort entries by date ascending. Cover the next 12 months from today. " +
            "Per crop, include sow / transplant / harvest-window-start / harvest-window-end as appropriate.";

        var body = new
        {
            model = _opts.Model,
            max_tokens = 4096,
            system = GardeningSystemPrompt,
            messages = new[]
            {
                new { role = "user", content = prompt }
            }
        };

        var (text, model, _, _) = await CallMessages(body, ct);

        return ParseCalendar(text, model);
    }

    public async Task<PlacementPlan> SuggestPlacements(
        GardenContext context, IReadOnlyList<EntitySummary> existing, IReadOnlyList<Crop> requested, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return new PlacementPlan(Name, "(unconfigured)", new List<PlacementSuggestion>(),
                "AI advisor not configured. Set CLAUDE_API_KEY in the environment.");
        }

        if (requested.Count == 0)
        {
            return new PlacementPlan(Name, "(skipped)", new List<PlacementSuggestion>(),
                "No crops requested.");
        }

        // Phase 5.5 — flatten the scene into a per-entity bullet list. We include kind, position,
        // crop ref, and tags so the planner has enough to reason about containers, walls, and
        // existing plant proximity. Capped at 200 entities to keep the prompt bounded; pathological
        // gardens with more entities will get a (truncated) signal.
        var sceneSummary = new StringBuilder();
        sceneSummary.AppendLine("Existing scene entities (id | kind | name | crop | x,y,z ft | tags):");
        var capped = existing.Take(200);
        foreach (var e in capped)
        {
            sceneSummary
                .Append("- ").Append(e.Id).Append(" | ")
                .Append(string.IsNullOrEmpty(e.Kind) ? "?" : e.Kind).Append(" | ")
                .Append(e.Name).Append(" | ")
                .Append(string.IsNullOrEmpty(e.CropRef) ? "-" : e.CropRef).Append(" | ")
                .Append(e.X.ToString("0.##")).Append(',').Append(e.Y.ToString("0.##")).Append(',').Append(e.Z.ToString("0.##"))
                .Append(" | ");
            if (e.Tags is { Count: > 0 }) sceneSummary.Append(string.Join(",", e.Tags));
            else sceneSummary.Append('-');
            sceneSummary.AppendLine();
        }

        // Phase 5.5 — crop catalog summary. We cherry-pick fields the planner actually needs
        // (zone, spacing, sow window). Crop currently has no SunNeeds/WaterNeeds columns, so we
        // skip those — the planner falls back to general species knowledge from the system prompt.
        var cropFacts = new StringBuilder();
        cropFacts.AppendLine("Crops the user wants placed:");
        foreach (var c in requested)
        {
            cropFacts.Append("- ").Append(c.Slug).Append(" (").Append(c.CommonName).Append(") ");
            if (c.PlantSpacingInches.HasValue) cropFacts.Append("spacing=").Append(c.PlantSpacingInches).Append("in ");
            if (c.RowSpacingInches.HasValue) cropFacts.Append("row=").Append(c.RowSpacingInches).Append("in ");
            if (c.MinGrowingZone.HasValue || c.MaxGrowingZone.HasValue)
                cropFacts.Append("zones=").Append(c.MinGrowingZone?.ToString() ?? "?")
                    .Append('-').Append(c.MaxGrowingZone?.ToString() ?? "?").Append(' ');
            if (c.CanDirectSow) cropFacts.Append("direct-sow ");
            cropFacts.AppendLine();
        }

        var prompt =
            $"Garden context:\n{ContextSummary(context)}\n\n" +
            $"{sceneSummary}\n{cropFacts}\n" +
            "World convention: +X is east, +Z is north, Y is up. Coordinates in feet, world-space. " +
            "Return ONLY a JSON object with this schema:\n" +
            "{ \"summary\": \"one paragraph plain-text overview of your plan\", " +
            "\"suggestions\": [{ \"cropRef\": \"slug\", \"cropName\": \"display name\", " +
            "\"position\": { \"x\": 0.0, \"z\": 0.0 }, \"parentEntityId\": null-or-\"guid\", " +
            "\"rationale\": \"1-2 sentence why\" }] }\n" +
            "When suggesting parentEntityId, only use ids that appear in the existing scene as raised beds, shelves, or other containers — null for in-ground placement. " +
            "Honor crop spacing: do not place plants closer to each other than the crop's PlantSpacingInches. " +
            "Honor sun needs: south-facing positions get more sun; consider walls that block sun. " +
            "Always provide a rationale citing concrete scene features (a specific bed name, a wall, the south side, etc).";

        var body = new
        {
            model = _opts.Model,
            max_tokens = 4096,
            system = GardeningSystemPrompt,
            messages = new[]
            {
                new { role = "user", content = prompt }
            }
        };

        var (text, model, _, _) = await CallMessages(body, ct);
        return ParsePlacementPlan(text, model);
    }

    private PlacementPlan ParsePlacementPlan(string text, string model)
    {
        var s = text.Trim();
        if (s.StartsWith("```"))
        {
            var firstNl = s.IndexOf('\n');
            if (firstNl > 0) s = s[(firstNl + 1)..];
            if (s.EndsWith("```")) s = s[..^3];
            s = s.Trim();
        }
        try
        {
            var doc = JsonNode.Parse(s);
            var summary = doc?["summary"]?.GetValue<string>();
            var suggArr = doc?["suggestions"]?.AsArray();
            var list = new List<PlacementSuggestion>();
            if (suggArr is not null)
            {
                foreach (var n in suggArr)
                {
                    var slug = n?["cropRef"]?.GetValue<string>() ?? "";
                    var nm = n?["cropName"]?.GetValue<string>() ?? slug;
                    var posX = n?["position"]?["x"]?.GetValue<double>() ?? 0;
                    var posZ = n?["position"]?["z"]?.GetValue<double>() ?? 0;
                    // parentEntityId may be JSON null OR an actual string — JsonNode treats null
                    // as a missing node, so the ?. chain returns null in either case. That's fine.
                    var par = n?["parentEntityId"]?.GetValue<string>();
                    var why = n?["rationale"]?.GetValue<string>() ?? "";
                    list.Add(new PlacementSuggestion(slug, nm, new Coord(posX, posZ), par, why));
                }
            }
            return new PlacementPlan(Name, model, list, summary);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "failed to parse placement plan");
            return new PlacementPlan(Name, model, new List<PlacementSuggestion>(), "Couldn't parse AI response. Raw: " + s);
        }
    }

    private PlantingCalendar ParseCalendar(string text, string model)
    {
        // The model occasionally wraps JSON in code fences despite instructions; strip them.
        var s = text.Trim();
        if (s.StartsWith("```"))
        {
            var firstNl = s.IndexOf('\n');
            if (firstNl > 0) s = s[(firstNl + 1)..];
            if (s.EndsWith("```")) s = s[..^3];
            s = s.Trim();
        }

        try
        {
            var doc = JsonNode.Parse(s);
            var summary = doc?["summary"]?.GetValue<string>();
            var entriesNode = doc?["entries"]?.AsArray();
            var entries = new List<CalendarEntry>();
            if (entriesNode is not null)
            {
                foreach (var n in entriesNode)
                {
                    var dateStr = n?["date"]?.GetValue<string>();
                    if (!DateOnly.TryParse(dateStr, out var d)) continue;
                    var cropName = n?["cropName"]?.GetValue<string>() ?? "";
                    var cropRef = n?["cropRef"]?.GetValue<string>();
                    var kindStr = n?["kind"]?.GetValue<string>() ?? "Other";
                    if (!Enum.TryParse<CalendarTaskKind>(kindStr, true, out var kind))
                        kind = CalendarTaskKind.Other;
                    var note = n?["note"]?.GetValue<string>();
                    entries.Add(new CalendarEntry(d, cropName, cropRef, kind, note));
                }
            }
            entries.Sort((a, b) => a.Date.CompareTo(b.Date));
            return new PlantingCalendar(Name, model, entries, summary);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to parse calendar JSON");
            return new PlantingCalendar(Name, model, new List<CalendarEntry>(),
                "Couldn't parse calendar from AI response. Raw: " + s);
        }
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
            {
                // Phase 5.3 — append a tag list when present so the model sees container/light
                // hints alongside the crop name. Format mirrors the bullet style used elsewhere
                // in the context block ("- Tomato (tomato) tags: [raised, south-facing]").
                var crop = p.CropRef is not null ? $" ({p.CropRef})" : "";
                var tags = (p.Tags is { Count: > 0 })
                    ? $" tags: [{string.Join(", ", p.Tags)}]"
                    : "";
                sb.AppendLine($"    - {p.Name}{crop}{tags}");
            }
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
