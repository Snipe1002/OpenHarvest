/**
 * Tiny path-based dispatcher. Walk-mode runs as a parallel route from the
 * main 3D scene; rather than add react-router as a dependency for two pages,
 * we read `window.location.pathname` directly and re-render on popstate /
 * pushstate. The dispatcher strips the build's `<base href>` prefix so URLs
 * work whether the app is served from `/` (dev) or `/openharvest/` (prod).
 */
import { useEffect, useState } from 'react'
import App from './App'
import WalkMode from './pages/WalkMode'
import WalkReview from './pages/WalkReview'
import WebGPUGate from './components/WebGPUGate'

function currentPath(): string {
  // Strip the Vite base path so route matching is independent of deploy URL.
  // import.meta.env.BASE_URL is set by Vite at build time (defaults to '/').
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  let path = window.location.pathname
  if (base && path.startsWith(base)) path = path.slice(base.length)
  if (!path.startsWith('/')) path = '/' + path
  return path
}

export default function Router() {
  const [path, setPath] = useState<string>(() => currentPath())

  useEffect(() => {
    const handle = () => setPath(currentPath())
    window.addEventListener('popstate', handle)
    // Patch pushState/replaceState to emit popstate so in-app navigation works
    // without dropping back to a full reload. This is a well-known shim — the
    // alternative is requiring every navigation to dispatch popstate manually,
    // which is brittle.
    const origPush = window.history.pushState.bind(window.history)
    const origReplace = window.history.replaceState.bind(window.history)
    window.history.pushState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const result = origPush(data, unused, url)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return result
    }
    window.history.replaceState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const result = origReplace(data, unused, url)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return result
    }
    return () => {
      window.removeEventListener('popstate', handle)
      window.history.pushState = origPush
      window.history.replaceState = origReplace
    }
  }, [])

  // /walk-mode/<sessionId>/review
  const reviewMatch = /^\/walk-mode\/([^/]+)\/review\/?$/.exec(path)
  if (reviewMatch) {
    return <WalkReview sessionId={reviewMatch[1]} />
  }
  if (/^\/walk-mode\/?$/.test(path)) {
    return <WalkMode />
  }
  // The 3D scene (App) needs WebGPU; gate it so no-WebGPU browsers get an
  // actionable message instead of a silently-blank canvas. Walk-mode routes
  // above are camera-only and stay ungated.
  return (
    <WebGPUGate>
      <App />
    </WebGPUGate>
  )
}
