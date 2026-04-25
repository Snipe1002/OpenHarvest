# OpenHarvest — Architecture

> System Design Document v2.0 | Canvas-first product

---

## 1. Mission

OpenHarvest puts an AI master gardener in everyone's pocket — for free, forever. World hunger is a distribution and knowledge problem, not a production problem. We already grow enough calories globally; what's missing is localized growing knowledge. OpenHarvest closes that gap by combining structured open crop data, modern AI, and a deliberately friendly user experience.

The mission has two audiences in service of one outcome:

- **Casual users** experience a free, beautiful garden designer that needs no account, no install, no forms.
- **Engaged users** discover that the designer was secretly building a precision tracking and advisory platform around their garden — and now an AI master gardener can help them keep it alive and producing.

The decorating is the data model.

---

## 2. Core Principle: Decorating Is the Data Model

Every gesture the casual user makes — placing a bed, dropping a plant, naming it, snapping a photo — produces a structurally complete spatial entity record. There is no separate data-entry mode. Power features layer onto entities the user has already created, by attaching optional components.

This is **ECS philosophy** applied to a garden:

- One entity type (`GardenEntity`).
- Components (PhotoLog, GrowthLog, ScheduleComponent, YieldLog, HealthLog) attached lazily based on engagement depth.
- Component presence determines feature availability — no component, no nag; component present, full advisory available.

Reference points: Notion treats docs as databases; Figma treats drawings as specifications. The interface dissolves into the activity.

See [`DATA_MODEL.md`](DATA_MODEL.md) for the full entity definition.

---

## 3. Layered Architecture

Four concentric layers. Each is invisible until invoked.

