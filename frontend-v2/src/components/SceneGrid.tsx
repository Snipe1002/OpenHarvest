/**
 * SceneGrid — Three.js gridHelper rendered on the ground plane when the
 * user has the showGrid toggle on. Gives a visual ruler with 1m / 1ft
 * divisions so beds can be eyeballed against a known scale without
 * pulling out the inspector size panel.
 *
 * Mounts inside the Viewer (R3F sibling to DemoGround). The grid sits
 * just slightly above y=0 to avoid z-fighting with the green ground
 * plane the demo scene renders. Lines are cyan-ish for legibility on
 * green.
 *
 * Sized 50m × 50m at 1m divisions — covers a ¼-acre garden plus
 * generous overshoot, with 50 grid cells in each axis.
 */
import { useGarden } from '../store/garden'

const GRID_SIZE_M = 50
const GRID_DIVISIONS = 50
const GRID_Y_OFFSET = 0.005 // 5mm above ground to win the depth fight.

export default function SceneGrid() {
  const visible = useGarden((s) => s.showGrid)
  if (!visible) return null
  return (
    <gridHelper
      args={[GRID_SIZE_M, GRID_DIVISIONS, '#4ec9ff', '#3a5a78']}
      position={[0, GRID_Y_OFFSET, 0]}
    />
  )
}
