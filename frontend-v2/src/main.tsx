import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGarden } from './store/garden'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// Expose the zustand store on window so playwright tests (and curious
// users in DevTools) can introspect live state — current garden id,
// entity positions, selection. The store is the source of truth that the
// REST API also reflects, so reading from here avoids racing the wire.
// Cheap to expose: it's all data already accessible via REST/localStorage.
;(window as unknown as { __openharvestStore: typeof useGarden }).__openharvestStore = useGarden

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
