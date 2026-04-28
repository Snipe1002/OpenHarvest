/**
 * DemoPlant — stylized stem + 3 angled leaves.
 *
 * Renders from a backend `GardenEntity` whose geometry is typically Cylinder
 * (radius + height) but Prefab plant slugs (e.g. "tomato-cage") will also
 * route here until milestone #3 adds a proper prefab catalog.
 *
 * Stem height resolves from (in priority order):
 *   1. The most recent `growth.events[].heightInches` (converted to meters)
 *   2. `geometry.height`
 *   3. The cylinder default (0.4m)
 *
 * Position comes from `entity.transform.position` and is interpreted as the
 * stem base (y = ground at the plant's location).
 */
import * as THREE from 'three'
import { useMemo, type ReactNode } from 'react'
import { Outlines } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { GardenEntity, Quaternion } from '../api/types'
import { useGarden } from '../store/garden'
import { useEntityTapVsLongPress } from './useEntityTapVsLongPress'
import { useGroupTranslateDrag, useTranslateDrag } from './useTranslateDrag'

function quaternionToEuler(q: Quaternion): [number, number, number] {
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w)
  const e = new THREE.Euler().setFromQuaternion(tq, 'XYZ')
  return [e.x, e.y, e.z]
}

interface DemoPlantProps {
  entity: GardenEntity
  /** Hierarchical children mounted inside the plant's transform group. Plants
   *  rarely host children today, but kept for symmetry with other primitives. */
  children?: ReactNode
}

const DEFAULT_HEIGHT = 0.4
const INCHES_TO_METERS = 0.0254

function resolveHeight(entity: GardenEntity): number {
  const events = entity.growth?.events
  if (events && events.length > 0) {
    // Walk newest -> oldest looking for a real height reading.
    for (let i = events.length - 1; i >= 0; i--) {
      const h = events[i]?.heightInches
      if (typeof h === 'number' && h > 0) return h * INCHES_TO_METERS
    }
  }
  if (typeof entity.geometry.height === 'number' && entity.geometry.height > 0) {
    return entity.geometry.height
  }
  return DEFAULT_HEIGHT
}

export default function DemoPlant({ entity, children }: DemoPlantProps) {
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

  const { x: px, y: py, z: pz } = entity.transform.position
  const stemHeight = resolveHeight(entity)
  // Leaves scale with stem height so a tall plant doesn't look stunted.
  const leafSize = Math.min(0.4, Math.max(0.1, stemHeight * 0.5))
  const stemRadius = Math.max(0.015, Math.min(0.04, stemHeight * 0.05))

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
    // Multi-touch guard — only act on the primary pointer; secondary
    // pointers must reach drei's CameraControls so pinch-zoom on an
    // entity works without starving the camera.
    if (e.nativeEvent.isPrimary === false) return

    if (isTranslating) {
      drag.onPointerDown(e)
      return
    }
    if (isGroupTranslating) {
      groupDrag.onPointerDown(e)
      return
    }
    e.stopPropagation()
    // Selection-arm: distinguish tap (extend) from long-press (self-only).
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
    tap.onTapPointerUp(e)
  }

  // See DemoBed for the full reasoning on the three outline states. Plants
  // are typically descendants — when the user taps a parent in extend mode
  // they get the dimmed/thin outline, signaling "selection cascaded here".
  const isExtension = isSelected && !isPrimarySelected
  const outlineColor = isExtension
    ? isMultiSelected
      ? '#3a8acc'
      : '#cc7a00'
    : isMultiSelected
      ? '#4ec9ff'
      : '#ffaa00'
  const outlineThickness = isExtension ? 2 : 4

  return (
    <group
      position={[px, py, pz]}
      rotation={groupRotation}
      onPointerDown={handlePointerDown}
      onPointerMove={
        isTranslating ? drag.onPointerMove : isGroupTranslating ? groupDrag.onPointerMove : undefined
      }
      onPointerUp={handlePointerUp}
      onPointerCancel={tap.onTapPointerCancel}
      onPointerLeave={tap.onTapPointerCancel}
    >
      {/* Stem */}
      <mesh position={[0, stemHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[stemRadius, stemRadius, stemHeight, 8]} />
        <meshStandardMaterial color="#4a8a3a" roughness={0.8} metalness={0} />
        {isSelected && <Outlines thickness={outlineThickness} color={outlineColor} />}
      </mesh>
      {/* Leaf 1 */}
      <mesh position={[leafSize / 2, stemHeight * 0.85, 0]} rotation={[0, 0, Math.PI / 6]} castShadow>
        <planeGeometry args={[leafSize, leafSize]} />
        <meshStandardMaterial
          color="#4a8a3a"
          roughness={0.7}
          metalness={0}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Leaf 2 */}
      <mesh
        position={[-leafSize / 2, stemHeight * 0.7, 0]}
        rotation={[0, Math.PI / 3, -Math.PI / 5]}
        castShadow
      >
        <planeGeometry args={[leafSize, leafSize]} />
        <meshStandardMaterial
          color="#4a8a3a"
          roughness={0.7}
          metalness={0}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Leaf 3 */}
      <mesh
        position={[0, stemHeight * 0.55, leafSize / 2]}
        rotation={[Math.PI / 5, Math.PI / 2, 0]}
        castShadow
      >
        <planeGeometry args={[leafSize, leafSize]} />
        <meshStandardMaterial
          color="#4a8a3a"
          roughness={0.7}
          metalness={0}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      {children}
    </group>
  )
}
