/**
 * WebGPUGate — capability guard for the 3D scene.
 *
 * The 3D garden/house view is rendered by `@pascal-app/viewer` on top of
 * three.js's WebGPU backend (TSL nodes: SSGI, denoise, merged-outline render
 * pipeline). When a browser can't give three.js a real WebGPU device (Safari
 * without the flag, most mobile browsers, GPU-blocklisted machines, or even a
 * Chrome where `navigator.gpu` exists but `requestAdapter()` returns null),
 * three.js silently falls back to its *experimental* WebGL2 backend, where the
 * render pipeline throws `drawIndexed: Value is infinite` on both the
 * post-processing pass AND the direct fallback render. The net effect is a
 * **silently blank 3D canvas**: entities are created and tracked in the store
 * (REST + SignalR both work) but nothing ever draws, so the app looks like it
 * "doesn't respond to changes".
 *
 * Rather than present a black void with no explanation, gate the 3D routes on
 * a *real* WebGPU adapter probe and show an actionable message. This is
 * strictly additive — browsers that CAN acquire a WebGPU adapter render exactly
 * as before; only the no-real-WebGPU path, which was already broken (blank),
 * changes (now it explains itself).
 *
 * The check is the same one three.js's backend uses: `navigator.gpu` exists AND
 * `requestAdapter()` resolves to a non-null adapter. `'gpu' in navigator` alone
 * is NOT sufficient — observed cases where the property exists but the adapter
 * is null, which is exactly the broken WebGL2-fallback path.
 *
 * Walk-mode (phone camera capture) does NOT use the 3D Viewer and is therefore
 * NOT gated — a phone with no WebGPU can still capture and stage a walk.
 */
import { useEffect, useState, type ReactNode } from 'react'

type GpuStatus = 'checking' | 'ok' | 'unavailable'

/** Probe for a *usable* WebGPU device (not just the API surface). Returns true
 *  only when an adapter can actually be acquired. */
export async function probeWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (!gpu) return false
    const adapter = await gpu.requestAdapter()
    return adapter != null
  } catch {
    return false
  }
}

export default function WebGPUGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GpuStatus>('checking')

  useEffect(() => {
    let cancelled = false
    void probeWebGPU().then((ok) => {
      if (!cancelled) setStatus(ok ? 'ok' : 'unavailable')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // While probing, render nothing (the probe resolves within a frame on capable
  // devices; the brief blank avoids a flash of the fallback-message on machines
  // that turn out to be fine).
  if (status === 'checking') return null
  if (status === 'ok') return <>{children}</>

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a1a',
        color: '#ddd',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.5 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
        <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>
          3D view needs WebGPU
        </h1>
        <p style={{ fontSize: 14, color: '#aaa', margin: '0 0 16px' }}>
          The garden &amp; house planner renders with WebGPU, which this browser
          can&apos;t provide a graphics device for. Open OpenHarvest in a recent{' '}
          <strong>desktop Chrome or Edge</strong> (or enable WebGPU in your
          browser&apos;s flags) to use the 3D layout.
        </p>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          Walk-mode photo capture still works here — visit{' '}
          <code style={{ color: '#7fd' }}>/walk-mode</code> to capture your yard
          from a phone.
        </p>
      </div>
    </div>
  )
}
