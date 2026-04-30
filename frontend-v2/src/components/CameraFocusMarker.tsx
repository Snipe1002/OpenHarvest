/**
 * CameraFocusMarker — small 3D pin rendered at the world position the
 * camera is currently orbiting around. Mounted inside the Viewer as a
 * sibling of the other R3F components. Only renders while
 * `cameraFocus` is set; CameraFocusButton clears it on toggle-off.
 *
 * Visual: an orange disc on the ground plus a thin pole sticking up,
 * mirroring the ArrangeAnchor styling so the user reads it as "this
 * point is pinned for the camera." raycast nulled so the marker doesn't
 * intercept selection clicks.
 */
import { useGarden } from '../store/garden'

const POLE_HEIGHT = 0.5
const POLE_RADIUS = 0.02

export default function CameraFocusMarker() {
  const focus = useGarden((s) => s.cameraFocus)
  if (!focus) return null
  return (
    <group position={[focus.x, focus.y, focus.z]} raycast={() => null}>
      <mesh position={[0, POLE_HEIGHT / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 8]} />
        <meshBasicMaterial color="#ffaa00" />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[0, 0, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.18, 0.18, 0.01, 24]} />
        <meshBasicMaterial color="#ffaa00" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, POLE_HEIGHT, 0]} raycast={() => null}>
        <sphereGeometry args={[0.04, 12, 8]} />
        <meshBasicMaterial color="#ffe600" />
      </mesh>
    </group>
  )
}
