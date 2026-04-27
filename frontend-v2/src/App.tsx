import { useEffect } from 'react'
import { Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import AddToolbar from './components/AddToolbar'
import DemoGround from './components/DemoGround'
import EditPanel from './components/EditPanel'
import EntityRenderer from './components/EntityRenderer'
import SampleBuilding from './components/SampleBuilding'
import { listGardenIds } from './api/client'
import { connect, disconnect } from './api/signalr'
import { useGarden } from './store/garden'

/**
 * App root: full-viewport Pascal Viewer with our garden components mounted as
 * R3F siblings inside Pascal's scene.
 *
 * Wiring (milestone #2):
 *  1. On mount: if a garden id is persisted in localStorage, re-load it.
 *     Otherwise fetch the server's garden id list and pick the first.
 *  2. Whenever `currentGardenId` changes, open a SignalR connection and
 *     join that garden's group. Live entity upserts/deletes flow into the
 *     Zustand store automatically.
 *  3. Render every entity from the store via `<EntityRenderer>`, which
 *     dispatches to the right primitive (bed / plant / placeholder).
 *
 * `SampleBuilding` still seeds Pascal's scene store with a placeholder room
 * so the viewer renders something on first paint. Milestone #3+ will replace
 * it with backend-driven structures.
 */
export default function App() {
  const currentGardenId = useGarden((s) => s.currentGardenId)
  const setCurrentGarden = useGarden((s) => s.setCurrentGarden)
  const entities = useGarden((s) => s.entities)

  // 1. Pick / load garden on mount.
  useEffect(() => {
    let cancelled = false
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
    // We deliberately want the bootstrap effect to only run on mount.
    // currentGardenId changes are handled by the SignalR effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. SignalR connection — opens / switches whenever the active garden changes.
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

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SampleBuilding />
      <Viewer selectionManager="custom">
        <CameraControls />
        <DemoGround />
        {Object.values(entities).map((e) => (
          <EntityRenderer key={e.id} entity={e} />
        ))}
      </Viewer>
      {/* HTML overlays — siblings of the Viewer canvas, not R3F children. */}
      <AddToolbar />
      <EditPanel />
    </div>
  )
}
