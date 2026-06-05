# OpenHarvest Frontend v2

## What this is

v2 of OpenHarvest's frontend. React 19 + Three.js (via React Three Fiber) +
Pascal Editor's `@pascal-app/viewer` for the building / architecture side.
Replaces the v1 Babylon.js frontend that still lives at
`src/OpenHarvest.API/wwwroot/`. As of 2026-04-27 v2 is the canonical UI:
Caddy on the server host serves the Vite SPA dist at
[`https://your-server.example.com/openharvest/`](https://your-server.example.com/openharvest/).

## Architecture in one paragraph

Pascal owns building geometry — walls, doors, windows, slabs — through its
own closed Zod-validated schema and Zustand scene store. We own garden
entities — beds, plants, prefab pots / cages / trellises / greenhouses /
fences / shelves — as our own R3F components, mounted as **children of
Pascal's `<Viewer>`**. Both render into the same Three.js scene, which gives
us unified lighting and shadows for free. The two domains never share data:
Pascal persists to IndexedDB, OpenHarvest persists to the .NET API
(REST + SignalR) → Postgres. They share the scene, not the data model.
See [`../docs/v2-architecture.md`](../docs/v2-architecture.md) for the full
rationale.

## Run locally

```bash
npm install
npm run dev
```

Vite tries port 5174 first (configured in `vite.config.ts`); if that's
taken it falls back to the next free port automatically. The dev server
hits the deployed server API by default since `VITE_API_BASE` is unset
locally — set it to point at a different backend if you need to.

For the deployed build, just open
[`https://your-server.example.com/openharvest/`](https://your-server.example.com/openharvest/).

## Build / deploy

`npm run build` produces a static SPA in `dist/`. The deployed copy lives
on the server host at the configured static path, served by Caddy. Full runbook
including the load-bearing gotchas (Caddy bind-mount inode caching,
`uri strip_prefix`, Caddy mount config) is at
[`../docs/deployment.md`](../docs/deployment.md).

## Code layout

| Path | Purpose |
|---|---|
| `src/main.tsx` | Vite entry point; mounts `<App />` into `#root` |
| `src/App.tsx` | Root component; bootstraps garden id, opens SignalR, renders `<Viewer>` with garden entities as children |
| `src/components/SampleBuilding.tsx` | Programmatically seeds Pascal's `useScene` store with a 5m × 5m room (walls / door / window) on first mount. Strict-mode-safe via a ref guard. |
| `src/components/EntityRenderer.tsx` | Dispatch table: maps a backend `GardenEntity` to a 3D component (`<DemoBed>` / `<DemoPlant>` / placeholder cube / debug magenta cube / skipped house primitive) |
| `src/components/DemoBed.tsx` | Raised-bed primitive: 4 plank walls + soil top, sized from `geometry.size` |
| `src/components/DemoPlant.tsx` | Stem + 3 leaves; height resolves from latest `growth.events[].heightInches`, falling back to `geometry.height` |
| `src/components/DemoGround.tsx` | 100m × 100m grass plane that receives shadows |
| `src/store/garden.ts` | Zustand store: `currentGardenId` (persisted to localStorage), `entities`, `nudges`, REST + SignalR upsert paths |
| `src/api/types.ts` | TypeScript wire-format types mirroring `src/OpenHarvest.Domain/...` (camelCase JSON, PascalCase enum strings) |
| `src/api/client.ts` | Typed REST client; base URL from `VITE_API_BASE`, defaults to `/openharvest/api/v1` |
| `src/api/signalr.ts` | SignalR client for `/openharvest/hubs/garden`; wires `entityUpserted` / `entityDeleted` / `nudge` directly into the Zustand store |
| `vite.config.ts` | `base: '/openharvest/'` for production, `'/'` for dev. Shims `process.env.NODE_ENV` for Pascal's bundle. |
| `index.html` | Includes a runtime `window.process` shim for any Node-style access in third-party bundles |
| `package.json` | Deps: React 19, R3F 9, Drei 10, Three 0.184, Zustand 5, `@pascal-app/{core,viewer}` 0.6, `@microsoft/signalr` 10, `suncalc` (sun position for future advisor) |

## Status

**Built (milestones #1 + #2):**

- Vite + React 19 + TypeScript strict, Pascal `<Viewer>` mounted with custom selection
- `DemoGround`, `DemoBed`, `DemoPlant`, generic prefab + unknown placeholders rendering as R3F siblings inside `<Viewer>`
- `SampleBuilding` populates Pascal's `useScene` store on first mount
- Zustand garden store with localStorage persistence of `currentGardenId`
- Typed REST client and SignalR client wired to live entity upserts / deletes / nudges
- Production build deploys to the server host at `/openharvest/`

**Deferred (later milestones):**

- Advisor / AI hookups — gated behind an opt-in toggle when they land (cost control + posture)
- Full prefab catalog — only beds, plants, and two prefab slugs (`terracotta-pot`, `greenhouse-arch`) render real geometry today
- Picking / selection contract — `<Viewer selectionManager="custom">` disables Pascal's built-in pick handler but ours doesn't exist yet
- Photos UI (capture, strip per entity, presigned URLs)
- Nudges UI (the SignalR `nudge` events land in the store but nothing renders them)
- Cut-away wall toggle, AI ghost-pin placement, GLB export

## Conventions

- TypeScript strict — no `any` escape hatches without justification
- **No advisor / AI imports without an explicit opt-in toggle.** REST client deliberately omits `/advisor/*`; reintroduce it behind a feature flag.
- **Never fork or extend Pascal's schema.** Pascal owns its node types end-to-end; the architectural bet (see `docs/v2-architecture.md`) is that we compose at the Three.js scene level, not the data level.
- Garden geometry stays inside our R3F components mounted under `<Viewer>`; building geometry stays inside Pascal's nodes via `useScene.createNode(...)`.
