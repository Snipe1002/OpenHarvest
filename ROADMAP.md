# OpenHarvest Development Roadmap

> **Walking-skeleton-first.** Each phase produces a runnable, demoable thing. No phase depends on hardware, funding, or a large team. A solo developer can ship Phase 0+1 in weeks.

---

## Phase 0 — Skeleton

**Goal:** End-to-end pipeline alive: API serves an entity, browser draws it.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| ASP.NET Core 8 solution structure (Clean Architecture) | Critical | Low | Planned |
| EF Core + Postgres `GardenEntity` table with JSONB components | Critical | Medium | Planned |
| Health endpoint + smoke tests | Critical | Low | Planned |
| Babylon.js scene loaded in PWA shell | Critical | Medium | Planned |
| Single hard-coded entity rendered from API → browser | Critical | Low | Planned |
| `docker-compose.yml` with `api` + `postgres` only | Critical | Low | Planned |
| GitHub repo + README + MIT license | High | Low | Done |
| CONTRIBUTING.md + issue templates | High | Low | Done |

**Milestone:** `docker compose up`, open the URL, see a Babylon scene with one tomato pin loaded from the API. This is the spike that proves the architecture.

---

## Phase 1 — Canvas MVP

**Goal:** A casual user can design a garden in a browser. No login. No forms. Four buttons.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| Four-button bottom bar (Bed, Plant, Structure, Label) | Critical | Medium | Planned |
| Place Bed — drag rectangle on ground | Critical | Medium | Planned |
| Place Plant — tap location, type name | Critical | Medium | Planned |
| OpenFarm autocomplete wired to local crop-data mirror | Critical | Medium | Planned |
| `CropRef` binding silently on autocomplete pick | Critical | Low | Planned |
| Long-press radial menu — Move, Rename, Delete | Critical | Medium | Planned |
| Autosave on every gesture (no save button) | Critical | Low | Planned |
| Local-only PWA storage (no account required) | Critical | Medium | Planned |
| Responsive layout — phone, tablet, desktop | High | Medium | Planned |
| Entity hierarchy enforcement (plant inside bed) | High | Low | Planned |
| `seed-data/` — initial OpenFarm CC0 crop catalog import script | High | Medium | Planned |

**Milestone:** A publicly accessible URL where anyone can design a garden in 30 seconds without making an account. Press a phone home button, come back later, the garden is still there.

---

## Phase 2 — Photos & Journal

**Goal:** The user starts decorating with photos. Behind the scenes, growth tracking accumulates.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| MinIO container + volume + .NET S3 client wiring | Critical | Medium | Planned |
| Camera capture in PWA (Quest 3, phones, tablets) | Critical | High | Planned |
| `PhotoLog` component — add to entity on first photo tap | Critical | Low | Planned |
| Photo strip in long-press menu | Critical | Low | Planned |
| Worker job — generate thumbnails on upload | High | Medium | Planned |
| Photo timeline view (all photos for an entity) | High | Medium | Planned |
| Photo-position auto-attach (lat/lng + bearing if available) | Medium | Medium | Planned |
| Photo download / export | Medium | Low | Planned |

**Milestone:** A user snaps weekly photos of their tomato. The entity's `PhotoLog` builds a longitudinal record. They never made a "log entry" — they just took pictures.

---

## Phase 3 — Live Sync

**Goal:** Two devices share a garden in real time.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| Anonymous → account upgrade flow (OAuth: Google, GitHub) | Critical | Medium | Planned |
| ASP.NET Identity + JWT bearer tokens | Critical | Medium | Planned |
| SignalR `GardenHub` with group-per-garden | Critical | Medium | Planned |
| Redis backplane added to compose | Critical | Low | Planned |
| Server-authoritative entity mutation pipeline | Critical | High | Planned |
| Client-side delta application to Babylon scene graph | Critical | High | Planned |
| Offline mutation queue + replay on reconnect | High | High | Planned |
| Last-writer-wins conflict resolution by `ModifiedUtc` | High | Medium | Planned |
| Multi-device demo: phone places plant, tablet sees it appear | High | Low | Planned |

**Milestone:** Wife places a plant on her phone. Husband sees it appear on his tablet within ~1s. No refresh, no toggle, no setting.

---

## Phase 4 — Advisor (the AI master gardener)

