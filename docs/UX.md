# OpenHarvest — UX Flow

> The defining constraint: **the casual user has stated outright they do not want "an app."** The interaction surface is therefore radically minimal. PWA, opens from a URL, no install, no account-creation gate to start designing.

---

## 1. Audience Tiers

| Audience | Engagement | Tier |
|---|---|---|
| Casual / app-resistant | Designs garden, labels plants, saves layouts. May share with family. | Free |
| Engaged hobbyist | Adds photos, tracks growth, logs yields, follows advisor nudges. | Free or Paid (TBD) |
| Power user / homesteader | Multi-season planning, yield analytics, custom plugins, federation. | Paid |
| Self-hoster / community | Runs own instance, contributes plant data, shares layouts. | Free (FOSS) |

Tentative monetization: design is free, tracking and yield analytics are paid. **This is on the bench** — the preferred path is to keep tracking free and find another sustainability model. Decision deferred.

---

## 2. The Casual-User First Run

### First open

The user lands on `https://openharvest.io` (or the self-hosted URL). They see:

- An empty top-down 3D grid representing a generic garden plot
- Four large buttons at the bottom of the screen: **Bed**, **Plant**, **Structure**, **Label**
- That is the entire chrome. No menu. No settings icon. No user avatar. No login link.

No account-creation gate. Local PWA state holds everything until the user explicitly chooses to sync.

### Adding a plant

1. Tap **Plant**. A crosshair appears.
2. Tap a spot inside a bed. The keyboard pops up with autocomplete.
3. Type `tom` — autocomplete shows *Brandywine Tomato*, *Cherokee Purple*, *Sungold*. Pick one.
4. A 3D plant pin appears with the name floating above it. **No save button. No modal. No form.**

When the user picks an autocomplete result, the entity's `CropRef` field binds silently to the OpenFarm slug. The user never sees this. The advisor will use it later.

### Editing an entity

Long-press any entity. A radial menu appears: **Photo**, **Move**, **Rename**, **Delete**.

- **Photo** opens the camera, snaps, attaches to the entity with timestamp and position. That is the entire interaction surface for the casual user — for the lifetime of the product.

### Viewing the garden

| Gesture | Result |
|---|---|
| One-finger drag | Pan the camera |
| Two-finger pinch | Zoom and tilt between top-down and 3D |
| WebXR button (when Quest 3 detected) | Walk through the garden in VR |

---

## 3. Why This Avoids "App" Feel

- **PWA.** Opens from a URL. No install.
- **No login required** to start designing. Account becomes optional later if the user wants to sync to another device.
- **Aggressive autocomplete** from OpenFarm — the name is filled in for them.
- **Autosave on every gesture.** No save button anywhere.
- **Four buttons.** No nested menus. No settings to tune before doing the thing.
- **No notifications until they opt in.** No "rate us" prompts. No tutorials. The product is the tutorial.

---

## 4. Power-User Mode

Same canvas. A toggle reveals additional surface:

- Component inspector (show all components attached to selected entity)
- Schedule timeline (sow → transplant → harvest visualization)
- Advisor sidebar (ongoing nudges, click for full reasoning)
- Yield charts (per-entity and per-garden)
- Multi-season comparison
- Plugin panel

The power user is **not using a different app** — they are seeing more of the same app. Same entities, same data, different lens.

---

## 5. Mapping User Actions to Components

This is the data model expressed as interaction:

| User action | Effect on entity |
|---|---|
| Place a plant | Creates `GardenEntity` with `Kind = Plant`, `Transform`, `Geometry` |
| Pick from autocomplete | Sets `CropRef` |
| Snap a photo | Adds `PhotoLog` (creates if absent) + `PhotoRef` |
| Set a sow date | Adds `ScheduleComponent` with `SowDate` populated |
| Mark harvested | Adds `YieldLog` + `HarvestEvent` |
| Tag pest sighting | Adds `HealthLog` + `HealthEvent` |
| Run AI diagnosis on a photo | Creates `DiagnosisRequest`, populates `HealthEvent.IdentifiedProblem` |

**There is never a step where the user fills out a form to create one of these components.** The component is implicit in the gesture.

---

## 6. Casual → Engaged → Power User Funnel

The depth of components on a user's entities is the funnel metric:

- **Casual** (~80% of users): entities have only `Transform` + `Geometry` + maybe `Name`. Zero components attached.
- **Curious** (~15%): some entities also have `PhotoLog`. They've started snapping pictures.
- **Engaged** (~4%): `PhotoLog` + `Schedule` + occasional `YieldLog` or `HealthLog`. They follow advisor nudges.
- **Power user** (~1%): full component coverage, multi-garden, multi-season, plugin extensions.

The system never pesters users to advance. Each layer is discovered organically. Conversion happens by demonstrating value, not by gating features behind paywalls.

---

## 7. Anonymous → Account Upgrade

A user can opt in to creating an account at any time:

- One-tap *"Sync to another device"* button in the (otherwise hidden) settings drawer
- They get an email/password prompt or OAuth (Google, GitHub)
- On creation, their local entities (in PWA storage) are migrated to a server-owned `Garden`
- The local PWA continues to work offline; sync is best-effort
- They can log in on a second device and pick up where they left off

The user never sees a forced login wall.

---

## 8. Multi-Device Live Sync (Layer 2+)

When two devices are signed into the same account and have the same garden open:

- **Wife places a plant on her phone.**
- **Husband sees it appear on his tablet** within a second or two.

This works through SignalR group-per-garden — see [`ARCHITECTURE.md`](ARCHITECTURE.md) §6 for the technical model.

For the user, there is no toggle, no setting, no "live mode" — it just behaves that way.

---

## 9. WebXR (Quest 3) Walkthrough

When the device reports WebXR availability (Quest 3 browser, Chrome on Pico, etc.), a small headset icon appears in the bottom-right of the canvas.

- Tap it → the scene re-renders into the headset
- Walk through the garden at scale
- Look at plants from below to see what they'll look like at maturity
- Long-press in VR for the same radial menu as on touch

WebXR is purely additive — the canvas works perfectly without it.

---

## 10. Non-Negotiables

These constraints define the product. Any feature that violates them needs explicit override.

- The casual user **never sees a form**, never types into a text field except the autocomplete-backed plant name, never presses a save button.
- **Free tier produces a complete and useful product** on its own. Tracking layers add value without gating the design experience.
- **PWA-first.** No app-store install required to use the product.
- **Self-hostable.** The same compose file the public instance runs is what self-hosters get.
- **CC0 / open-data alignment** for plant information. Community contributions stay open.
- **Render-agnostic backend.** Babylon is the v1 client, but the API does not assume any particular renderer.

---

*See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical layering, and [`DATA_MODEL.md`](DATA_MODEL.md) for the entity definitions referenced here.*
