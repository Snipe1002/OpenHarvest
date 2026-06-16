import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/**
 * RenderKickstart — forces the Pascal Viewer's Canvas to actually paint.
 *
 * The third-party `@pascal-app/viewer` <Viewer> hardcodes its Canvas to
 * `frameloop="never"` with an *async* WebGPU `gl` factory (`await
 * renderer.init()`). With `frameloop="never"`, R3F only renders when something
 * explicitly invalidates the frame; the async renderer init resolves *after*
 * the React tree (and our garden scene) has already mounted, so nothing ever
 * triggers that first paint. Result: a healthy backend + a fully-populated
 * scene graph, but a blank gray canvas — the scene never gets drawn.
 *
 * The Viewer exposes no `frameloop` prop, so we can't override it from the
 * <Viewer> call site. Instead we mount this tiny component *inside* <Viewer>
 * (so it's under the Canvas and `useThree` sees the real R3F store) and flip
 * the loop to `"always"` ourselves once the renderer exists. We also call
 * `invalidate()` immediately to kick a frame the moment the renderer is ready,
 * covering the WebGPU-init-resolved-after-mount race directly.
 *
 * Why `"always"` rather than a one-shot `invalidate()`: the scene has live
 * elements (animated background lerp, SignalR-driven entity upserts, camera
 * orbit) that each need a frame. A continuous loop is the robust choice and
 * matches how a 3D editor viewport is expected to behave; the prior
 * `"never" + manual advance()` scheme is what left the canvas dark.
 *
 * Note: Pascal's own <FrameLimiter> child sets `frameloop: "never"` in a
 * layout effect and drives its own rAF `advance()` loop. We re-assert
 * `"always"` after mount (layout effects run before passive effects, so our
 * effect lands after FrameLimiter's) and additionally guard with a short
 * re-assertion in case the renderer/store settles a tick later.
 */
export default function RenderKickstart() {
  const gl = useThree((s) => s.gl)
  const set = useThree((s) => s.set)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    if (!gl) return
    // Flip the loop on and force an immediate frame now that the (async)
    // renderer is live.
    set({ frameloop: 'always' })
    invalidate()
    // Re-assert once more on the next macrotask in case a sibling layout
    // effect (FrameLimiter) toggled the loop back to "never" after us, or the
    // WebGPU backend finished initializing a tick later.
    const t = setTimeout(() => {
      set({ frameloop: 'always' })
      invalidate()
    }, 0)
    return () => clearTimeout(t)
  }, [gl, set, invalidate])

  return null
}
