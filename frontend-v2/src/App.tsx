import { useEffect, useMemo } from 'react'
import { Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import { emitter, type WallEvent } from '@pascal-app/core'
import DemoGround from './components/DemoGround'
import EntityRenderer from './components/EntityRenderer'
import type { GardenEntity, Guid } from './api/types'
import { createDoorOnWall, createWindowOnWall } from './components/houseHelpers'
import InspectorCard from './components/InspectorCard'
import MainToolbar from './components/MainToolbar'
import MultiChip from './components/MultiChip'
import MultiSelectInspector from './components/MultiSelectInspector'
import RegionPaint from './components/RegionPaint'
import SampleBuilding from './components/SampleBuilding'
import SnapChip from './components/SnapChip'
import StickyChip from './components/StickyChip'
import ToastBar from './components/ToastBar'
import TranslateStatusPill from './components/TranslateStatusPill'
import UnitsChip from './components/UnitsChip'
import WallInspectorCard from './components/WallInspectorCard'
import { listGardenIds } from './api/client'
import { connect, disconnect } from './api/signalr'
import { useGarden } from './store/garden'

/**
 * App root: full-viewport Pascal Viewer with our garden components mounted as
 * R3F siblings inside Pascal's scene.
 *
 * Wiring:
 *   1. On mount: if a garden id is persisted in localStorage, re-load it;
 *      otherwise fetch the server's id list and pick the first.
 *   2. Whenever `currentGardenId` changes, open a SignalR connection and
 *      join that garden's group. Live entity upserts/deletes flow into the
 *      Zustand store automatically.
 *   3. Render every entity from the store via `<EntityRenderer>`.
 *   4. `<InspectorCard>` is a single drei `<Html>` anchored above the
 *      currently-selected entity. Auto-hides when nothing is selected.
 *   5. Subscribe to Pascal's `wall:click` emitter so wall picks work without
 *      Pascal's hierarchical SelectionManager (which would require selecting
 *      building → level → zone first). Walls become a single-tap target.
 *
 * `SampleBuilding` seeds Pascal's scene store with a 1cm anchor wall — Pascal's
 * Viewer requires building geometry to render anything. The user-facing
 * "Clear House" button has been removed; the anchor stays put.
 */
export default function App() {
  const currentGardenId = useGarden((s) => s.currentGardenId)
  const setCurrentGarden = useGarden((s) => s.setCurrentGarden)
  const loadPrefabCatalog = useGarden((s) => s.loadPrefabCatalog)
  const entities = useGarden((s) => s.entities)
  const translateModeId = useGarden((s) => s.translateModeId)
  const groupTranslateActive = useGarden((s) => s.groupTranslateActive)
  // Camera orbit pauses while the user is mid-region-drag so the view doesn't
  // pan with the second-corner pointer move. Other region phases (awaiting
  // first corner, configuring) leave camera orbit alone — the rectangle is
  // either not yet started or already locked in.
  const regionDragActive = useGarden(
    (s) => s.regionPaint?.phase === 'awaiting-second-corner',
  )

  useEffect(() => {
    let cancelled = false
    // Kick off the prefab catalog fetch in parallel with the garden bootstrap —
    // the scene renders without it (DemoGround falls back to a default geometry)
    // and the picker UI shows "Loading…" until it arrives.
    void loadPrefabCatalog()
    if (currentGardenId) {
      void setCurrentGarden(currentGardenId)
      return
    }
    listGardenIds()
      .then((ids) => {
        if (cancelled) return
        if (ids.length > 0) void setCurrentGarden(ids[0])
        else console.info('[App] no gardens yet — backend returned an empty list')
      })
      .catch((err) => console.error('[App] listGardenIds failed', err))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!currentGardenId) return
    let cancelled = false
    connect(currentGardenId).catch((err) => {
      if (!cancelled) console.error('[App] SignalR connect failed', err)
    })
    return () => {
      cancelled = true
      void disconnect()
    }
  }, [currentGardenId])

  // Subscribe to Pascal's wall:click events. This bypasses Pascal's
  // SelectionManager (which gates wall picking behind building/level/zone
  // selection) and gives us a single-tap wall pick. While in door/window
  // placement mode, the click instead creates a child Door/Window node on
  // the clicked wall, with `localX` projected onto the wall's start→end line.
  useEffect(() => {
    const handler = (event: WallEvent) => {
      const wall = event.node
      const { housePlacement, setHousePlacement, selectWall } = useGarden.getState()

      if (housePlacement?.type === 'door' || housePlacement?.type === 'window') {
        // Project the world-space click point onto the wall's centerline to
        // get the local x offset.
        const sx = wall.start[0]
        const sz = wall.start[1]
        const ex = wall.end[0]
        const ez = wall.end[1]
        const dx = ex - sx
        const dz = ez - sz
        const len = Math.hypot(dx, dz)
        if (len > 0) {
          const px = event.position[0] - sx
          const pz = event.position[2] - sz
          const t = (px * dx + pz * dz) / (len * len)
          const clampedT = Math.max(0.05, Math.min(0.95, t))
          const localX = clampedT * len - len / 2
          if (housePlacement.type === 'door') {
            createDoorOnWall(wall.id, localX)
          } else {
            createWindowOnWall(wall.id, localX)
          }
        }
        // Sticky: stay armed for another door/window placement on another wall.
        // Otherwise: exit.
        if (!useGarden.getState().stickyPlacement) {
          setHousePlacement(null)
        }
        event.stopPropagation()
        return
      }

      // Default: select the wall and open its inspector.
      selectWall(wall.id)
      event.stopPropagation()
    }
    emitter.on('wall:click', handler)
    return () => {
      emitter.off('wall:click', handler)
    }
  }, [])

  // Hierarchy: bucket entities by parentId so we can recurse from the roots
  // (parentId == null) outward. Three's scene graph then multiplies parent
  // transforms onto children automatically — moving a parent moves its
  // children with no manual cascade. Cycles would loop the recursion forever,
  // so we guard with a `visited` Set and stop as soon as we'd revisit an id.
  const entitiesByParent = useMemo(() => {
    const map = new Map<Guid | null, GardenEntity[]>()
    for (const e of Object.values(entities)) {
      const key: Guid | null = e.parentId ?? null
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    return map
  }, [entities])

  const renderChildren = (parentId: Guid | null, visited: Set<Guid>): React.ReactNode => {
    const kids = entitiesByParent.get(parentId)
    if (!kids || kids.length === 0) return null
    return kids.map((e) => {
      if (visited.has(e.id)) {
        // Cycle — log once and bail out of this branch. Shouldn't happen with
        // a well-behaved backend, but defending against it here is cheap.
        console.warn('[App] hierarchy cycle detected at', e.id)
        return null
      }
      const nextVisited = new Set(visited)
      nextVisited.add(e.id)
      return (
        <EntityRenderer key={e.id} entity={e}>
          {renderChildren(e.id, nextVisited)}
        </EntityRenderer>
      )
    })
  }

  // Orphan recovery: any entity whose parentId points at a non-existent entity
  // would otherwise never render (because the recursion only walks down from
  // null). Surface those as top-level so the user can still see + delete them.
  const orphanRoots = useMemo(() => {
    const out: GardenEntity[] = []
    for (const e of Object.values(entities)) {
      if (e.parentId && !entities[e.parentId]) out.push(e)
    }
    return out
  }, [entities])

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SampleBuilding />
      <Viewer selectionManager="custom">
        {/* Camera orbit is suspended while the user is dragging an entity in
            single OR group translate mode, or mid-region-paint-drag, so the
            view doesn't pan along with the pointer. */}
        <CameraControls
          enabled={!translateModeId && !groupTranslateActive && !regionDragActive}
        />
        <DemoGround />
        {renderChildren(null, new Set())}
        {orphanRoots.map((e) => (
          <EntityRenderer key={e.id} entity={e}>
            {renderChildren(e.id, new Set([e.id]))}
          </EntityRenderer>
        ))}
        {/* Inspector is anchored to the selected entity in 3D space — drei's
            Html mounts it as DOM but tracks the world position. */}
        <InspectorCard />
        <WallInspectorCard />
        {/* Drag-paint region of beds — visualizes the rectangle outline,
            ghost beds during configuring, and the inline grid-tweak popover.
            Pointer pipeline lives on DemoGround.tsx. */}
        <RegionPaint />
      </Viewer>
      {/* HTML overlays — siblings of the Viewer canvas. The four chips
          (Snap, Sticky, Multi, Units) stack vertically in a top-left
          column so they don't fight for horizontal space with the
          bottom-center MainToolbar or the center status pills (which now
          sit at top:152, well below the chip column). */}
      <SnapChip />
      <StickyChip />
      <MultiChip />
      <UnitsChip />
      <MainToolbar />
      <MultiSelectInspector />
      <TranslateStatusPill />
      <ToastBar />
    </div>
  )
}
