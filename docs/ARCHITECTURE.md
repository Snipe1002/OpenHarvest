# OpenHarvest — Architecture

> System Design Document v1.0 | March 2026

---

## 1. Vision & Problem Statement

OpenHarvest is a free, open-source platform that uses AI to make growing food accessible to anyone with a patch of soil, a balcony, or even a windowsill. It combines the structured crop knowledge that OpenFarm pioneered with modern AI capabilities to create a living, intelligent gardening companion.

### 1.1 Why This Matters

World hunger is primarily a distribution and knowledge problem, not a production problem. We already grow enough calories globally. What's missing is localized knowledge: people don't know what to grow, when to plant, or how to diagnose problems. OpenHarvest addresses this gap by putting an AI-powered master gardener in everyone's pocket, for free.

### 1.2 Lessons from OpenFarm's Failure

OpenFarm operated for 10 years (2014–2025) as a crowdsourced plant database before shutting down in April 2025. Its failure provides critical design lessons that directly shape OpenHarvest's architecture:

| OpenFarm Problem | OpenHarvest Solution |
|---|---|
| Relied on users writing wiki-style guides | AI generates personalized guidance from structured data |
| Passive reference site with no daily engagement loop | Active planting calendar, reminders, and progress tracking |
| Ruby/Rails + MongoDB stack rotted with no maintainers | Modern .NET 8+ stack, minimal dependencies, containerized |
| No personalization — same content for everyone | Location-aware, season-aware, experience-level-aware AI |
| Static content — no reason to return daily | Living garden dashboard with tasks, alerts, and community feed |
| Required expert contributors to create value | Any user creates value by simply logging what they grow |

---

## 2. High-Level Architecture

```
┌───────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Web App    │  │  Mobile App   │  │  Public API   │  │
│  │  (Blazor/   │  │  (.NET MAUI)  │  │  (REST/      │  │
│  │   React)    │  │              │  │   GraphQL)   │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────────┘
                          │
┌───────────────────────────────────────────────────────┐
│                      API LAYER                          │
│            ASP.NET Core Web API (.NET 8+)               │
│        Controllers • Middleware • Auth • CORS           │
└───────────────────────────────────────────────────────┘
                          │
┌───────────────────────────────────────────────────────┐
│                   SERVICE LAYER                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Garden     │  │  AI Engine    │  │  Community    │  │
│  │  Service    │  │  Service      │  │  Service      │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Calendar   │  │  Weather      │  │  Notification │  │
│  │  Service    │  │  Service      │  │  Service      │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────────┘
                          │
┌───────────────────────────────────────────────────────┐
│                    DATA LAYER                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  PostgreSQL │  │  Redis Cache  │  │  Blob Store   │  │
│  │  (EF Core)  │  │  (sessions/   │  │  (plant       │  │
│  │            │  │   weather)    │  │   images)     │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Backend API | ASP.NET Core 8+ / C# | Cross-platform, high performance, strong typing |
| ORM / Data | Entity Framework Core + PostgreSQL | Code-first migrations, LINQ, open-source DB |
| AI Integration | Pluggable via `IAiProvider` | Swap between Claude, OpenAI, Ollama, or local models |
| Caching | Redis (or in-memory for dev) | Weather data, session state, rate limiting |
| Web Frontend | Blazor WASM or React | Blazor: full C# stack; React: broader contributor base |
| Mobile | .NET MAUI | Single codebase for Android + iOS |
| Image Storage | Local filesystem / S3-compatible | Plant photos, disease images, user uploads |
| Background Jobs | Hangfire or .NET BackgroundService | Scheduled reminders, weather polling, AI batch jobs |
| Auth | ASP.NET Identity + OAuth | Built-in, supports Google/GitHub social login |
| Containerization | Docker + docker-compose | One-command local setup |

---

## 4. Solution Structure (Clean Architecture)

```
OpenHarvest/
├── src/
│   ├── OpenHarvest.Domain/           # Entities, enums, interfaces
│   │   ├── Entities/                 # Crop, Garden, Planting, etc.
│   │   ├── Enums/                    # SunRequirement, WaterLevel, etc.
│   │   └── Interfaces/               # IRepository<T>, IAiProvider
│   │
│   ├── OpenHarvest.Application/       # Use cases, DTOs, validation
│   │   ├── Services/                 # GardenService, CalendarService
│   │   ├── DTOs/                     # Request/response models
│   │   └── Validators/               # FluentValidation rules
│   │
│   ├── OpenHarvest.Infrastructure/    # EF Core, AI providers, external APIs
│   │   ├── Data/                     # DbContext, migrations, seed data
│   │   ├── AI/                       # ClaudeProvider, OllamaProvider
│   │   ├── Weather/                  # OpenWeatherMap integration
│   │   └── Notifications/            # Push, email services
│   │
│   ├── OpenHarvest.API/               # ASP.NET Core Web API
│   │   ├── Controllers/              # REST endpoints
│   │   ├── Middleware/               # Auth, rate limiting, error handling
│   │   └── Program.cs                # DI configuration, pipeline
│   │
│   ├── OpenHarvest.Web/               # Blazor WASM or React frontend
│   └── OpenHarvest.Mobile/            # .NET MAUI mobile app
│
├── tests/
│   ├── OpenHarvest.Domain.Tests/
│   ├── OpenHarvest.Application.Tests/
│   └── OpenHarvest.API.Tests/
│
├── docs/
│   ├── ARCHITECTURE.md               # This document
│   ├── API.md                        # REST API reference
│   ├── DATA_MODEL.md                 # Entity relationships
│   ├── AI_INTEGRATION.md             # AI provider guide
│   ├── GETTING_STARTED.md            # Developer setup
│   └── adr/                          # Architecture Decision Records
│
├── seed-data/                         # Initial crop data (OpenFarm CC0)
├── docker-compose.yml
└── README.md
```

**Dependency Rule:** Domain ← Application ← Infrastructure ← API. No inner layer references an outer layer.

---

## 5. AI Integration Layer

The AI layer is the key differentiator. Rather than requiring humans to write guides, AI generates personalized, context-aware guidance on demand. A provider abstraction prevents vendor lock-in.

### IAiProvider Interface

```csharp
public interface IAiProvider
{
    Task<string> AskGardeningQuestion(
        string question,
        GardenContext context
    );

