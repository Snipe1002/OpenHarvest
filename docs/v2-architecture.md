# OpenHarvest v2 — Frontend Architecture

> Status: as of 2026-04-27. v2 is the canonical frontend. v1 (Babylon.js, served from
> `src/OpenHarvest.API/wwwroot/`) is still in the API container but no longer routed.

---

## The compositional bet

We chose Path A: **Pascal Editor as a black box, OpenHarvest as a sibling
in the same Three.js scene.**

Pascal's `<Viewer>` accepts arbitrary React Three Fiber children. We
verified this in the spike (see `frontend-v2/src/App.tsx`):

```tsx
<Viewer selectionManager="custom">
  <CameraControls />
  <DemoGround />
  {Object.values(entities).map((e) => (
    <EntityRenderer key={e.id} entity={e} />
  ))}
</Viewer>
```

When React renders that subtree, our garden components mount as siblings
to Pascal's wall / door / window / slab nodes inside the same Three.js
scene graph. We get unified lights, unified shadows, unified camera, and
a single render loop — without forking Pascal, without extending its
closed Zod schema, and without writing any data-translation layer.

**Why we did NOT go the other way (extend Pascal):**

1. **Velocity tax.** Pascal is closed-schema (Zod-validated). Adding a
   `bed` or `plant` node type means forking their package, maintaining
   that fork against upstream changes forever, and re-validating their
   editor UI against types they never intended to support.
2. **UX coupling.** Pascal's selection / inspector / property panels are
   wired to Pascal's types. If we made `bed` a Pascal node, their UI
   would either expose nonsense controls for it or we'd have to extend
   their UI too — bigger fork.
3. **Single scene = unified rendering.** The thing we actually wanted
   from Pascal was a polished R3F-based viewer with good lighting and
   navigation. We get that just by mounting under `<Viewer>`. The data
   model can stay ours.

The cost we accept is one open contract surface: **picking / selection**,
discussed below.

---

## Data domains

Clean split. No overlap. No translation layer.

### Pascal owns

- Walls, doors, windows, slabs, ceilings, roofs, zones
- Building / level / site hierarchy
- Stored in Pascal's Zustand store (`useScene` from `@pascal-app/core`)
- Persisted to **IndexedDB** by Pascal's own machinery
- Bootstrapped in `src/components/SampleBuilding.tsx` via
  `useScene.getState().createNode(...)` against `WallNode` / `DoorNode` /
  `WindowNode` / `LevelNode` Zod parsers from `@pascal-app/core`

### OpenHarvest owns

- Garden entities: beds, plants, prefab pots / cages / trellises /
  greenhouses / fences / shelves / labels / paths
- Photos, growth log, schedule, yield log, health log (all optional
  components on `GardenEntity`)
- Stored in our Zustand store (`useGarden` in `src/store/garden.ts`)
- Persisted via REST to the .NET API (`/openharvest/api/v1`) → Postgres
- Live-updated over SignalR (`/openharvest/hubs/garden`)

### What they share

The Three.js scene only. They never read each other's stores. There is
no synchronization, no shared schema, no FK. If a user "places a bed
inside Pascal's house," that's purely a coordinate fact: our
`<DemoBed>` happens to render at a position that's inside Pascal's
walls. Neither store knows about the other.

---

## Store shape

From `src/store/garden.ts`:

```ts
export interface GardenState {
  currentGardenId: Guid | null
  garden: Garden | null
  /** entityId -> entity. Drives R3F rendering. */
  entities: Record<Guid, GardenEntity>
  nudges: Nudge[]
  loading: boolean
  error: string | null

  /** Switch active garden, persist id, fetch garden + entities, replace state. */
  setCurrentGarden: (id: Guid) => Promise<void>
  /** REST or SignalR upsert path. Idempotent; replaces the whole entity by id. */
  addOrUpdateEntity: (e: GardenEntity) => void
  /** Remove an entity by id. No-op if missing. */
  removeEntity: (id: Guid) => void
  /** Append a new nudge. */
  addNudge: (n: Nudge) => void
  /** Drop a nudge by entityId. */
  clearNudge: (entityId: Guid) => void
}
```

`currentGardenId` is persisted to localStorage under the key
`openharvest:v2:currentGardenId`. On boot, `App.tsx` reads it; if absent
it calls `listGardenIds()` and picks the first id the server returns.

`addOrUpdateEntity` is the single upsert path: both REST responses and
SignalR `entityUpserted` events flow through it. Same for
`removeEntity` (DELETE response + `entityDeleted` event).

---

## EntityRenderer dispatch table

From `src/components/EntityRenderer.tsx`. This is the single point that
turns a backend `GardenEntity` into a 3D thing.

| Condition | Renders |
|---|---|
| `geometry.prefabRef` ∈ `{wall-segment, floor-slab, door, window, shelf-wall}` | **Skipped** with `console.warn`. Pascal owns architectural geometry; we haven't decided how to bridge yet. |
| `geometry.prefabRef` ∈ `{raised-bed-wood, square-planter}`, OR `entity.kind === 'Bed'` | `<DemoBed>` |
| `geometry.prefabRef === 'tomato-cage'`, OR `entity.kind === 'Plant'` | `<DemoPlant>` |
| `geometry.prefabRef` ∈ `{terracotta-pot, greenhouse-arch}` | `<PrefabPlaceholder>` — labeled brown cube until milestone #3 ships the catalog |
| Anything else | `<UnknownDebugCube>` — magenta cube + label, so unhandled cases surface visually instead of disappearing |