**Goal:** OpenHarvest's value proposition — the AI master gardener — surfaces over a layout that already exists.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| `IAiProvider` interface + Claude provider | Critical | Medium | Planned |
| OpenAI provider (alternative) | Medium | Medium | Planned |
| Ollama provider (free, self-hosted) | Medium | Medium | Planned |
| `GardenContext` enrichment from current entities + weather | Critical | Medium | Planned |
| First nudge: "watering due" — derived from `CropRef` schedule + last-watered timestamp | Critical | Medium | Planned |
| Nudge surfacing in canvas (single-line hint above entity) | Critical | Medium | Planned |
| Photo-based plant-issue diagnosis endpoint | Critical | High | Planned |
| `HealthLog` event creation from diagnosis result | Critical | Medium | Planned |
| Power-user dashboard scaffold (toggle to reveal) | High | High | Planned |
| AI-generated planting calendar from `Garden` + selected crops | High | High | Planned |
| Companion-planting flag in canvas (visual badge on conflicting placements) | Medium | Medium | Planned |
| AI rate-limiting + cost tracking per user | High | Medium | Planned |

**Milestone:** A user with a tomato plant and three weeks of photos taps the plant. The advisor says: "This looks like early blight starting on lower leaves — see treatment options." They tap the suggestion. The AI master gardener is now in their pocket.

---

## Phase 5+ — Federation, WebXR, Yield, Plugins (Ongoing)

**Goal:** Grow the open-source community and explore integrations that amplify real-world impact.

| Task | Priority | Complexity | Notes |
|---|---|---|---|
| WebXR walkthrough on Quest 3 | High | High | Toggle in canvas; confirm Babylon WebXR pipeline scales |
| YieldLog tracking + harvest charts | High | Medium | Per-entity and per-garden views |
| Multi-season analytics | High | High | Compare year-over-year by zone + crop |
| Plugin / extension system using `Extensions` dictionary | High | High | Third-party components land here |
| Federated network layer | Medium | High | Instance-to-instance discovery; opt-in |
| Public dataset exports (anonymized planting/yield data) | Medium | Medium | CC0 license |
| Multi-language support (i18n) | High | Medium | Spanish, French, Swahili first targets |
| Offline-first refinements | High | High | Critical for limited-connectivity areas |
| FarmBot integration — OpenHarvest as knowledge backend | Medium | High | Replaces OpenFarm for FarmBot users |
| IoT sensor integration (soil moisture, temperature) | Medium | High | MQTT-based |
| Municipal dashboard for city-run community gardens | Low | High | Grant fundable |
| Grant applications | Medium | Low | USDA, Rockefeller, Mozilla, Shuttleworth |

---

## Open Questions

These need answers before they become work items.

- **Monetization model.** Free design + paid tracking is the placeholder. Preferred path: keep tracking free, sustain via donations, hosted-instance fees, or hardware add-ons. **Decision deferred.**
- **Account model.** Anonymous start with optional account upgrade — what is the migration path for entities created anonymously?
- **Photo storage cost ceiling.** Need a per-user soft cap and a clear policy before public launch.
- **Plant-data licensing beyond OpenFarm CC0.** Community contributions need a CLA or contributor agreement.
- **Federation protocol.** ActivityPub-style? Custom? Plain HTTP discovery? Defer until single-instance product is solid.
- **Mobile camera quirks** across iOS Safari PWA, Android Chrome PWA, desktop. PWA camera support has gaps that need explicit testing.
- **Quest 3 WebXR** — confirm Babylon's WebXR pipeline handles the entity scene graph efficiently at expected garden complexity (hundreds of entities).

---

## Guiding Principles

1. **Each phase ships something real.** No phase should end without a working, demonstrable product.
2. **Solo-developer-friendly.** Every task is sized for one person. Complexity is labelled honestly.
3. **Open first.** Everything committed is open-source, and all crop/yield data stays CC0.
4. **Fail loudly, early.** Technical debt is documented. Architecture decisions go in ADRs under `docs/adr/`.
5. **AI as a layer, not a dependency.** The system should degrade gracefully if the AI provider is unavailable or too expensive.
6. **The decorating is the data model.** Any feature requiring a form for the casual user fails this principle.

---

## Architecture Decision Records (ADRs)

Major decisions will be recorded in `docs/adr/` as they're made:

- `ADR-001` — Why .NET 8 over Go, Python, or Ruby
- `ADR-002` — Why Postgres + JSONB over MongoDB or pure relational
- `ADR-003` — Why ECS / `GardenEntity` + components over relational `Crop`/`Garden`/`Planting` tables
- `ADR-004` — Why Babylon.js over Cesium, Three.js, or Unity WebGL
- `ADR-005` — Why PWA-only over .NET MAUI native mobile
- `ADR-006` — Why `IAiProvider` abstraction vs. direct vendor SDK usage
- `ADR-007` — Why Docker Swarm over Kubernetes for the public instance

---

*Last updated: April 2026. The brief that drove v2 of this roadmap is preserved as `OpenHarvest-System-Design-v1.docx` (legacy) and the project brief that supersedes it.*
