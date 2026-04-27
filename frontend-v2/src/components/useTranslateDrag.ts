/**
 * useTranslateDrag — shared drag-to-move handler set for any entity component
 * (DemoBed, DemoPlant, PrefabPlaceholder, UnknownDebugCube). The hook returns
 * a trio of pointer handlers; attach them to the entity's top-level <group>.
 *
 * Two flavors:
 *   - useTranslateDrag(entity): single-entity translate. Active iff
 *     `useGarden().translateModeId === entity.id`.
 *   - useGroupTranslateDrag(entity): group translate. Active iff
 *     `useGarden().groupTranslateActive` AND the entity is in
 *     `selectedEntityIds`. The first selected entity to receive a
 *     pointer-down becomes the "leader" — its snapped ground hit drives the
 *     uniform delta applied to every selected entity for the duration of the
 *     drag. On pointer-up we PATCH every moved entity in parallel; if any
 *     PATCH fails, we revert all of them to the pre-drag snapshot.
 *
 * Behavior:
 *   - When `useGarden().translateModeId === entity.id`, the handlers are live.
 *     PointerDown captures the pointer on the canvas DOM element so subsequent
 *     pointermove / pointerup events are guaranteed to reach our handlers
 *     even if the cursor leaves the entity mesh.
 *   - During drag, raycast the pointer ray against the y=0 ground plane to
 *     produce a new (x, z) world position. Snap to `useGarden().snap` when
 *     non-null. Y is preserved — translate is 2D.
 *   - We update the store optimistically via `addOrUpdateEntity`. On
 *     pointer-up, we PATCH the final position to the API. On error we toast
 *     and revert to the pre-drag position via `addOrUpdateEntity`.
 *   - When translate mode is NOT for this entity, all handlers are no-ops.
 *     Selection is delegated to a separate `onPointerDown` upstream — this
 *     hook never re-fires selection because the entity is already selected
 *     by the time the user enters translate mode.
 *
 * Why setPointerCapture instead of canvas-level move tracking: pointermove
 * events outside the entity's mesh would otherwise not reach us (R3F only
 * fires on hit-tested objects). Capturing on the canvas DOM lifts that
 * restriction without introducing a top-level useFrame loop.
 */
import { useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { ApiError, updateEntity } from '../api/client'
import type { GardenEntity, Transform } from '../api/types'
import { useGarden } from '../store/garden'

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * R3F replaces `event.target` on its synthetic ThreeEvent with an object
 * that has setPointerCapture / releasePointerCapture / hasPointerCapture
 * methods (see @react-three/fiber's events.js). The library's TS types
 * inherit from the DOM PointerEvent, where target is `EventTarget | null`
 * with no capture methods — so we narrow with this small interface and
 * use a typed cast at the call site rather than `any`.
 */
interface R3FCaptureTarget {
  setPointerCapture: (id: number) => void
  releasePointerCapture: (id: number) => void
}

interface DragState {
  pointerId: number
  /** Original transform before the drag started — used to revert on API error. */
  original: GardenEntity
}

export interface TranslateDragHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void
}

export function useTranslateDrag(entity: GardenEntity): TranslateDragHandlers {
  const dragRef = useRef<DragState | null>(null)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const { translateModeId } = useGarden.getState()
    if (translateModeId !== entity.id) return
    e.stopPropagation()

    // R3F wraps pointer capture so the captured object becomes the new event
    // target for subsequent pointermove / pointerup, regardless of where the
    // cursor goes. This is the documented pattern for drag in R3F.
    try {
      ;(e.target as unknown as R3FCaptureTarget).setPointerCapture(e.pointerId)
    } catch {
      /* no-op — capture isn't strictly required, just a robustness boost */
    }

    dragRef.current = {
      pointerId: e.pointerId,
      original: entity,
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()

    // Intersect the pointer ray with the y=0 ground plane.
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(GROUND_PLANE, hit)) return

    const { snap } = useGarden.getState()
    let x = hit.x
    let z = hit.z
    if (snap) {
      x = Math.round(x / snap) * snap
      z = Math.round(z / snap) * snap
    }

    // Preserve Y — translate is 2D. Y is edited via the inspector's number
    // fields, not by dragging.
    const next: GardenEntity = {
      ...drag.original,
      transform: {
        ...drag.original.transform,
        position: { x, y: drag.original.transform.position.y, z },
      },
    }
    useGarden.getState().addOrUpdateEntity(next)
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    dragRef.current = null

    try {
      ;(e.target as unknown as R3FCaptureTarget).releasePointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }

    const { entities, currentGardenId, setToast, addOrUpdateEntity, setTranslateMode } =
      useGarden.getState()
    const final = entities[entity.id]
    if (!final || !currentGardenId) {
      setTranslateMode(null)
      return
    }

    // No-op if the user pressed-released without moving.
    const op = drag.original.transform.position
    const np = final.transform.position
    if (op.x === np.x && op.y === np.y && op.z === np.z) {
      setTranslateMode(null)
      return
    }

    const transform: Transform = final.transform
    setTranslateMode(null)

    void (async () => {
      try {
        const updated = await updateEntity(currentGardenId, entity.id, { transform })
        addOrUpdateEntity(updated)
      } catch (err) {
        addOrUpdateEntity(drag.original)
        const msg =
          err instanceof ApiError
            ? `Move failed (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Move failed'
        setToast(msg)
        console.error('[useTranslateDrag] update failed', err)
      }
    })()
  }

  return { onPointerDown, onPointerMove, onPointerUp }
}

interface GroupDragState {
  pointerId: number
  /** Leader's snapped ground hit at drag start (x, z). The delta applied to
   *  every selected entity each frame is `currentSnappedHit - this`. */
  leaderStart: { x: number; z: number }
  /** Original transforms of every entity in the selection at drag start.
   *  Used to compute the new position each move and to revert on PATCH error. */
  originals: Record<string, GardenEntity>
}

/**
 * Group translate handler set. Attach the same way you'd attach
 * useTranslateDrag's handlers — entity components don't care which flavor is
 * driving the drag; the hooks layer themselves so only the active one fires.
 */
export function useGroupTranslateDrag(entity: GardenEntity): TranslateDragHandlers {
  const dragRef = useRef<GroupDragState | null>(null)

  const isActive = (): boolean => {
    const { groupTranslateActive, selectedEntityIds } = useGarden.getState()
    return groupTranslateActive && selectedEntityIds.includes(entity.id)
  }

  const snapXZ = (x: number, z: number): { x: number; z: number } => {
    const { snap } = useGarden.getState()
    if (!snap) return { x, z }
    return { x: Math.round(x / snap) * snap, z: Math.round(z / snap) * snap }
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isActive()) return
    e.stopPropagation()

    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(GROUND_PLANE, hit)) return

    try {
      ;(e.target as unknown as R3FCaptureTarget).setPointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }

    const { entities, selectedEntityIds } = useGarden.getState()
    const originals: Record<string, GardenEntity> = {}
    for (const id of selectedEntityIds) {
      const ent = entities[id]
      if (ent) originals[id] = ent
    }
    dragRef.current = {
      pointerId: e.pointerId,
      leaderStart: snapXZ(hit.x, hit.z),
      originals,
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()

    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(GROUND_PLANE, hit)) return
    const cur = snapXZ(hit.x, hit.z)
    const dx = cur.x - drag.leaderStart.x
    const dz = cur.z - drag.leaderStart.z

    const { addOrUpdateEntity } = useGarden.getState()
    for (const id of Object.keys(drag.originals)) {
      const orig = drag.originals[id]
      const next: GardenEntity = {
        ...orig,
        transform: {
          ...orig.transform,
          position: {
            x: orig.transform.position.x + dx,
            y: orig.transform.position.y,
            z: orig.transform.position.z + dz,
          },
        },
      }
      addOrUpdateEntity(next)
    }
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    dragRef.current = null

    try {
      ;(e.target as unknown as R3FCaptureTarget).releasePointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }

    const { entities, currentGardenId, setToast, addOrUpdateEntity } = useGarden.getState()
    if (!currentGardenId) return

    // Build the diff: only entities whose position actually changed.
    const movedIds: string[] = []
    for (const id of Object.keys(drag.originals)) {
      const orig = drag.originals[id]
      const cur = entities[id]
      if (!cur) continue
      const op = orig.transform.position
      const np = cur.transform.position
      if (op.x !== np.x || op.z !== np.z) movedIds.push(id)
    }
    if (movedIds.length === 0) return

    void (async () => {
      try {
        await Promise.all(
          movedIds.map((id) => {
            const cur = entities[id]
            return updateEntity(currentGardenId, id, { transform: cur.transform })
          }),
        )
      } catch (err) {
        // Revert every entity in this group to its pre-drag snapshot.
        for (const id of Object.keys(drag.originals)) {
          addOrUpdateEntity(drag.originals[id])
        }
        const msg =
          err instanceof ApiError
            ? `Group move failed (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Group move failed'
        setToast(msg)
        console.error('[useGroupTranslateDrag] PATCH failed', err)
      }
    })()
  }

  return { onPointerDown, onPointerMove, onPointerUp }
}
