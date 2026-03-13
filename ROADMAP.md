# OpenHarvest Development Roadmap

> Each phase delivers a usable, valuable product. No phase depends on hardware, funding, or a large team. A single developer can ship Phase 1 in weeks.

---

## Phase 1 — Foundation (Weeks 1–4)

**Goal:** A working crop database with AI-powered Q&A that anyone can use from a browser.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| Set up .NET 8 solution structure (Clean Architecture) | Critical | Low | Planned |
| Docker Compose: PostgreSQL + Redis + API | Critical | Low | Planned |
| `Crop` entity + EF Core migrations | Critical | Medium | Planned |
| Seed crop data from OpenFarm CC0 dataset | Critical | Medium | Planned |
| Crop search/browse/detail API endpoints | Critical | Low | Planned |
| `IAiProvider` interface + Claude implementation | Critical | Medium | Planned |
| `/api/v1/ai/ask` endpoint with basic `GardenContext` | Critical | Medium | Planned |
| Simple web frontend: search crops + ask questions | High | Medium | Planned |
| GitHub repo + README + MIT license | High | Low | Done |
| Contributing guide + issue templates | High | Low | Done |

**Milestone:** A publicly accessible URL where anyone can search crops and ask an AI gardening question. No account required.

---

## Phase 2 — Personalization (Weeks 5–8)

**Goal:** Users create gardens, get personalized planting calendars, and receive timely reminders.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| User registration + ASP.NET Identity + JWT auth | Critical | Medium | Planned |
| OAuth login (Google, GitHub) | High | Low | Planned |
| `Garden`, `GardenBed`, `Planting` entities + CRUD APIs | Critical | Medium | Planned |
| Growing zone auto-detection from lat/lng | High | Low | Planned |
| Last/first frost date lookup by location | High | Low | Planned |
| Weather API integration (OpenWeatherMap free tier) | High | Medium | Planned |
| AI planting calendar generation | High | High | Planned |
| `/api/v1/gardens/{id}/calendar` endpoint | High | Medium | Planned |
| Garden dashboard UI (active plantings + upcoming tasks) | High | Medium | Planned |
| Push notification service for planting reminders | Medium | Medium | Planned |

**Milestone:** A logged-in user can create a garden, add crops they want to grow, and receive a full-season planting calendar with date-specific reminders.

---

## Phase 3 — Intelligence (Weeks 9–12)

**Goal:** Visual plant diagnosis, activity logging, and the system starts learning from user data.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| Plant photo upload + storage (local filesystem / S3) | Critical | Medium | Planned |
| AI vision-based plant diagnosis endpoint | Critical | High | Planned |
| `PlantProblem` database (symptoms, causes, treatments) | High | Medium | Planned |
| Link diagnosis results to `PlantProblem` entries | High | Medium | Planned |
| `PlantingLog` activity tracking (watered, fertilized, pruned, etc.) | High | Low | Planned |
| Harvest tracking with yield data (lbs/kg) | Medium | Low | Planned |
| User rating for AI diagnoses ("Was this helpful?") | Medium | Low | Planned |
| Aggregate anonymous zone-level yield data | Medium | High | Planned |
| Companion planting recommendations in crop search | Medium | Medium | Planned |
| Crop success rate statistics by zone | Low | High | Planned |

**Milestone:** A user can photograph a sick plant, receive an AI diagnosis with treatment options, and log their daily garden activity. Every logged harvest makes zone-level recommendations more accurate.

---

## Phase 4 — Community (Weeks 13–16)

**Goal:** Connect gardeners locally. Share surplus food, tips, and what's working in your area.

| Task | Priority | Complexity | Status |
|---|---|---|---|
| `GrowingTip` entity + zone-specific community tips | High | Medium | Planned |
| `/api/v1/community/tips` endpoint with zone + crop filters | High | Low | Planned |
| `HarvestShare` — post surplus produce for neighbors | High | Medium | Planned |
| Location-based share discovery (geospatial query) | High | Medium | Planned |
| Upvote/rating system for community tips | Medium | Low | Planned |
| "What's growing near you" feed based on zone | Medium | Medium | Planned |
| Basic moderation tools for community content | Medium | Medium | Planned |
| User profiles with growing history | Low | Medium | Planned |
| Community garden support (multi-user shared garden) | Low | High | Planned |

**Milestone:** Gardeners in the same zone can share tips, post surplus harvests, and see what neighbors are successfully growing. The platform becomes a local food network, not just an app.

---

## Phase 5 — Scale & Impact (Ongoing)

**Goal:** Grow the open-source community and explore integrations that amplify real-world impact.

| Task | Priority | Complexity | Notes |
|---|---|---|---|
| .NET MAUI mobile app (Android + iOS) | High | High | Shared codebase with API |
| Offline mode for limited-connectivity areas | High | High | Critical for developing world use |
| Multi-language support (i18n) | High | Medium | Spanish, French, Swahili as first targets |
| FarmBot integration — OpenHarvest as knowledge backend | Medium | High | Replaces OpenFarm for FarmBot users |
| IoT sensor integration (soil moisture, temperature) | Medium | High | MQTT-based |
| Municipal dashboard for city-run community gardens | Low | High | Grant fundable |
| Public dataset exports (anonymized planting/yield data) | Medium | Medium | CC0 license |
| Grant applications | Medium | Low | USDA, Rockefeller, Mozilla, Shuttleworth |
| Federated instances (self-host for communities) | Low | High | ActivityPub-inspired |

---

## Guiding Principles

1. **Each phase ships something real.** No phase should end without a working, demonstrable product.
2. **Solo-developer-friendly.** Every task is sized for one person. Complexity is labelled honestly.
3. **Open first.** Everything committed is open-source, and all crop/yield data stays CC0.
4. **Fail loudly, early.** Technical debt is documented. Architecture decisions go in ADRs under `docs/adr/`.
5. **AI as a layer, not a dependency.** The system should degrade gracefully if the AI provider is unavailable or too expensive.

---

## Architecture Decision Records (ADRs)

Major decisions will be recorded in `docs/adr/` as they're made:

- `ADR-001` — Why .NET 8 over Go, Python, or Ruby
- `ADR-002` — Why PostgreSQL over MongoDB
- `ADR-003` — Why `IAiProvider` abstraction vs. direct Claude SDK usage
- `ADR-004` — Blazor vs. React for the web frontend
- `ADR-005` — Why Hangfire over Quartz.NET for background jobs

---

*Updated: March 2026*
