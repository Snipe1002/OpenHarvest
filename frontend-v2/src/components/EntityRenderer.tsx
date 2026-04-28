/**
 * EntityRenderer — dispatches a backend `GardenEntity` to the right
 * presentation component based on its kind / geometry / prefabRef.
 *
 * Dispatch table for milestone #2 (read-only render of live data):
 *   - Bed primitives (kind === 'Bed', or prefabRef in BED_PREFABS) -> <DemoBed>
 *   - Plant primitives (kind === 'Plant', or prefabRef in PLANT_PREFABS) -> <DemoPlant>
 *   - Other known prefabs (terracotta-pot, tomato-cage, greenhouse-arch, etc.)
 *     -> placeholder cube + label until milestone #3 ships the catalog.
 *   - House primitives (wall-segment, floor-slab, door, window, shelf-wall)
 *     -> SKIPPED with a console.warn. Pascal owns architectural geometry; we
 *     have not decided yet how to bridge them through Pascal's scene store.
 *   - Anything else -> magenta debug cube + label, so unhandled cases surface
 *     visually instead of disappearing.
 *
 * Position is read from `entity.transform.position`. If the position is
 * obviously bogus (NaN), we log a warning and skip the entity so a single
 * malformed record can't break the whole scene.
 *
 * Hierarchy: `children` (typically more `<EntityRenderer>` nodes for parented
 * entities) is forwarded down into the primitive's top-level `<group>`. That
 * way Three's scene graph multiplies parent/child transforms automatically —
 * a child's `entity.transform.position` is interpreted as parent-LOCAL coords.
 * Moving the parent moves children with no manual cascade work.
 */
import type { ReactNode } from 'react'
import { Outlines, Text } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import DemoBed from './DemoBed'
import DemoPlant from './DemoPlant'
import type { GardenEntity, Vector3 } from '../api/types'
import { useGarden } from '../store/garden'
import { useGroupTranslateDrag, useTranslateDrag } from './useTranslateDrag'

const BED_PREFABS = new Set(['raised-bed-wood', 'square-planter'])
const PLANT_PREFABS = new Set(['tomato-cage'])
// Known prefab slugs that aren't beds/plants — these get a labeled placeholder
// cube until milestone #3 ships the real catalog. Source: v1's
// `wwwroot/lib/prefabs.js` and the auto-tag map in GardensController.cs.
const KNOWN_PREFABS = new Set([
  'terracotta-pot',
  'greenhouse-arch',
])
// House primitives are Pascal's territory. Skip with a warning until we have
// a plan for surfacing them through Pascal's scene store rather than R3F.
const HOUSE_PRIMITIVES = new Set([
  'wall-segment',
  'floor-slab',
  'door',
  'window',
  'shelf-wall',
])

function isFinitePosition(p: Vector3 | undefined | null): p is Vector3 {
  if (!p) return false
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
}

function inferRole(entity: GardenEntity): 'bed' | 'plant' | 'known-prefab' | 'house' | 'unknown' {
  const slug = entity.geometry.prefabRef ?? null
  if (slug && HOUSE_PRIMITIVES.has(slug)) return 'house'
  if (slug && BED_PREFABS.has(slug)) return 'bed'
  if (slug && PLANT_PREFABS.has(slug)) return 'plant'
  if (slug && KNOWN_PREFABS.has(slug)) return 'known-prefab'

  // Fall back on EntityKind for non-prefab geometry (Box / Cylinder etc.).
  if (entity.kind === 'Bed') return 'bed'
  if (entity.kind === 'Plant') return 'plant'
  return 'unknown'
}

export default function EntityRenderer({
  entity,
  children,
}: {
  entity: GardenEntity
  /** Child <EntityRenderer> nodes for entities whose `parentId === entity.id`.
   *  Forwarded into the primitive's top-level <group> so Three's scene graph
   *  multiplies the parent transform onto every child for free. */
  children?: ReactNode
}) {
  const pos = entity.transform?.position
  if (!isFinitePosition(pos)) {
    console.warn('[EntityRenderer] entity has no usable position', entity.id, entity.name)
    return null
  }

  const role = inferRole(entity)
  switch (role) {
    case 'bed':
      return <DemoBed entity={entity}>{children}</DemoBed>
    case 'plant':
      return <DemoPlant entity={entity}>{children}</DemoPlant>
    case 'known-prefab':
      return <PrefabPlaceholder entity={entity}>{children}</PrefabPlaceholder>
    case 'house':
      console.warn(
        '[EntityRenderer] skipping house primitive (Pascal-owned)',
        entity.geometry.prefabRef,
        entity.id,
      )
      return null
    case 'unknown':
    default:
      return <UnknownDebugCube entity={entity}>{children}</UnknownDebugCube>
  }
}

