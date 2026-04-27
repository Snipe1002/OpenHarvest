/**
 * DemoGround — large flat grass plane. Receives shadows.
 *
 * Owns two pointer responsibilities for milestone #3's editing loop:
 *   1. Clearing the active selection when the user clicks empty ground
 *      (and no placement is active).
 *   2. Spawning a new entity at the click point when placement mode is on.
 *
 * Camera-control coexistence: drei's `<CameraControls>` shares pointer events
 * with R3F. To stop a small camera nudge from registering as a place/click,
 * we record the pointer-down screen position and only treat the gesture as a
 * "click" if the pointer-up lands within DRAG_THRESHOLD_PX. Any larger
 * displacement is treated as a camera drag and ignored here.
 *
 * We use `onPointerUp` (not `onPointerDown`) on purpose: the camera control
 * needs the down event to start its drag, and we only want to act when the
 * gesture actually was a click rather than a drag.
 */
import { useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { ApiError, createEntity } from '../api/client'
import type {
  CreateEntityRequest,
  GardenEntity,
  Geometry,
  Transform,
} from '../api/types'
import type { PlacementType } from '../store/garden'
import { useGarden } from '../store/garden'

/** Maximum screen-space movement (px) between pointer-down and pointer-up
 *  for the gesture to count as a "click" rather than a camera drag. 6px gives
 *  trackpad / touchscreen users some slop without misclassifying real clicks. */
const DRAG_THRESHOLD_PX = 6

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
}

function defaultBedGeometry(): Geometry {
  return { kind: 'Box', size: { x: 2, y: 0.4, z: 1 } }
}

function defaultPlantGeometry(): Geometry {
  return { kind: 'Cylinder', radius: 0.04, height: 0.4 }
}

function defaultPrefabGeometry(slug: string): Geometry {
  return {
    kind: 'Prefab',
    prefabRef: slug,
    size: { x: 0.4, y: 0.5, z: 0.4 },
  }
}

function buildCreateRequest(
  type: PlacementType,
  point: { x: number; y: number; z: number },
  prefabSlug: string | null | undefined,
): CreateEntityRequest {
  const transform: Transform = {
    ...IDENTITY_TRANSFORM,
    position: { x: point.x, y: point.y, z: point.z },
  }
  switch (type) {
    case 'bed':
      return {
        kind: 'Bed',
        name: 'New Bed',
        transform,
        geometry: defaultBedGeometry(),
        tags: [],
      }
    case 'plant':
      return {
        kind: 'Plant',
        name: 'New Plant',
        transform,
        geometry: defaultPlantGeometry(),
        tags: [],
      }
    case 'prefab':
      return {
        kind: 'Structure',
        name: prefabSlug ?? 'New Prefab',
        transform,
        geometry: defaultPrefabGeometry(prefabSlug ?? 'terracotta-pot'),
        tags: [],
      }
  }
}

export default function DemoGround() {
  const downRef = useRef<{ x: number; y: number } | null>(null)

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Track raw screen coords so we can classify the gesture on pointer-up.
    downRef.current = { x: e.clientX, y: e.clientY }
  }

  const handlePointerUp = async (e: ThreeEvent<PointerEvent>) => {
    const down = downRef.current
    downRef.current = null
    if (!down) return

    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    const distSq = dx * dx + dy * dy
    if (distSq > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      // Camera drag — ignore.
      return
    }

    const { selectedEntityId, placement, currentGardenId } = useGarden.getState()

    if (placement) {
      // Place a new entity at the hit point.
      if (!currentGardenId) {
        useGarden.getState().setToast('No active garden — cannot place')
        useGarden.getState().setPlacement(null)
        return
      }
      const point = e.point
      const body = buildCreateRequest(placement.type, point, placement.prefabSlug)
      try {
        const created: GardenEntity = await createEntity(currentGardenId, body)
        // Optimistic local insert; SignalR `entityUpserted` will arrive too,
        // but `addOrUpdateEntity` is idempotent so duplicates are harmless.
        useGarden.getState().addOrUpdateEntity(created)
        useGarden.getState().selectEntity(created.id)
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? `Create failed (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Create failed'
        useGarden.getState().setToast(msg)
        console.error('[DemoGround] createEntity failed', err)
      } finally {
        // Exit placement mode whether success or failure.
        useGarden.getState().setPlacement(null)
      }
      return
    }

    // No placement — empty ground click clears selection.
    if (selectedEntityId) {
      useGarden.getState().selectEntity(null)
    }
  }

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#4a6b3a" roughness={0.9} metalness={0} />
    </mesh>
  )
}

