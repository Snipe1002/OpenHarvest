/**
 * ArrangeAnchor — draggable 3D flag pole that marks the origin point of
 * the arrange-wizard layout. Visible whenever the arrange panel is open;
 * defaults to the current selection centroid. Dragging it relocates the
 * grid / ring around its new XZ position so the user can pin a layout
 * to a specific spot on the ground (e.g. the corner of an existing
 * planter) instead of always centering on the selection.
 *
 * Visual: a thin yellow pole with a triangular flag, ~80cm tall. Sits on
 * the ground (y=0) at the anchor world position. raycasts intercept
 * pointer events on the pole/flag mesh; the rest of the scene still
 * receives clicks normally.
 *
 * Drag pipeline mirrors useTranslateDrag:
 *   1. pointerdown — setPointerCapture, set `buttonDragActive` (camera
 *      orbit pauses), record the offset between the click point and the
 *      pole's base so the cursor stays glued to where the user grabbed.
 *   2. pointermove — raycast to ground plane, snap to the active grid,
 *      write the new XZ to `arrangeAnchor` in the store. The arrange
 *      wizard's live-preview useEffect re-runs on the change and the
 *      previewed layout slides along with the pole.
 *   3. pointerup — release capture, clear `buttonDragActive`.
 */
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import { useGarden } from '../store/garden'
import { snapXZ } from './houseHelpers'

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const POLE_HEIGHT = 0.8
const POLE_RADIUS = 0.025
const FLAG_W = 0.25
const FLAG_H = 0.15

export default function ArrangeAnchor() {
  const previewActive = useGarden((s) => s.arrangePreviewActive)
  const anchor = useGarden((s) => s.arrangeAnchor)
  const setAnchor = useGarden((s) => s.setArrangeAnchor)
  const setButtonDragActive = useGarden((s) => s.setButtonDragActive)
  // Selection centroid is the fallback origin when the user hasn't
  // explicitly placed an anchor. The selector returns a fresh object on
  // every render, so we wrap it in `useShallow` — otherwise zustand v5's
  // default Object.is check sees a "new" reference each time and the
  // re-render cycles forever (React error #185, hit on 2026-04-30 in
  // playwright after PR-B before the wrap was added).
  const centroid = useGarden(
    useShallow((s) => {
      if (s.primarySelectedIds.length === 0) return null
      let cx = 0
      let cz = 0
      let n = 0
      for (const id of s.primarySelectedIds) {
        const e = s.entities[id]
        if (!e) continue
        cx += e.transform.position.x
        cz += e.transform.position.z
        n++
      }
      if (n === 0) return null
      return { x: cx / n, z: cz / n }
    }),
  )

  // Drag state — kept in refs so we don't trigger re-renders mid-drag.
  // The pointer-capture target is the canvas DOM node the R3F event hit.
  const dragRef = useRef<{
    captureTarget: { releasePointerCapture: (id: number) => void } | null
    pointerId: number | null
  }>({ captureTarget: null, pointerId: null })
  const [dragging, setDragging] = useState(false)

  const pos = useMemo(() => anchor ?? centroid, [anchor, centroid])

  if (!previewActive || !pos) return null

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.isPrimary === false) return
    e.stopPropagation()
    const target = e.target as unknown as { setPointerCapture: (id: number) => void; releasePointerCapture: (id: number) => void }
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      /* canvas might already have capture; ignore */
    }
    dragRef.current = { captureTarget: target, pointerId: e.pointerId }
    setButtonDragActive(true)
    setDragging(true)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return
    e.stopPropagation()
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(GROUND_PLANE, hit)) return
    const snap = useGarden.getState().snap
    const [sx, sz] = snapXZ(hit.x, hit.z, snap)
    setAnchor({ x: sx, z: sz })
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const { captureTarget, pointerId } = dragRef.current
    if (captureTarget && pointerId !== null) {
      try {
        captureTarget.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
    }
    dragRef.current = { captureTarget: null, pointerId: null }
    setButtonDragActive(false)
    setDragging(false)
  }

  return (
    <group
      position={[pos.x, 0, pos.z]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Pole */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 8]} />
        <meshStandardMaterial
          color={dragging ? '#ffe600' : '#ffaa00'}
          roughness={0.5}
          metalness={0.2}
          emissive={dragging ? '#ff8800' : '#332200'}
          emissiveIntensity={dragging ? 0.4 : 0.2}
        />
      </mesh>
      {/* Triangular flag attached to the top of the pole */}
      <mesh
        position={[FLAG_W / 2 + POLE_RADIUS, POLE_HEIGHT - FLAG_H / 2, 0]}
        rotation={[0, 0, 0]}
        castShadow
      >
        <planeGeometry args={[FLAG_W, FLAG_H]} />
        <meshStandardMaterial
          color={dragging ? '#ffe600' : '#ffaa00'}
          side={THREE.DoubleSide}
          roughness={0.6}
        />
      </mesh>
      {/* Base disk so the user has a wider tap target on the ground */}
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 16]} />
        <meshBasicMaterial color="#ffaa00" transparent opacity={0.4} />
      </mesh>
    </group>
  )
}