```
┌────────────────────────────────────────────────────────────┐
│  LAYER 4 — NETWORK (federation, OpenFarm lookups, sharing) │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  LAYER 3 — ADVISOR (AI master gardener, nudges,      │  │
│  │            diagnosis, schedules, yield estimates)     │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  LAYER 2 — JOURNAL (photos, growth, harvests)  │  │  │
│  │  │  ┌──────────────────────────────────────────┐  │  │  │
│  │  │  │  LAYER 1 — CANVAS (3D drag-and-drop      │  │  │  │
│  │  │  │            garden designer, autosave)    │  │  │  │
│  │  │  └──────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### Layer 1 — Canvas

The 3D garden surface. Drag-and-drop beds, plants, structures, labels. Pinch to tilt between top-down and 3D. WebXR toggle (Quest 3) for walkthroughs. This is what the casual user sees, and the only layer they need.

- Built on **Babylon.js** for the 3D scene
- Autosave on every gesture; no save button, ever
- Aggressive autocomplete from the OpenFarm crop catalog when naming a plant
- Long-press radial menu for `Photo / Move / Rename / Delete`
- WebXR mode for Quest 3 walkthroughs

### Layer 2 — Journal

Opt-in. Tap any entity, snap a photo. Timestamp and position attach automatically. Growth tracking accumulates with **zero data entry** — the user is decorating; the system is building a longitudinal record.

- Camera-capture in-PWA (Quest 3, phones, tablets, desktops)
- Photos stored in MinIO (S3-compatible)
- Worker generates thumbnails and binds to entity's `PhotoLog` component

### Layer 3 — Advisor (the AI master gardener)

Reads layout plus photo and journal history. Surfaces yield estimates, companion-planting flags, watering and care nudges, pest-risk alerts. Surfaces as a soft hint to the casual user ("tomato looks thirsty") or as a full dashboard for the power user.

- Pluggable AI provider interface — Claude, OpenAI, Ollama, others — chosen per deployment
- Inputs: layout graph, photo timeline, weather feed, OpenFarm crop metadata
- Outputs: nudges (single-line hints in canvas), reports (full dashboard), schedule adjustments
- See [`AI_INTEGRATION.md`](AI_INTEGRATION.md) for provider details

### Layer 4 — Network

OpenHarvest federation. OpenFarm crop-data lookups. Shared layouts. Community plant-data contributions. Cross-instance discovery. **Optional, off by default.**

---

## 4. Service Topology

OpenHarvest runs as a long-lived ASP.NET Core service. The same `docker-compose.yml` deploys as a single-host install for self-hosters and as a Swarm stack for the public federated instance — only the `deploy.replicas` blocks differ.

| Service | Role | Stateful? |
|---|---|---|
| `openharvest-api` | ASP.NET Core. REST + SignalR + PWA assets. | No |
| `openharvest-worker` | BackgroundService host. OpenFarm sync, advisor jobs, photo processing. | No |
| `postgres` | Entity store. Pinned to a node with a volume, or external managed instance. | Yes |
| `redis` | SignalR backplane and cache. | Soft (cache only) |
| `minio` | Photo blob store. S3-compatible. | Yes |
| `traefik` | Ingress. TLS termination, sticky WebSocket routing, host-based routing. | No |

### Stateless vs. stateful

API and worker are stateless — scale horizontally with `deploy.replicas`. Postgres and MinIO use `placement.constraints` to pin to specific nodes with attached volumes. Redis can run as a single replica for cache and backplane duty; promote to clustered config only if needed.

### Why API + worker split

Same codebase, different entrypoints. The API process serves user requests synchronously. The worker process runs scheduled jobs (OpenFarm crop-data sync nightly), event-driven jobs (advisor analysis on photo upload), and long-running computation (yield projection across a season). Splitting them lets each scale independently and prevents a slow advisor job from blocking a user gesture.

See [`DEPLOY.md`](DEPLOY.md) for full topology and Compose / Swarm differences.

---

## 5. Solution Structure (Clean Architecture)

```
OpenHarvest/
├── src/
│   ├── OpenHarvest.Domain/           # GardenEntity, components, IAiProvider
│   │   ├── Entities/                 # GardenEntity, EntityKind, Geometry
│   │   ├── Components/               # PhotoLog, GrowthLog, YieldLog, HealthLog
│   │   ├── Enums/                    # EntityKind, SunRequirement, etc.
│   │   └── Interfaces/               # IRepository<T>, IAiProvider, IPhotoStore
│   │
│   ├── OpenHarvest.Application/       # Use cases, commands, DTOs
│   │   ├── Commands/                 # PlaceEntity, AttachPhoto, AskAdvisor
│   │   ├── Queries/                  # GetGarden, GetTimeline
│   │   └── Validators/               # FluentValidation
│   │
│   ├── OpenHarvest.Infrastructure/    # EF Core, MinIO, AI providers, external APIs
│   │   ├── Data/                     # DbContext, JSONB component handling
│   │   ├── AI/                       # ClaudeProvider, OpenAIProvider, OllamaProvider
│   │   ├── Storage/                  # MinioPhotoStore
│   │   ├── OpenFarm/                 # Crop catalog mirror sync
│   │   └── Weather/                  # Weather API integration
│   │
│   ├── OpenHarvest.API/               # ASP.NET Core entrypoint
│   │   ├── Controllers/              # REST endpoints
│   │   ├── Hubs/                     # SignalR GardenHub
│   │   ├── PWA/                      # static PWA assets, service worker
│   │   └── Program.cs                # DI configuration, pipeline
│   │
│   └── OpenHarvest.Worker/            # BackgroundService entrypoint
│       └── Program.cs                # Schedules + event handlers
│
├── tests/
│   ├── OpenHarvest.Domain.Tests/
│   ├── OpenHarvest.Application.Tests/
│   └── OpenHarvest.API.Tests/
│
├── docs/
│   ├── ARCHITECTURE.md               # This document
│   ├── UX.md                         # Casual-user experience (defines Phase 1)
│   ├── DATA_MODEL.md                 # GardenEntity + components
│   ├── DEPLOY.md                     # Compose / Swarm topology
│   ├── API.md                        # REST + SignalR reference
│   ├── AI_INTEGRATION.md             # Advisor layer / provider guide
│   ├── GETTING_STARTED.md            # Developer setup
│   ├── REFERENCES.md                 # Research & prior art
│   └── adr/                          # Architecture Decision Records
│
├── seed-data/                         # OpenFarm CC0 crop catalog
├── docker-compose.yml
└── README.md
```

**Dependency Rule:** Domain ← Application ← Infrastructure ← API/Worker. No inner layer references an outer layer.

---

## 6. Live Sync Model

Two devices on the same garden — wife's phone, husband's tablet — should see each other's edits in real time. Standard SignalR group-per-garden pattern.

- On connect, client joins a SignalR group keyed on `GardenId`.
- Every entity mutation goes through a server command. Server writes to Postgres, then broadcasts the delta to the group.
- Clients apply deltas to their local Babylon scene graph. **No client-authoritative state.**
- Conflict model: last-writer-wins per entity, with a server-stamped `ModifiedUtc`. Granular enough for a garden — concurrent edits to the same plant are vanishingly rare in practice.
- **Offline support:** PWA queues mutations locally, replays on reconnect. Server resolves conflicts by `ModifiedUtc` on replay.

### Known gotchas

- **SignalR backplane is mandatory** the moment API scales past one replica. Without Redis, two phones on different replicas will not see each other's edits — group broadcasts must fan out across nodes.
- **WebSocket sticky routing** through the ingress. Traefik handles this with the appropriate sticky-session config; do not skip it.

---

## 7. AI Integration Layer

The AI layer is the value-prove layer. Rather than requiring humans to write guides, AI generates personalized, context-aware guidance on demand. A provider abstraction prevents vendor lock-in.

### IAiProvider Interface (sketch)

```csharp
public interface IAiProvider
{
    Task<string> AskGardeningQuestion(string question, GardenContext context, CancellationToken ct = default);
    Task<DiagnosisResult> DiagnosePlantIssue(Stream photo, string? userDescription, EntityContext context, CancellationToken ct = default);
    Task<List<CropRecommendation>> RecommendCrops(GardenProfile profile, CancellationToken ct = default);
    Task<PlantingCalendar> GeneratePlantingCalendar(Garden garden, List<Crop> selectedCrops, CancellationToken ct = default);
    Task<List<AdvisorNudge>> ScanForNudges(Garden garden, CancellationToken ct = default);
}
```

### Context-aware prompting

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
    public List<GardenEntity> Plantings { get; set; }   // entities with CropRef set
    public WeatherForecast? RecentWeather { get; set; }
    public ExperienceLevel UserExperience { get; set; }
}
```

