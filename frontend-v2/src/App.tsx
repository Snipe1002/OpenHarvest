import { useEffect } from 'react'
import { Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import AddToolbar from './components/AddToolbar'
import ClearHouseButton from './components/ClearHouseButton'
import DemoGround from './components/DemoGround'
import EntityRenderer from './components/EntityRenderer'
import InspectorCard from './components/InspectorCard'
import SampleBuilding from './components/SampleBuilding'
import ToastBar from './components/ToastBar'
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
 *      Replaces the previous fixed-position EditPanel.
 *
 * `SampleBuilding` seeds Pascal's scene store with a placeholder room — Pascal's
 * Viewer requires building geometry to render anything. The `<ClearHouseButton>`
 * wipes those walls at runtime.
 */
export default function App() {
  const currentGardenId = useGarden((s) => s.currentGardenId)
  const setCurrentGarden = useGarden((s) => s.setCurrentGarden)
  const entities = useGarden((s) => s.entities)

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

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SampleBuilding />
      <Viewer selectionManager="custom">
        <CameraControls />
        <DemoGround />
        {Object.values(entities).map((e) => (
          <EntityRenderer key={e.id} entity={e} />
        ))}
        {/* Inspector is anchored to the selected entity in 3D space — drei's
            Html mounts it as DOM but tracks the world position. */}
        <InspectorCard />
      </Viewer>
      {/* HTML overlays — siblings of the Viewer canvas. */}
      <ClearHouseButton />
      <AddToolbar />
      <ToastBar />
    </div>
  )
}
