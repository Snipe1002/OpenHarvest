/**
 * DemoBed — raised garden bed: 4 wood plank walls + soil top.
 *
 * Renders from a backend `GardenEntity`. Geometry is either:
 *   - kind="Box" with `size = {x, y, z}`, or
 *   - kind="Prefab" with `prefabRef in {raised-bed-wood, square-planter}` and
 *     an optional `size` override (defaults to 2m × 0.4m × 1m).
 *
 * Position and rotation come from `entity.transform`. Position is the
 * *bottom-center* of the frame. Rotation is a quaternion {x, y, z, w} on
 * the wire and gets applied to the group via Three's `Quaternion`.
 *
 * Selection: clicking any plank or the soil sets the entity as the active
 * selection in the Zustand store. When selected, drei `<Outlines>` overlays
 * highlight every plank.
 */
import * as THREE from 'three'
import { useMemo, type ReactNode } from 'react'
import { Outlines } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { GardenEntity, Quaternion } from '../api/types'
import { useGarden } from '../store/garden'
import { useEntityTapVsLongPress } from './useEntityTapVsLongPress'
import { useGroupTranslateDrag, useTranslateDrag } from './useTranslateDrag'

interface DemoBedProps {
  entity: GardenEntity
  /** Hierarchical children — typically more <EntityRenderer> nodes for plants
   *  parented to this bed. Mounted inside the bed's transform group so Three's
   *  scene graph applies the bed's position/rotation to them automatically. */
  children?: ReactNode
}

const DEFAULT_SIZE: [number, number, number] = [2, 0.4, 1]

function resolveSize(entity: GardenEntity): [number, number, number] {
  const s = entity.geometry.size
  if (s) return [Math.max(s.x, 0.01), Math.max(s.y, 0.01), Math.max(s.z, 0.01)]
  return DEFAULT_SIZE
}

function quaternionToEuler(q: Quaternion): [number, number, number] {
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w)
  const e = new THREE.Euler().setFromQuaternion(tq, 'XYZ')
  return [e.x, e.y, e.z]
}

export default function DemoBed({ entity, children }: DemoBedProps) {
  const isSelected = useGarden((s) => s.selectedEntityIds.includes(entity.id))
  const isPrimarySelected = useGarden((s) => s.primarySelectedIds.includes(entity.id))
  const isMultiSelected = useGarden(
    (s) => s.primarySelectedIds.length >= 2 && s.primarySelectedIds.includes(entity.id),
  )
  const isTranslating = useGarden((s) => s.translateModeId === entity.id)
  const isGroupTranslating = useGarden(
    (s) => s.groupTranslateActive && s.selectedEntityIds.includes(entity.id),
  )
  const drag = useTranslateDrag(entity)
  const groupDrag = useGroupTranslateDrag(entity)
  const tap = useEntityTapVsLongPress(entity.id)

  const [w, h, l] = resolveSize(entity)
  const t = 0.05 // plank thickness

  const groupPosition: [number, number, number] = useMemo(
    () => [entity.transform.position.x, entity.transform.position.y + h / 2, entity.transform.position.z],
    [entity.transform.position.x, entity.transform.position.y, entity.transform.position.z, h],
  )
  const groupRotation = useMemo(
    () => quaternionToEuler(entity.transform.rotation),
    [
      entity.transform.rotation.x,
      entity.transform.rotation.y,
      entity.transform.rotation.z,
      entity.transform.rotation.w,
    ],
  )

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Multi-touch guard: only act on the primary pointer. The secondary
    // pointer of a pinch-zoom must pass through to drei's CameraControls
    // so the user can pinch ON an entity to zoom (otherwise stopPropagation
    // starves the camera and the render goes blank).
    if (e.nativeEvent.isPrimary === false) return

    if (isTranslating) {
      // Single-entity drag takes over — entity is already selected.
      drag.onPointerDown(e)
      return
    }
    if (isGroupTranslating) {
      // Group drag — leader is whichever selected entity received the down.
      groupDrag.onPointerDown(e)
      return
    }
    e.stopPropagation()
    // Selection now fires on pointer-up via the tap-vs-long-press helper —
    // arming the timer here lets us distinguish a quick tap (extend) from a
    // 500ms hold (self-only). If neither drag path took over, this is the
    // selection arm of the gesture.
    tap.onTapPointerDown(e)
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.isPrimary === false) return
    if (isTranslating) {
      drag.onPointerUp(e)
      return
    }
    if (isGroupTranslating) {
      groupDrag.onPointerUp(e)
      return
    }
    // Pure selection branch: fire the tap (extend) iff the timer is still
    // pending; otherwise the long-press already fired during the hold.
    tap.onTapPointerUp(e)
  }

  // Outline visual distinguishes three states:
  //   - primary multi-select (>=2 explicit picks):  thick cyan
  //   - primary single-select:                        thick orange
  //   - extension (descendant pulled in by extend):   thin dimmed orange/cyan
  // Distinguishing extension from primary helps the user see "I selected
  // the bed; the plants came along for free" without confusing it with
  // shift-click multi-select.
  const isExtension = isSelected && !isPrimarySelected
  const outlineColor = isExtension
    ? isMultiSelected
      ? '#3a8acc'
      : '#cc7a00'
    : isMultiSelected
      ? '#4ec9ff'
      : '#ffaa00'
  // drei's <Outlines thickness> is in WORLD UNITS, not pixels — values like
  // "4" render the outline 4 meters thick, which projects offscreen and
  // makes the glow invisible. ~4cm reads as a chunky highlight at typical
  // garden scale; extension picks get a thinner outline so the user can
  // tell primaries from descendants pulled in by extend-mode.
  const outlineThickness = isExtension ? 0.02 : 0.04

  // All plank/soil coords are RELATIVE to the group center (which sits at the
  // bed's mid-height). Rotation on the group then rotates the whole bed
  // together.
  return (
    <group
      position={groupPosition}
      rotation={groupRotation}
      onPointerDown={handlePointerDown}
      onPointerMove={
        isTranslating ? drag.onPointerMove : isGroupTranslating ? groupDrag.onPointerMove : undefined
      }
      onPointerUp={handlePointerUp}
      onPointerCancel={tap.onTapPointerCancel}
      onPointerLeave={tap.onTapPointerCancel}
    >
      {/* +X plank */}
      <mesh position={[w / 2 - t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={outlineThickness} color={outlineColor} />}
      </mesh>
      {/* -X plank */}
      <mesh position={[-w / 2 + t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={outlineThickness} color={outlineColor} />}
      </mesh>
      {/* +Z plank */}
      <mesh position={[0, 0, l / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={outlineThickness} color={outlineColor} />}
      </mesh>
      {/* -Z plank */}
      <mesh position={[0, 0, -l / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={outlineThickness} color={outlineColor} />}
      </mesh>
      {/* Soil — slightly inset, top sits 0.02m below frame top */}
      <mesh position={[0, h / 2 - 0.02 - (h - 0.04) / 2, 0]} receiveShadow>
        <boxGeometry args={[w - 2 * t, h - 0.04, l - 2 * t]} />
        <meshStandardMaterial color="#3a2818" roughness={1.0} metalness={0} />
      </mesh>
      {/* Hierarchical children. The outer group is shifted up by h/2 so its
          center sits at the bed's mid-height; we offset back down by h/2 here
          so the child sub-group origin sits at the bed's BOTTOM, matching the
          convention used by `catalog.surface.y` (measured from the base). A
          child plant with local position { x, y: surface.y, z } therefore
          lands ON TOP of the bed at the soil line. */}
      <group position={[0, -h / 2, 0]}>{children}</group>
    </group>
  )
}
