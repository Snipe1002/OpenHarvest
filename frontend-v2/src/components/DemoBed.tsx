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
import { useMemo } from 'react'
import { Outlines } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { GardenEntity, Quaternion } from '../api/types'
import { useGarden } from '../store/garden'
import { useTranslateDrag } from './useTranslateDrag'

interface DemoBedProps {
  entity: GardenEntity
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

export default function DemoBed({ entity }: DemoBedProps) {
  const selectEntity = useGarden((s) => s.selectEntity)
  const isSelected = useGarden((s) => s.selectedEntityId === entity.id)
  const isTranslating = useGarden((s) => s.translateModeId === entity.id)
  const drag = useTranslateDrag(entity)

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
    if (isTranslating) {
      // Drag takes over — entity is already selected, no selection re-fire.
      drag.onPointerDown(e)
      return
    }
    e.stopPropagation()
    selectEntity(entity.id)
  }

  // All plank/soil coords are RELATIVE to the group center (which sits at the
  // bed's mid-height). Rotation on the group then rotates the whole bed
  // together.
  return (
    <group
      position={groupPosition}
      rotation={groupRotation}
      onPointerDown={handlePointerDown}
      onPointerMove={isTranslating ? drag.onPointerMove : undefined}
      onPointerUp={isTranslating ? drag.onPointerUp : undefined}
    >
      {/* +X plank */}
      <mesh position={[w / 2 - t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* -X plank */}
      <mesh position={[-w / 2 + t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* +Z plank */}
      <mesh position={[0, 0, l / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* -Z plank */}
      <mesh position={[0, 0, -l / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* Soil — slightly inset, top sits 0.02m below frame top */}
      <mesh position={[0, h / 2 - 0.02 - (h - 0.04) / 2, 0]} receiveShadow>
        <boxGeometry args={[w - 2 * t, h - 0.04, l - 2 * t]} />
        <meshStandardMaterial color="#3a2818" roughness={1.0} metalness={0} />
      </mesh>
    </group>
  )
}