    Task<DiagnosisResult> DiagnosePlantIssue(
        Stream photo,
        string? userDescription,
        PlantingContext context
    );

    Task<List<CropRecommendation>> RecommendCrops(
        GardenProfile profile
    );

    Task<PlantingCalendar> GeneratePlantingCalendar(
        Garden garden,
        List<Crop> selectedCrops
    );
}
```

### Context-Aware Prompting

Every AI request is enriched with the user's garden context. This transforms a generic AI chatbot into a personalized gardening mentor:

```csharp
public class GardenContext
{
    public int GrowingZone { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime LastFrostDate { get; set; }
    public DateTime FirstFrostDate { get; set; }
    public string CurrentSeason { get; set; }
    public List<ActivePlanting> CurrentPlantings { get; set; }
    public WeatherForecast? RecentWeather { get; set; }
    public ExperienceLevel UserExperience { get; set; }
}
```

### Available Providers

| Provider | Cost | Capability | Use Case |
|---|---|---|---|
| Claude (Anthropic) | Paid API | Vision + text | Production default |
| OpenAI | Paid API | Vision + text | Alternative |
| Ollama | Free (local) | Text only | Development / self-hosted |

---

## 6. Security Considerations

- **Authentication:** JWT bearer tokens, short expiry (15 min), refresh token rotation
- **Authorization:** Resource-based — users can only access their own gardens
- **Rate Limiting:** Per-user AI request limits (prevent API cost abuse)
- **Image Uploads:** Validate MIME type, enforce size limits, store outside webroot
- **AI Prompt Injection:** System prompt hardening, user input sanitization
- **PII:** Lat/lng coordinates treated as sensitive; not returned in public APIs
- **Secrets:** All API keys via environment variables / Azure Key Vault, never committed

---

## 7. Scalability Path

OpenHarvest is designed for a solo developer and small community first, with a clear path to scale:

| Stage | Deployment | Estimated Load |
|---|---|---|
| Development | `docker-compose` on localhost | 1 developer |
| Launch | Single VPS (2 vCPU, 4GB RAM) | ~1,000 users |
| Growth | Managed PostgreSQL + containerized API | ~50,000 users |
| Scale | Kubernetes, read replicas, CDN | 100,000+ users |

The architecture never changes — only the deployment target does.

---

## 8. Competitive Landscape

| | OpenHarvest | OpenFarm | FarmBot | Paid Apps |
|---|---|---|---|---|
| Free | Yes | Yes (defunct) | No ($500–$3000) | No ($5–$15/mo) |
| Open Source | Yes | Yes (archived) | Yes | No |
| AI-powered | Yes | No | No | Partial |
| Food focus | Yes | Yes | Yes | No (houseplants) |
| Community features | Yes | No | No | No |
| Mobile | Planned | No | No | Yes |
| Self-hostable | Yes | Yes | N/A | No |

---

*Architecture document is a living document — major changes should be reflected here and recorded in `docs/adr/`.*