**Bad-position guard:** if `entity.transform.position` has any non-finite
component (NaN / Infinity), the renderer logs a warning and returns
`null`. One malformed record can't take down the scene.

**Why magenta for unknown:** matches the Source-engine convention.
"Missing texture" loud enough that a developer can't ignore it in the
viewport.

---

## Network contracts

### REST

- Base URL: `VITE_API_BASE` if set, otherwise `/openharvest/api/v1`
- Auth: none (Tailscale-fronted)
- Encoding: `Content-Type: application/json` for non-multipart, camelCase
  property names, PascalCase enum string values (e.g. `"Plant"`, `"Box"`,
  `"WateringDue"`). Mirrors `JsonStringEnumConverter` +
  `JsonNamingPolicy.CamelCase` in `src/OpenHarvest.API/Program.cs`.
- Error model: `ApiError` (in `src/api/client.ts`) carries `status` +
  parsed body when available.

Endpoints used by v2 today:

| Method | Path | Purpose |
|---|---|---|
| GET | `/gardens/ids` | list garden ids (used for first-paint fallback) |
| GET | `/gardens/{id}` | fetch one garden header |
| POST | `/gardens` | create garden |
| PATCH | `/gardens/{id}` | update name / lat / lng / zone |
| GET | `/gardens/{id}/entities` | list all entities for a garden |
| GET | `/gardens/{id}/entities/{entityId}` | fetch one entity |
| POST | `/gardens/{id}/entities` | create entity |
| PATCH | `/gardens/{id}/entities/{entityId}` | update entity |
| DELETE | `/gardens/{id}/entities/{entityId}` | delete entity |
| GET | `/gardens/{id}/entities/{entityId}/photos` | list photos with presigned URLs |
| POST | `/gardens/{id}/entities/{entityId}/photos` | multipart upload |
| DELETE | `/gardens/{id}/entities/{entityId}/photos/{photoId}` | delete photo |

Deliberately NOT exposed: `/advisor/*`. Bringing those back requires an
opt-in toggle (cost + posture).

### SignalR

- Hub URL: `VITE_HUB_URL` if set, otherwise `/openharvest/hubs/garden`
- Transport: default negotiated (WebSocket → SSE → long-poll)
- Logging: `LogLevel.Warning` (set in `src/api/signalr.ts`)
- Auto-reconnect: enabled via `withAutomaticReconnect()`; on
  `onreconnected` we call `Join(activeGardenId)` again

| Direction | Method | Payload |
|---|---|---|
| client → server | `Join(gardenId)` | subscribe this connection to the garden's group |
| client → server | `Leave(gardenId)` | unsubscribe |
| server → client | `entityUpserted` | full `GardenEntity` (any create or update broadcasts the whole record) |
| server → client | `entityDeleted` | `Guid` as string |
| server → client | `nudge` | `Nudge` object |

All three server events wire directly into `useGarden.getState()` —
the components that read the store re-render automatically. No callback
plumbing.

The `connect(gardenId)` function reuses the existing connection if one
is open and calls `Leave(old)` + `Join(new)` to switch groups, so
flipping `currentGardenId` doesn't tear down the WebSocket.

---

## Picking / selection contract surface

This is the one place where Pascal's domain and ours touch.

`<Viewer selectionManager="custom">` tells Pascal **not** to install its
default click-pick handler. We did this so Pascal wouldn't try to select
our garden meshes (and fail / behave oddly because our meshes aren't in
its node graph).

But **we have not yet written our own pick router.** Today, clicks are
inert. Milestone #3 needs:

1. A top-level pick handler that raycasts against the scene
2. A dispatch step: if the hit object is owned by Pascal (we can detect
   via mesh `userData` / parent traversal), forward to Pascal's selection
   API. If it's one of ours, route to the OpenHarvest inspector.
3. A shared "selected entity id" state that both inspectors can read

This is the load-bearing seam. Get it wrong and the unified-scene
benefit evaporates — users can't interact with anything cleanly.

---

## What's deferred (and why)

- **Advisor / AI hookups.** Gated until we ship a usage-cost dashboard
  and an explicit opt-in toggle. Reintroducing the `/advisor/*` REST
  surface and the `nudge` UI without that means surprise LLM bills and
  surprise outbound calls — both bad posture for an open-source
  self-hostable thing.
- **Full prefab catalog.** Today only `raised-bed-wood`,
  `square-planter`, `tomato-cage`, `terracotta-pot`, `greenhouse-arch`
  are handled. The v1 catalog (`src/OpenHarvest.API/wwwroot/lib/prefabs.js`)
  has more; porting them is straightforward but mechanical — milestone #3.
- **Photos UI.** Backend supports it (presigned MinIO URLs); frontend
  just hasn't built the strip / capture flow yet. `uploadPhoto` is
  already wired in `client.ts` for when it's needed.
- **Nudges UI.** SignalR `nudge` events land in the store and disappear
  — no toast / panel / overlay yet.
- **Cut-away wall toggle.** UX win for indoor planning (so you can see
  beds inside greenhouses) but we punted on it pending the picking
  contract.
- **AI ghost-pin placement.** Advisor-adjacent; same gating.
- **GLB export.** Three.js → GLB is one library call; the gating is
  what to include (Pascal walls + our entities = unified GLB) and
  policy on photo embeds.