### Available providers

| Provider | Cost | Capability | Use case |
|---|---|---|---|
| Claude (Anthropic) | Paid API | Vision + text | Production default |
| OpenAI | Paid API | Vision + text | Alternative |
| Ollama | Free (local) | Text only | Development / self-hosted, no cloud |

See [`AI_INTEGRATION.md`](AI_INTEGRATION.md) for provider implementation details and prompt templates.

---

## 8. Security Considerations

- **Anonymous-first auth.** Casual users have no account. Local-only state is held in PWA storage until they choose to sync. Account upgrade migrates the local entities to the server with a server-issued user id.
- **JWT bearer tokens** once authenticated. Short expiry (15 min), refresh token rotation.
- **Authorization:** resource-based — users can only access their own gardens. Federation grants fine-grained sharing via signed URLs.
- **Rate limiting:** per-user AI request limits to prevent API cost abuse.
- **Image uploads:** validate MIME type, enforce size limits, store in MinIO outside webroot.
- **AI prompt injection:** system-prompt hardening, user-input sanitization, never echo user content directly into tool calls.
- **PII:** lat/lng coordinates treated as sensitive; never returned in public APIs or community feeds at finer than ~10 km precision.
- **Secrets:** all API keys via environment variables / Docker secrets, never committed.

---

## 9. Scalability Path

OpenHarvest is designed for a solo developer and small community first, with a clear path to scale:

| Stage | Deployment | Estimated load |
|---|---|---|
| Development | `docker-compose` on localhost | 1 developer |
| Launch | Single VPS (2 vCPU, 4 GB RAM) | ~1,000 users |
| Growth | Managed Postgres + multi-node Swarm | ~50,000 users |
| Scale | Kubernetes, read replicas, CDN, federated MinIO | 100,000+ users |

The architecture never changes — only the deployment target does.

---

## 10. Competitive Landscape

| | OpenHarvest | OpenFarm | FarmBot | Paid Apps |
|---|---|---|---|---|
| Free | Yes | Yes (defunct) | No ($500–$3000) | No ($5–$15/mo) |
| Open Source | Yes | Yes (archived) | Yes | No |
| AI-powered | Yes | No | No | Partial |
| Food focus | Yes | Yes | Yes | No (houseplants) |
| 3D garden designer | Yes | No | No | No |
| Community features | Yes | No | No | No |
| Mobile | PWA | No | No | Yes (native) |
| Self-hostable | Yes | Yes | N/A | No |

---

*Architecture document is a living document — major changes should be reflected here and recorded in `docs/adr/`.*
