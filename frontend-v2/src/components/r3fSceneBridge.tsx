/**
 * R3FSceneBridge — a tiny invisible component that lives INSIDE the R3F
 * Canvas tree (mounted as a child of `<Viewer>` in App.tsx) and stashes the
 * current camera, renderer, and raycaster into a module-level singleton.
 *
 * Why: `useButtonDragHandle` is consumed both by `InspectorCard` (which IS
 * inside the R3F tree, via drei `<Html>`) AND by `MultiSelectInspector`
 * (which sits in the DOM as a sibling of the Canvas — calling `useThree()`
 * there would throw). The bridge gives the hook a single way to reach the
 * scene from either side.
 *
 * Lifecycle: `useThree()` re-runs whenever the canvas root re-renders
 * (camera change, size change, etc.), so the singleton stays current. On
 * unmount we clear the slot so stale refs can't fire stray raycasts.
 */
import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

interface SceneRefs {
  camera: THREE.Camera
  gl: THREE.WebGLRenderer
  raycaster: THREE.Raycaster
}

let _sceneRefs: SceneRefs | null = null

/**
 * Read the current scene refs. Returns null when the bridge isn't mounted
 * (during initial canvas boot, or if App.tsx forgot to render it). Callers
 * MUST handle null — typically by no-op-ing the drag.
 */
export function getSceneRefs(): SceneRefs | null {
  return _sceneRefs
}

export default function R3FSceneBridge() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const raycaster = useThree((s) => s.raycaster)

  useEffect(() => {
    _sceneRefs = { camera, gl, raycaster }
    return () => {
      _sceneRefs = null
    }
  }, [camera, gl, raycaster])

  return null
}