function PrefabPlaceholder({ entity, children }: { entity: GardenEntity; children?: ReactNode }) {
  const selectEntity = useGarden((s) => s.selectEntity)
  const isSelected = useGarden((s) => s.selectedEntityIds.includes(entity.id))
  const isMultiSelected = useGarden(
    (s) => s.selectedEntityIds.length >= 2 && s.selectedEntityIds.includes(entity.id),
  )
  const isTranslating = useGarden((s) => s.translateModeId === entity.id)
  const isGroupTranslating = useGarden(
    (s) => s.groupTranslateActive && s.selectedEntityIds.includes(entity.id),
  )
  const drag = useTranslateDrag(entity)
  const groupDrag = useGroupTranslateDrag(entity)
  const { x, y, z } = entity.transform.position
  const slug = entity.geometry.prefabRef ?? entity.kind
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Multi-touch guard: secondary pointers fall through so pinch-zoom on
    // an entity reaches drei's CameraControls.
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
    const { multiSelectMode } = useGarden.getState()
    const additive = e.nativeEvent.shiftKey || multiSelectMode
    selectEntity(entity.id, additive)
  }
  const outlineColor = isMultiSelected ? '#4ec9ff' : '#ffaa00'
  return (
    <group
      position={[x, y, z]}
      onPointerDown={handlePointerDown}
      onPointerMove={
        isTranslating ? drag.onPointerMove : isGroupTranslating ? groupDrag.onPointerMove : undefined
      }
      onPointerUp={
        isTranslating ? drag.onPointerUp : isGroupTranslating ? groupDrag.onPointerUp : undefined
      }
    >
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#a08c5e" roughness={0.6} metalness={0} />
        {isSelected && <Outlines thickness={4} color={outlineColor} />}
      </mesh>
      <Text
        position={[0, 0.85, 0]}
        fontSize={0.12}
        color="#1a1a1a"
        anchorX="center"
        anchorY="bottom"
      >
        {slug}
      </Text>
      {children}
    </group>
  )
}

function UnknownDebugCube({ entity, children }: { entity: GardenEntity; children?: ReactNode }) {
  const selectEntity = useGarden((s) => s.selectEntity)
  const isSelected = useGarden((s) => s.selectedEntityIds.includes(entity.id))
  const isMultiSelected = useGarden(
    (s) => s.selectedEntityIds.length >= 2 && s.selectedEntityIds.includes(entity.id),
  )
  const isTranslating = useGarden((s) => s.translateModeId === entity.id)
  const isGroupTranslating = useGarden(
    (s) => s.groupTranslateActive && s.selectedEntityIds.includes(entity.id),
  )
  const drag = useTranslateDrag(entity)
  const groupDrag = useGroupTranslateDrag(entity)
  const { x, y, z } = entity.transform.position
  // Show whatever is most descriptive — prefer prefab slug, fall back to kind.
  const label = entity.geometry.prefabRef ?? `${entity.kind}:${entity.geometry.kind}`
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Multi-touch guard: secondary pointers fall through so pinch-zoom on
    // an entity reaches drei's CameraControls.
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
    const { multiSelectMode } = useGarden.getState()
    const additive = e.nativeEvent.shiftKey || multiSelectMode
    selectEntity(entity.id, additive)
  }
  const outlineColor = isMultiSelected ? '#4ec9ff' : '#ffaa00'
  return (
    <group
      position={[x, y, z]}
      onPointerDown={handlePointerDown}
      onPointerMove={
        isTranslating ? drag.onPointerMove : isGroupTranslating ? groupDrag.onPointerMove : undefined
      }
      onPointerUp={
        isTranslating ? drag.onPointerUp : isGroupTranslating ? groupDrag.onPointerUp : undefined
      }
    >
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color="#ff00ff" roughness={0.5} metalness={0} />
        {isSelected && <Outlines thickness={4} color={outlineColor} />}
      </mesh>
      <Text
        position={[0, 0.55, 0]}
        fontSize={0.1}
        color="#ff00ff"
        anchorX="center"
        anchorY="bottom"
      >
        {label}
      </Text>
      {children}
    </group>
  )
}
