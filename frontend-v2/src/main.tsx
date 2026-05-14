import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Router from './Router'
import { useGarden } from './store/garden'
import { useWalkMode } from './store/walkMode'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// Expose the zustand stores on window so playwright tests (and curious
// users in DevTools) can introspect live state — current garden id,
// entity positions, selection, walk-mode session. The stores are the source
// of truth that the REST API also reflects, so reading from here avoids
// racing the wire. Cheap to expose: it's all data already accessible via
// REST/localStorage.
;(window as unknown as {
  __openharvestStore: typeof useGarden
  __openharvestWalkStore: typeof useWalkMode
}).__openharvestStore = useGarden
;(window as unknown as {
  __openharvestStore: typeof useGarden
  __openharvestWalkStore: typeof useWalkMode
}).__openharvestWalkStore = useWalkMode

createRoot(rootElement).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
