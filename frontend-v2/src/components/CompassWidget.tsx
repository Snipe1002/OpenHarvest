/**
 * CompassWidget — small fixed-position SVG compass that shows where world
 * X / Y / Z point relative to the current camera. Reads the camera's
 * matrixWorldInverse from the R3FSceneBridge singleton each frame and
 * projects the three world axes into camera space, drawing a colored
 * arrow for each.
 *
 * Useful when the user is rotating around the scene and loses track of
 * which way is north / up / east. The compass arrows always point at
 * the same world direction, so they rotate visually as the camera does.
 *
 * Position: top-right of the viewport, just below the HUDToggle bar so
 * both stay visible whether or not the rest of the HUD is collapsed.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { getSceneRefs } from './r3fSceneBridge'

const RADIUS = 32
const SIZE = RADIUS * 2 + 8

const CONTAINER: React.CSSProperties = {
  position: 'fixed',
  // Below the chips column (LabelsChip ends at ≈ top:172). Sits flush
  // with the left edge so it doesn't fight with InspectorCard's top-
  // right anchor or the HUDToggle bar.
  top: 188,
  left: 16,
  width: SIZE,
  height: SIZE,
  zIndex: 11,
  pointerEvents: 'none',
  background: 'rgba(20, 22, 24, 0.78)',
  borderRadius: '50%',
  border: '1px solid #444',
}

interface Arrows {
  /** Each tuple: end point relative to compass center in pixels, on a 2D plane. */
  x: { dx: number; dy: number }
  y: { dx: number; dy: number }
  z: { dx: number; dy: number }
}

/**
 * Project a world-space unit vector into the compass's 2D plane via the
 * camera's view matrix. Camera-space X is right-on-screen, camera-space Y
 * is up-on-screen (so we flip its sign for SVG which has Y down). We
 * intentionally drop the camera-space Z (depth) — the compass only
 * conveys 2D direction, not foreshortening.
 */
function projectAxis(world: THREE.Vector3, viewMatrix: THREE.Matrix4): { dx: number; dy: number } {
  const v = world.clone()
  // applyMatrix4 multiplies as a position; for a direction we need to
  // strip the translation. Easiest: zero out the translation column.
  const m = viewMatrix.clone()
  m.setPosition(0, 0, 0)
  v.applyMatrix4(m)
  // Normalize the 2D projection — we want the arrow length scaled to the
  // compass radius, not falling off when the world axis points away from
  // the camera.
  const len2 = Math.hypot(v.x, v.y)
  if (len2 < 1e-6) return { dx: 0, dy: 0 }
  const scale = RADIUS / len2
  return { dx: v.x * scale, dy: -v.y * scale }
}

export default function CompassWidget() {
  const [arrows, setArrows] = useState<Arrows>({
    x: { dx: RADIUS, dy: 0 },
    y: { dx: 0, dy: -RADIUS },
    z: { dx: 0, dy: RADIUS },
  })

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const refs = getSceneRefs()
      if (refs) {
        const cam = refs.camera
        cam.updateMatrixWorld()
        const view = cam.matrixWorldInverse
        setArrows({
          x: projectAxis(new THREE.Vector3(1, 0, 0), view),
          y: projectAxis(new THREE.Vector3(0, 1, 0), view),
          z: projectAxis(new THREE.Vector3(0, 0, 1), view),
        })
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  const cx = SIZE / 2
  const cy = SIZE / 2
  return (
    <div style={CONTAINER}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <marker id="arr-x" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#ff5050" />
          </marker>
          <marker id="arr-y" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#5fd16a" />
          </marker>
          <marker id="arr-z" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#5aa8ff" />
          </marker>
        </defs>
        {/* Inner ring for orientation reference. */}
        <circle cx={cx} cy={cy} r={RADIUS - 2} fill="none" stroke="#333" strokeWidth="1" />
        {/* X axis — red. */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + arrows.x.dx}
          y2={cy + arrows.x.dy}
          stroke="#ff5050"
          strokeWidth="2"
          markerEnd="url(#arr-x)"
        />
        <text
          x={cx + arrows.x.dx * 1.18}
          y={cy + arrows.x.dy * 1.18}
          fill="#ff5050"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          X
        </text>
        {/* Y axis — green. */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + arrows.y.dx}
          y2={cy + arrows.y.dy}
          stroke="#5fd16a"
          strokeWidth="2"
          markerEnd="url(#arr-y)"
        />
        <text
          x={cx + arrows.y.dx * 1.18}
          y={cy + arrows.y.dy * 1.18}
          fill="#5fd16a"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          Y
        </text>
        {/* Z axis — blue. */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + arrows.z.dx}
          y2={cy + arrows.z.dy}
          stroke="#5aa8ff"
          strokeWidth="2"
          markerEnd="url(#arr-z)"
        />
        <text
          x={cx + arrows.z.dx * 1.18}
          y={cy + arrows.z.dy * 1.18}
          fill="#5aa8ff"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          Z
        </text>
      </svg>
    </div>
  )
}
