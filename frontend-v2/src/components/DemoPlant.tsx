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
import type { GardenEntity } from '../api/types'

interface DemoPlantProps {
  entity: GardenEntity
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

export default function DemoPlant({ entity }: DemoPlantProps) {
  const { x: px, y: py, z: pz } = entity.transform.position
  const stemHeight = resolveHeight(entity)
  // Leaves scale with stem height so a tall plant doesn't look stunted.
  const leafSize = Math.min(0.4, Math.max(0.1, stemHeight * 0.5))
  const stemRadius = Math.max(0.015, Math.min(0.04, stemHeight * 0.05))

  return (
    <group position={[px, py, pz]}>
      {/* Stem */}
      <mesh position={[0, stemHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[stemRadius, stemRadius, stemHeight, 8]} />
        <meshStandardMaterial color="#4a8a3a" roughness={0.8} metalness={0} />
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
    </group>
  )
}
