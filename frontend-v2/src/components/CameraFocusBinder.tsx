/**
 * CameraFocusBinder — R3F-resident sibling that watches the cameraFocus
 * store flag and calls `setTarget` on the registered camera controls
 * whenever it changes. Lives inside <Viewer> so `useThree()` can find
 * `state.controls` (which drei's <CameraControls makeDefault> registers).
 *
 * Replaces the earlier ref-on-<CameraControls> approach: passing a ref
 * through Pascal's <Viewer> proxy made the post-click scene blank in
 * playwright (smoke "selecting does not blank" failed at 27KB on PR-E).
 * Reading state.controls instead avoids the proxy entirely.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useGarden } from '../store/garden'

interface ControlsLike {
  setTarget: (x: number, y: number, z: number, transition?: boolean) => Promise<unknown>
}

export default function CameraFocusBinder() {
  const focus = useGarden((s) => s.cameraFocus)
  const controls = useThree((s) => s.controls) as ControlsLike | null
  useEffect(() => {
    if (!focus || !controls?.setTarget) return
    void controls.setTarget(focus.x, focus.y, focus.z, true)
  }, [focus, controls])
  return null
}
