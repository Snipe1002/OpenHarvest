# OpenHarvest Frontend v2

## What this is

Local dev scaffold for the OpenHarvest v2 frontend: Vite + React 19 + TypeScript + Three.js (R3F) + Drei + Zustand. Mounts Pascal Editor's `<Viewer>` (`@pascal-app/viewer`) and renders our own garden components (raised bed, plant) as R3F siblings inside Pascal's scene to validate the compositional bet.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5174.

## Status

- Vite + React 19 + TS strict — works
- Pascal `<Viewer>` mounted with `selectionManager="custom"` and Drei `<CameraControls>` — works
- `DemoGround`, `DemoBed`, `DemoPlant` rendering as R3F siblings inside `<Viewer>` — works
- Pascal scene starts empty; sample building (walls/door/window) via `useScene` from `@pascal-app/core` — stubbed (Pascal's Zod-validated scene graph wasn't worth fitting into this scaffold)
- API integration, SignalR, subpath base, deploy — out of scope for this scaffold
