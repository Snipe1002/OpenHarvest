/**
 * DemoBed — raised garden bed: 4 wood plank walls + soil top.
 *
 * Renders from a backend `GardenEntity` whose geometry is either
 *   - kind="Box" with `size = {x, y, z}`, or
 *   - kind="Prefab" with `prefabRef in {raised-bed-wood, square-planter}` and
 *     an optional `size` override (defaults to 2m x 0.4m x 1m).
 *
 * Position comes from `entity.transform.position`. The y component is the
 * *bottom* of the frame (matching the original demo contract). Frame
 * thickness is fixed at 0.05m. Soil sits 0.02m below the frame top.
 *
 * Selection (milestone #3): clicking any plank or the soil sets the entity
 * as the active selection in the Zustand store. When selected, a drei
 * `<Outlines>` wireframe overlay highlights the bed group.
 *
 * The "Demo" name is intentional — milestone #3 will replace this with a
 * full prefab catalog. Until then, every bed-shaped entity routes through
 * here.
 */
import { Outlines } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { GardenEntity } from '../api/types'
import { useGarden } from '../store/garden'

interface DemoBedProps {
  entity: GardenEntity
}

const DEFAULT_SIZE: [number, number, number] = [2, 0.4, 1]

function resolveSize(entity: GardenEntity): [number, number, number] {
  const s = entity.geometry.size
  if (s) return [Math.max(s.x, 0.01), Math.max(s.y, 0.01), Math.max(s.z, 0.01)]
  return DEFAULT_SIZE
}

export default function DemoBed({ entity }: DemoBedProps) {
  const selectEntity = useGarden((s) => s.selectEntity)
  const isSelected = useGarden((s) => s.selectedEntityId === entity.id)

  const { x: px, y: py, z: pz } = entity.transform.position
  const [w, h, l] = resolveSize(entity)
  const t = 0.05 // plank thickness

  // Center of the bed in world space (y is mid-height).
  const cx = px
  const cy = py + h / 2
  const cz = pz

  const handleSelect = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectEntity(entity.id)
  }

  return (
    <group onPointerDown={handleSelect}>
      {/* +X plank */}
      <mesh position={[cx + w / 2 - t / 2, cy, cz]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* -X plank */}
      <mesh position={[cx - w / 2 + t / 2, cy, cz]} castShadow receiveShadow>
        <boxGeometry args={[t, h, l]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* +Z plank */}
      <mesh position={[cx, cy, cz + l / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* -Z plank */}
      <mesh position={[cx, cy, cz - l / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#6b4423" roughness={0.7} metalness={0} />
        {isSelected && <Outlines thickness={4} color="#ffaa00" />}
      </mesh>
      {/* Soil — slightly inset, top sits 0.02m below frame top */}
      <mesh position={[cx, py + h - 0.02 - (h - 0.04) / 2, cz]} receiveShadow>
        <boxGeometry args={[w - 2 * t, h - 0.04, l - 2 * t]} />
        <meshStandardMaterial color="#3a2818" roughness={1.0} metalness={0} />
      </mesh>
    </group>
  )
}
