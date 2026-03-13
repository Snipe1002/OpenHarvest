# OpenHarvest — AI Integration Guide

> OpenHarvest's AI layer is designed to be provider-agnostic. You can run the full platform with Claude (Anthropic), OpenAI, or a locally-hosted Ollama model. This document explains the design and how to add or switch providers.

---

## Design Philosophy

The core principle: **AI is a layer, not a dependency.**

- The system should degrade gracefully if no AI provider is configured
- No service should call Claude or OpenAI SDK directly — all calls go through `IAiProvider`
- Context is always passed explicitly — the AI never responds without knowing who the user is and what they're growing
- Every AI request/response pair is logged (PII-stripped) for debugging and quality improvement

---

## IAiProvider Interface

All AI functionality is exposed through a single interface defined in `OpenHarvest.Domain`:

```csharp
namespace OpenHarvest.Domain.Interfaces;

public interface IAiProvider
{
    /// <summary>
    /// Answer a natural-language gardening question with full garden context.
    /// </summary>
    Task<string> AskGardeningQuestion(
        string question,
        GardenContext context,
        CancellationToken ct = default
    );

    /// <summary>
    /// Diagnose a plant problem from a photo and optional description.
    /// </summary>
    Task<DiagnosisResult> DiagnosePlantIssue(
        Stream photo,
        string? userDescription,
        PlantingContext context,
        CancellationToken ct = default
    );

    /// <summary>
    /// Recommend crops based on the user's garden profile and constraints.
    /// </summary>
    Task<List<CropRecommendation>> RecommendCrops(
        GardenProfile profile,
        CancellationToken ct = default
    );

    /// <summary>
    /// Generate a full-season planting calendar for a garden.
    /// </summary>
    Task<PlantingCalendar> GeneratePlantingCalendar(
        Garden garden,
        List<Crop> selectedCrops,
        CancellationToken ct = default
    );
}
```

---

## Context Objects

### GardenContext

Passed to every AI request to ensure responses are personalized:

```csharp
public class GardenContext
{
    public int GrowingZone { get; set; }          // USDA zone 3–13
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime LastFrostDate { get; set; }
    public DateTime FirstFrostDate { get; set; }
    public string CurrentSeason { get; set; }     // "Early Spring", "Midsummer", etc.
    public List<ActivePlanting> CurrentPlantings { get; set; }
    public WeatherForecast? RecentWeather { get; set; }
    public ExperienceLevel UserExperience { get; set; }
}
```

### PlantingContext

Extended context for plant diagnosis:

```csharp
public class PlantingContext : GardenContext
{
    public string CropCommonName { get; set; }
    public int DaysSincePlanting { get; set; }
    public PlantingMethod Method { get; set; }
    public SoilType SoilType { get; set; }
    public SunExposure SunExposure { get; set; }
    public List<string> RecentLogTypes { get; set; } // e.g., "Watered 3 days ago"
}
```

---

## Available Providers

### 1. Claude (Anthropic) — Default

**Best for:** Production use. Supports vision (photo diagnosis), strong horticultural reasoning, nuanced context-aware responses.

**Configuration (`appsettings.json`):**
```json
{
  "AI": {
    "Provider": "claude",
    "Claude": {
      "ApiKey": "your-api-key",
      "Model": "claude-opus-4-6",
      "MaxTokens": 1024
    }
  }
}
```

**Registration:**
```csharp
// In Program.cs
builder.Services.AddScoped<IAiProvider, ClaudeAiProvider>();
```

### 2. OpenAI

**Best for:** Alternative production provider. GPT-4o supports vision.

**Configuration:**
```json
{
  "AI": {
    "Provider": "openai",
    "OpenAI": {
      "ApiKey": "your-api-key",
      "Model": "gpt-4o"
    }
  }
}
```

### 3. Ollama (Self-Hosted, Free)

**Best for:** Development, privacy-focused deployments, or areas with limited internet. Vision support requires a multimodal model (e.g., `llava`).

**Setup:**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model (text-only)
ollama pull llama3

# Pull a vision model (for diagnosis)
ollama pull llava
```

**Configuration:**
```json
{
  "AI": {
    "Provider": "ollama",
    "Ollama": {
      "BaseUrl": "http://localhost:11434",
      "TextModel": "llama3",
      "VisionModel": "llava"
    }
  }
}
```

---

## Prompt Engineering

### System Prompt Template

Every request prepends a system prompt that establishes the AI's role and constraints:

```
You are OpenHarvest, an AI gardening assistant focused on food production.

User context:
- USDA Growing Zone: {zone}
- Location: {lat}, {lng}
- Last frost date: {lastFrost}
- First frost date: {firstFrost}
- Current season: {season}
- Experience level: {experience}
- Currently growing: {plantingsSummary}
- Recent weather: {weatherSummary}

Guidelines:
- Always give zone-specific and season-specific advice
- Prefer organic methods; mention chemical options only when asked
- If unsure, say so — recommend consulting local extension services
- Keep responses practical and actionable, not encyclopedic
- Reference the user's specific plantings when relevant
```

### Prompt Injection Defense

User input is sanitized before being included in prompts:
- Input is treated as a `user` role message, never injected into the system prompt
- Length limits enforced (max 2,000 characters per question)
- Known injection patterns filtered at the API middleware layer

---

## Adding a New Provider

1. Create a class in `OpenHarvest.Infrastructure/AI/`:

```csharp
public class MyCustomAiProvider : IAiProvider
{
    public async Task<string> AskGardeningQuestion(
        string question, GardenContext context, CancellationToken ct)
    {
        // Build prompt, call your provider, return response
    }

    // Implement remaining interface methods...
}
```

2. Register it in DI based on configuration:

```csharp
// In Program.cs or an extension method
var providerName = builder.Configuration["AI:Provider"];
builder.Services.AddScoped<IAiProvider>(sp => providerName switch
{
    "claude"  => sp.GetRequiredService<ClaudeAiProvider>(),
    "openai"  => sp.GetRequiredService<OpenAiProvider>(),
    "ollama"  => sp.GetRequiredService<OllamaProvider>(),
    "custom"  => sp.GetRequiredService<MyCustomAiProvider>(),
    _         => throw new InvalidOperationException($"Unknown AI provider: {providerName}")
});
```

---

## Rate Limiting & Cost Control

AI API calls are the primary operational cost. The following controls are enforced:

| Limit | Value | Rationale |
|---|---|---|
| Questions per user per day | 20 | Prevent abuse |
| Diagnoses per user per day | 5 | Vision calls are expensive |
| Max prompt length | 2,000 chars | Token cost control |
| Max response tokens | 1,024 | Keep answers focused |
| Cache TTL for identical questions | 24 hours | Common questions cached in Redis |

---

## Quality Feedback Loop

Every AI response can be rated by the user (helpful / not helpful). This data is:

1. Stored on the `DiagnosisRequest` entity
2. Used to identify systematically poor responses
3. Used to refine system prompts over time
4. Never used to train the AI provider's model (per Anthropic/OpenAI TOS)

---

*See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and [API.md](API.md) for endpoint details.*
