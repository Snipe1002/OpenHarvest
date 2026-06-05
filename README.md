# OpenHarvest

> **Open-Source AI-Powered Gardening Platform**
> An AI master gardener in your pocket — accessible to anyone with a backyard, a balcony, or just a windowsill.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-8%2B-purple)](https://dotnet.microsoft.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red)](https://github.com/Snipe1002/OpenHarvest)

---

> **v2 is now the canonical frontend.** It lives in [`frontend-v2/`](frontend-v2/README.md) (React 19 + Three.js via R3F + Pascal Editor's `<Viewer>`). The v1 Babylon.js PWA is still in `src/OpenHarvest.API/wwwroot/` but no longer routed in production. See [`docs/v2-architecture.md`](docs/v2-architecture.md) for the architecture and [`docs/deployment.md`](docs/deployment.md) for the runbook.

## What is OpenHarvest?

OpenHarvest is a free, open-source platform that puts an AI master gardener in everyone's pocket — for free, forever. The interaction starts as a simple drag-and-drop garden designer in the browser. As you use it, it quietly becomes a precision tracking and advisory platform that learns from your photos, your harvests, and your local conditions.

It is the **spiritual successor to OpenFarm** (2014–2025), which shut down in April 2025 after a decade of operation. OpenHarvest learns from OpenFarm's failures and rebuilds the concept with:

- **AI-generated, personalized guidance** instead of crowdsourced wiki articles
- **Active engagement loops** (planting calendars, reminders, progress tracking) instead of a passive reference site
- **Modern, containerized .NET 8+ stack** instead of a rotting Ruby/Rails + MongoDB codebase
- **Passive user contribution** — every garden logged makes the platform smarter for everyone

---

## The Mission

World hunger is primarily a **distribution and knowledge problem**, not a production problem. We already grow enough calories globally. What's missing is localized knowledge: people don't know what to grow, when to plant, or how to diagnose problems.

OpenHarvest puts an AI-powered master gardener in everyone's pocket, **for free**.

---

## How It Works — The Layered Experience

OpenHarvest has four layers. Each is invisible until you invoke it. A casual user lives entirely in layers 1 and 2 without ever encountering 3 and 4 — and still produces a complete record of their garden.

| Layer | What you see | Who uses it |
|---|---|---|
| **1 — Canvas** | A 3D garden surface. Drag-and-drop beds, plants, structures, labels. Pinch to tilt between top-down and 3D. | Everyone |
| **2 — Journal** | Tap any plant, snap a photo. Timestamp + position attach automatically. | Anyone curious about progress |
| **3 — Advisor** | AI master gardener: yield estimates, companion-planting flags, watering nudges, pest-risk alerts, photo diagnosis. | Engaged hobbyists & power users |
| **4 — Network** | Federation, OpenFarm crop-data lookups, shared layouts, community contributions. | Self-hosters & community |

**The key design principle:** *the decorating is the data model*. There is no "data entry" mode. Power features layer onto entities the user has already created, by attaching optional components. Notion treats docs as databases; Figma treats drawings as specifications. OpenHarvest treats decoration as instrumentation.

---

## Walk Mode

Walk Mode is a phone-driven capture flow for populating a yard's 3D model from real-world structures. The operator opens `/walk-mode` on their phone, taps **Start Walk**, wanders the yard tapping to capture photos and manually entering analog tool readings (e.g. soil-probe pH, moisture meter %, lux), then taps **End Walk**. Every capture auto-stamps GPS + timestamp. A background classification worker sends each photo to a configurable vision-inference endpoint, parses the response into proposals, and surfaces them in a staging review panel at `/walk-mode/<session_id>/review`. The operator promotes or rejects each proposal; promoted captures become entities in the attached garden.

v1 does **not** auto-place — every promotion is an explicit operator decision. v1 does **not** render proposed entities in the 3D scene yet — that's v2 scope. v1 schema already carries `yard_id` on every row so a multi-property future doesn't need a migration.

### Data model

| Table | Purpose |
|---|---|
| `yards` | Physical properties. Slug-keyed (`home` is the default seed). Optional centroid lat/lng. |
| `walk_sessions` | One row per walk. Statuses: `Active`, `Ended`, `Classified`. |
| `captures` | One row per tap-to-capture. Holds photo storage key, GPS, manual readings (JSONB), status. |
| `classification_proposals` | One row per AI-proposed entity. Confidence + free-form payload (JSONB). |

### Configuration

| Env var / config key | Default | Purpose |
|---|---|---|
| `OPENHARVEST_VISION_URL` / `OpenHarvest:Vision:Url` | unset | Vision-inference endpoint. When unset, captures land in `ClassificationFailed` with a clear message; operators can still promote manually. |
| `OPENHARVEST_VISION_AUTHTOKEN` / `OpenHarvest:Vision:AuthToken` | unset | Optional bearer token. |
| `OPENHARVEST_PHOTO_DIR` / `OpenHarvest:WalkPhoto:Directory` | `data/photos` (relative to API content root) | Filesystem-backed photo blob directory. Photos are content-addressed (sha256), so duplicate uploads dedupe. |
| `OpenHarvest:WalkPhoto:PublicUrlBase` | `/api/v1/walks/photos/` | URL prefix browsers fetch photos back through. Override to front the blobs from a CDN. |

### Vision endpoint contract

The vision-inference service is operator-configured — any HTTP service that follows this contract works. The classification worker uses an **async job pattern**: submit the photo, get a `job_id` back, then poll for the result. This lets the endpoint take arbitrarily long on full-resolution camera uploads without tying up HTTP connections or proxy idle timeouts.

**Submit** — `POST <vision_url>/classify` with `multipart/form-data`:
- `photo` — image bytes (jpeg/png/webp/heic), no client-side downscaling — full camera resolution is fine
- `hint` — optional string, currently unused in v1
- `priority` — optional `"high"` | `"low"` (default `"low"`)

Auth: `Authorization: Bearer <token>` (configured via `OPENHARVEST_VISION_AUTHTOKEN`).

**Submit response** — `202 Accepted`:
```json
{ "ok": true, "job_id": "abc123…", "status_url": "/vision-status/abc123…" }
```

**Poll** — `GET <vision_url><status_url>` (same bearer auth), at any cadence (the client polls every 1s). Replies one of:

```json
{ "ok": true, "status": "queued",  "job_id": "abc123…", "elapsed_s": null }
{ "ok": true, "status": "running", "job_id": "abc123…", "elapsed_s": 4.2 }
{ "ok": true, "status": "done",    "job_id": "abc123…", "elapsed_s": 16.4,
  "result": {
    "entities": [
      {
        "kind": "raised_bed",
        "confidence": 0.85,
        "size_m": { "w": 1.2, "h": 0.3 },
        "plants": ["tomato", "basil"]
      },
      { "kind": "container", "confidence": 0.62 }
    ],
    "detected_at": "2026-05-14T12:34:56Z"
  }
}
{ "ok": true, "status": "failed",  "job_id": "abc123…", "error": "..." }
```

`kind` is required; everything else is optional and passed through into the proposal's JSON payload so future model versions can add fields without renegotiating the contract.

The classification worker waits up to `PollTimeoutSeconds` (default 60s) for a job to reach `done` or `failed`. If the budget is exhausted while the job is still queued/running, the capture is marked `ClassificationFailed` with the message `"vision service is still processing — try again shortly"` so the operator can re-trigger via the staging review panel.

### What's deferred

- **v2** — auto-place + ghost entities in the 3D scene + per-yard confidence threshold
- **v3** — bluetooth/ESP32 probe hardware (re-opens the hardware-tier decision)

See `frontend-v2/src/pages/WalkMode.tsx`, `frontend-v2/src/pages/WalkReview.tsx`, `src/OpenHarvest.API/Controllers/WalksController.cs`, `src/OpenHarvest.API/Controllers/CapturesController.cs`, and `src/OpenHarvest.Infrastructure/AI/ClassificationWorker.cs`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | ASP.NET Core 8+ / C# |
| Database | PostgreSQL + Entity Framework Core (JSONB for component data) |
| Live Sync | SignalR with Redis backplane |
| Caching | Redis |
| AI Integration | Pluggable `IAiProvider` — Claude, OpenAI, or Ollama (self-hosted) |
| Web Frontend (v2, canonical) | Vite + React 19 + TypeScript + Three.js (R3F) + Pascal Editor's `<Viewer>` for buildings — see [`frontend-v2/`](frontend-v2/README.md) |
| Web Frontend (v1, legacy) | PWA (HTML + JS, service worker for offline) + Babylon.js — still embedded in `src/OpenHarvest.API/wwwroot/` but unrouted |
| Photo Storage | MinIO (S3-compatible) — portable to real S3 / Cloudflare R2 |
| Background Jobs | .NET BackgroundService host (worker process) |
| Ingress | Traefik (TLS termination, sticky WebSocket routing) |
| Containerization | Docker Compose (single-host) / Docker Swarm (federated public instance) |

**Why a browser app, not native:** You don't need to install anything. The app opens from a URL. No App Store gate, no platform fragmentation, the same app runs everywhere — phone, tablet, desktop, Quest 3.

**Why React Three Fiber + Pascal Editor's `<Viewer>` (v2):** Pascal already has a polished R3F viewer with good lighting, navigation, and a Zod-validated building schema (walls / doors / windows / slabs). Mounting our garden components as R3F children of `<Viewer>` gives us unified scene + lighting + shadows for free, without forking Pascal's schema. See [`docs/v2-architecture.md`](docs/v2-architecture.md). The legacy Babylon.js v1 was lighter than Cesium at backyard scale and had decent WebXR — those tradeoffs are preserved as fallback.

---

## Quick Start

### Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- An AI API key (Claude, OpenAI) — or run [Ollama](https://ollama.ai/) locally for free

### One-Command Setup

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
docker-compose up
```

The backend API will come up on `http://localhost:5000`. To run the v2 frontend locally, in a separate shell:

```bash
cd frontend-v2
npm install
npm run dev
```

Then open the printed dev URL (defaults to `http://localhost:5174`). The deployed v2 build lives at `https://<your-server>/openharvest/` — see [`docs/deployment.md`](docs/deployment.md) for the runbook.

See [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) for full setup details and AI provider configuration.

---

## Project Structure

```
OpenHarvest/
├── src/
│   ├── OpenHarvest.Domain/           # GardenEntity, components, IAiProvider
│   ├── OpenHarvest.Application/       # Use cases, command handlers
│   ├── OpenHarvest.Infrastructure/    # EF Core, MinIO, AI providers, OpenFarm sync
│   ├── OpenHarvest.API/               # ASP.NET Core REST + SignalR (wwwroot/ holds legacy v1 PWA)
│   └── OpenHarvest.Worker/            # Background jobs: OpenFarm sync, advisor, photo processing
├── frontend-v2/                       # Canonical v2 frontend — Vite + React 19 + R3F + Pascal Viewer
├── tests/
├── docs/                              # Architecture, UX, API, deployment guides (incl. v2-architecture.md, deployment.md)
├── seed-data/                         # OpenFarm CC0 crop database
├── docker-compose.yml
└── README.md
```

---

## Development Roadmap

| Phase | Focus | Demoable result |
|---|---|---|
| **Phase 0** | Skeleton | API + Postgres up, 3D scene with one hard-coded plant (v1 used Babylon; v2 uses R3F + Pascal Viewer) |
| **Phase 1** | Canvas MVP | Drag-and-drop beds + plants, OpenFarm autocomplete, autosave |
| **Phase 2** | Photos & Journal | Camera capture, MinIO storage, photo strip per entity |
| **Phase 3** | Live Sync | Two devices share a garden in real time via SignalR |
| **Phase 4** | Advisor | The AI master gardener: nudges, diagnosis, schedule advice |
| **Phase 5+** | Federation, WebXR, Yield, Plugins | Quest 3 walkthroughs, multi-instance sharing, yield analytics |

See [ROADMAP.md](ROADMAP.md) for full detail and [`docs/UX.md`](docs/UX.md) for the casual-user flow that defines Phase 1.

---

## Why OpenHarvest Succeeds Where Others Failed

**vs. OpenFarm:** OpenFarm was a static wiki requiring experts to write content. OpenHarvest generates personalized AI guidance dynamically. Users contribute data passively just by gardening.

**vs. FarmBot:** FarmBot requires $500–$3000+ of hardware. OpenHarvest needs only a phone or browser. They are complementary — OpenHarvest can serve as FarmBot's new knowledge backend.

**vs. Paid Apps (Gardenly, Planta):** Those are subscription-based, closed-source, and focused on houseplant aesthetics. OpenHarvest is free, open-source, and focused on food production.

---

## The Flywheel

```
More Users → More Decorating → More Spatial Records
    ↑                                    ↓
More Shared Surplus ← Better AI Advice ←─┘
```

Every garden designed adds to the open dataset. Every photo trains the diagnosis layer. Every harvest sharpens the advisor for everyone in your zone. The data stays public. The knowledge compounds.

---

## Contributing

OpenHarvest is actively seeking contributors. Whether you're a .NET developer, a frontend engineer (React / Three.js / R3F for v2; Babylon.js if you want to maintain the legacy v1 PWA), a gardening expert, or someone passionate about food security — there's a place for you here.

Read the [Contributing Guide](CONTRIBUTING.md) to get started.

---

## License

MIT — free to use, modify, and distribute. The crop seed data is licensed CC0 (Public Domain) from OpenFarm.

---

## Links

- [v2 Frontend Architecture](docs/v2-architecture.md) — the compositional bet, data domains, picking contract
- [v2 Deployment Runbook](docs/deployment.md) — Caddy, bind-mount gotchas, rollback
- [Frontend v2 README](frontend-v2/README.md) — local dev + code layout
- [Architecture](docs/ARCHITECTURE.md) — 4-layer system design
- [Data Model](docs/DATA_MODEL.md) — single `GardenEntity` with components
- [UX Flow](docs/UX.md) — the casual-user experience that drives the design
- [Deployment (legacy notes)](docs/DEPLOY.md) — single-host Compose and federated Swarm topologies
- [AI Integration](docs/AI_INTEGRATION.md) — provider-agnostic advisor layer
- [API Reference](docs/API.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [Research & References](docs/REFERENCES.md)

---

*Let's grow something.*
