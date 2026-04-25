# Getting Started — Developer Setup

> Phase 0 / Phase 1 setup. Brings up Postgres + the API + the Babylon canvas in your browser. ~5 minutes.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| .NET SDK | 8.0+ | [dotnet.microsoft.com](https://dotnet.microsoft.com/download) |
| Docker Desktop | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Git | Any | [git-scm.com](https://git-scm.com/) |

For developers running the API directly (not in Docker), Postgres is also useful locally — easiest way is `docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=openharvest -e POSTGRES_USER=openharvest -e POSTGRES_DB=openharvest postgres:16-alpine`.

**AI Provider** is *not* required for Phase 0 / Phase 1. Add a key when you reach Phase 4.

---

## Option A — Docker Compose (recommended for first run)

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
docker compose up --build
```

The first build takes a few minutes (NuGet restore + .NET publish). When it settles, open:

- PWA: <http://localhost:5000>
- Health: <http://localhost:5000/healthz>
- Swagger: <http://localhost:5000/swagger>

You should see a Babylon scene with a brown bed and a green tomato cylinder labeled "Brandywine Tomato". That's the Phase 0 milestone — end-to-end pipeline alive: API serves an entity, browser draws it.

To start fresh (nuke the Postgres volume):
```bash
docker compose down -v
docker compose up --build
```

---

## Option B — Run the API directly

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest

# Start just Postgres
docker compose up -d postgres

# Run the API on the host
dotnet run --project src/OpenHarvest.API
```

This uses `appsettings.Development.json` (Postgres at `localhost:5432`). Migrations and seed data apply automatically on startup.

---

## What's in the Phase 0 build

| Layer | Implementation |
|---|---|
| API | `OpenHarvest.API` — ASP.NET Core 8, REST controller `GET /api/v1/gardens/{id}/entities` |
| Domain | `OpenHarvest.Domain` — `GardenEntity` with nullable components (PhotoLog, GrowthLog, ScheduleComponent, YieldLog, HealthLog) |
| Infrastructure | `OpenHarvest.Infrastructure` — EF Core 8 + Npgsql, JSONB component columns, repository |
| Frontend | Static `wwwroot/` PWA: HTML + Babylon.js (CDN). Loads entities from API and renders meshes. |

Hard-coded demo garden id (used by the canvas): `11111111-1111-1111-1111-111111111111`.

---

## Adding a Database Migration

```bash
dotnet ef migrations add YourMigrationName \
    --project src/OpenHarvest.Infrastructure \
    --startup-project src/OpenHarvest.API \
    --output-dir Data/Migrations
```

Migrations apply automatically on API startup in Development environment. In Production, run `dotnet ef database update` as a separate step.

---

## Project Layout

```
src/
  OpenHarvest.Domain/          # GardenEntity, components, value objects, interfaces
  OpenHarvest.Application/     # Use cases, commands, DTOs (mostly empty in Phase 0)
  OpenHarvest.Infrastructure/  # EF Core DbContext + migrations + repository
  OpenHarvest.API/             # ASP.NET Core entrypoint + controllers + PWA assets in wwwroot/
  OpenHarvest.Worker/          # BackgroundService entrypoint (empty until Phase 2+)
docs/
  ARCHITECTURE.md              # 4-layer system design
  DATA_MODEL.md                # GardenEntity + components
  UX.md                        # Casual-user flow
  DEPLOY.md                    # Compose / Swarm topology
  AI_INTEGRATION.md            # Advisor (Layer 3) provider guide
ROADMAP.md
```

---

## Troubleshooting

**`docker compose up` fails with "build error":** make sure Docker Desktop has Linux containers enabled (default). Re-run with `--no-cache` if a dependency changed.

**Migrations error on startup:** the Postgres healthcheck waits up to ~50s. If the API still fails, check `docker logs openharvest-postgres` for crash output.

**Port 5000 already in use:** edit the `ports` block in `docker-compose.yml` to map a different host port (e.g. `"5050:5000"`).

**Browser shows "loading..." forever:** open devtools → Network — confirm `GET /api/v1/gardens/.../entities` returns 200 with a JSON array. CORS is permissive in Development; if you proxied the API behind another domain, set `ASPNETCORE_ENVIRONMENT=Development` so CORS opens up.

---

*Continue with [`UX.md`](UX.md) to understand the canvas-first product, or [`ARCHITECTURE.md`](ARCHITECTURE.md) for the layered system.*
