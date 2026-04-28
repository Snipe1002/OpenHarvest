/**
 * useButtonDragHandle — turn a DOM button into a press-hold-drag handle that
 * moves entities directly, without the user's finger occluding the entity
 * being dragged.
 *
 * Why this exists: on touch screens, the previous flow was "tap ⇄ to enter
 * translate mode, then drag the entity itself". On a phone, the finger sits
 * directly on the entity during the drag — the user can't see what they're
 * moving. By making the BUTTON the drag handle, the finger stays parked on
 * the inspector pill while the entity follows it on the ground plane below.
 *
 * Two flavors are unified in one hook:
 *   - Single-entity (InspectorCard ⇄): pass `entity`. A tap (no significant
 *     pointer move) toggles the legacy translate-mode flag via `onTap`. A
 *     press-hold-drag past `DRAG_THRESHOLD_PX` activates direct drag of the
 *     entity, snapping per the active snap chip + mode, optimistic store
 *     update each frame, PATCH on release, revert on error.
 *   - Group (MultiSelectInspector ⇄): pass `getSelectedIds`. A tap toggles
 *     `groupTranslateActive` via `onTap`. A press-hold-drag picks the first
 *     selected id as the leader, snaps the leader's ground hit, and applies
 *     the resulting (dx, dz) delta to every other selected entity. PATCH all
 *     in parallel on release; revert ALL to snapshots if ANY PATCH fails
 *     (consistent with `useGroupTranslateDrag`'s revert policy).
 *
 * Why not call `useThree()` here: this hook is invoked from
 * `MultiSelectInspector`, which is rendered as a sibling of the R3F `<Viewer>`
 * — i.e. OUTSIDE the Canvas tree — so `useThree()` would throw. We instead
 * read camera/renderer/raycaster from a module-level singleton populated by
 * `<R3FSceneBridge>` (mounted inside `<Viewer>` in App.tsx). The InspectorCard
 * case happens to be inside `<Html>` which IS in the R3F tree, but using the
 * shared singleton there too keeps both call sites symmetric.
 *
 * Pointer flow (window-level, not button-level):
 *   - pointerdown on button: snapshot, captures pointer, registers window
 *     pointermove/pointerup listeners.
 *   - pointermove (window): if displacement < threshold, ignore. Otherwise
 *     mark dragging, suspend camera (`buttonDragActive=true`), raycast finger
 *     → ground plane, snap, optimistic store update.
 *   - pointerup (window): release capture, unregister listeners, clear flag.
 *     If never crossed threshold: call `onTap()`. Else: PATCH and (on error)
 *     revert.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { ApiError, updateEntity } from '../api/client'
import type { GardenEntity, Transform } from '../api/types'
import { useGarden } from '../store/garden'
import { type AABB, entityAABB } from './aabbHelpers'
import { snapXZ, snapXZWithMagnet } from './houseHelpers'
import { getSceneRefs } from './r3fSceneBridge'

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * Pixel displacement on the screen below which a pointerdown→pointerup is
 * treated as a tap (toggles translate mode) rather than a drag. Sized to
 * tolerate finger jitter on touch screens without swallowing real drags.
 */
const DRAG_THRESHOLD_PX = 6

/**
 * Half-extents of an entity in world XZ. Returns null when the entity has
 * no bounded geometry (Polygon, unsized prefab) — caller falls back to
 * non-magnet snap. Mirrors the helper in `useTranslateDrag.ts`.
 */
function entityHalfExtents(e: GardenEntity): { hw: number; hd: number } | null {
  const box = entityAABB(e)
  if (!box) return null
  return { hw: (box.x1 - box.x0) / 2, hd: (box.z1 - box.z0) / 2 }
}

/**
 * Collect AABBs of every entity in the store EXCEPT those listed in
 * `excludeIds`. For single drag that's just the dragged entity; for group
 * drag it's every entity moving together (so they don't magnet to each other).
 */
function collectNeighborAABBs(excludeIds: Set<string>): AABB[] {
  const { entities } = useGarden.getState()
  const out: AABB[] = []
  for (const e of Object.values(entities)) {
    if (excludeIds.has(e.id)) continue
    const box = entityAABB(e)
    if (box) out.push(box)
  }
  return out
}

interface DragState {
  pointerId: number
  startClientX: number
  startClientY: number
  isDragging: boolean
  /** All entities affected by the drag, snapshotted at start. */
  originals: Record<string, GardenEntity>
  /** Leader entity id — drives the (dx, dz) delta applied to the group. */
  leaderId: string
  /** The leader's snapped (x, z) at drag start, captured on the first move. */
  leaderStart: { x: number; z: number } | null
  /** The element that captured the pointer (for releasePointerCapture). */
  captureEl: HTMLElement | null
}

export interface ButtonDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
}

export interface UseButtonDragHandleOptions {
  /** Called when pointer-up fires before any meaningful movement. */
  onTap: () => void
  /**
   * Single-entity drag: pass the entity directly. Mutually exclusive with
   * `getSelectedIds`. The hook drags this one entity.
   */
  entity?: GardenEntity
  /**
   * Group drag: a getter that returns the current selected id list. Read at
   * pointerdown time so freshly added entities mid-session are honored.
   * Mutually exclusive with `entity`. The first id becomes the leader.
   */
  getSelectedIds?: () => string[]
}

/**
 * Snap the leader's ground hit using the active snap mode, excluding every
 * affected entity from the neighbor set so the moving group can't magnet to
 * itself. Falls back to plain grid snap when the leader has no AABB.
 */
function snapLeaderXZ(
  hitX: number,
  hitZ: number,
  leader: GardenEntity,
  affectedIds: Set<string>,
): { x: number; z: number } {
  const { snap, snapMode } = useGarden.getState()
  // Parented entities skip magnet for the same reason useTranslateDrag does:
  // neighbor AABBs are world-space and the parented entity's stored coords
  // are local, so center comparisons would be meaningless.
  const isParented = !!leader.parentId
  if (snapMode === 'edge' && !isParented) {
    const half = entityHalfExtents(leader)
    const hw = half?.hw ?? 0
    const hd = half?.hd ?? 0
    const neighbors = collectNeighborAABBs(affectedIds)
    const [sx, sz] = snapXZWithMagnet(hitX, hitZ, hw, hd, snap, neighbors)
    return { x: sx, z: sz }
  }
  const [sx, sz] = snapXZ(hitX, hitZ, snap)
  return { x: sx, z: sz }
}

/**
 * Project a window-level (clientX, clientY) onto the y=0 ground plane in
 * world coordinates. Returns null if the ray misses (rare: requires looking
 * UP at the ground from below). Reuses the renderer's bounding rect so we
 * convert clientX/Y → NDC correctly even when the canvas isn't full-window.
 */
function projectFingerToGround(clientX: number, clientY: number): THREE.Vector3 | null {
  const refs = getSceneRefs()
  if (!refs) return null
  const { camera, gl, raycaster } = refs
  const rect = gl.domElement.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
  const hit = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(GROUND_PLANE, hit)) return null
  return hit
}

export function useButtonDragHandle(options: UseButtonDragHandleOptions): ButtonDragHandlers {
  // Stash latest options in a ref so window-level handlers (which we register
  // ONCE per active drag) always see the freshest values without us needing
  // to re-register on every render. The store is the source of truth for
  // entities, so this just keeps `entity` / `onTap` / `getSelectedIds` fresh.
  const optionsRef = useRef(options)
  optionsRef.current = options

  const dragRef = useRef<DragState | null>(null)

  // We stash the window-level handlers in a ref so the SAME function
  // reference is used for both add- and remove-EventListener even across
  // renders. (If we re-defined them on each render, the references attached
  // by `onPointerDown` could outlive the render that created them — we'd
  // remove a different function and leak the original.) The handlers read
  // their state from `dragRef.current` and `optionsRef.current`, neither of
  // which changes identity between renders.
  const handlersRef = useRef<{
    onMove: (e: PointerEvent) => void
    onUp: (e: PointerEvent) => void
  } | null>(null)

  // Cleanup: if the component unmounts mid-drag (e.g. selection cleared while
  // user is still pressing), tear down listeners and reset the camera flag.
  useEffect(() => {
    return () => {
      const drag = dragRef.current
      if (!drag) return
      const handlers = handlersRef.current
      if (handlers) {
        window.removeEventListener('pointermove', handlers.onMove)
        window.removeEventListener('pointerup', handlers.onUp)
        window.removeEventListener('pointercancel', handlers.onUp)
      }
      try {
        drag.captureEl?.releasePointerCapture(drag.pointerId)
      } catch {
        /* no-op */
      }
      dragRef.current = null
      useGarden.getState().setButtonDragActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWindowPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startClientX
    const dy = e.clientY - drag.startClientY
    const dist2 = dx * dx + dy * dy

    // Below threshold — still a tap candidate, do nothing.
    if (!drag.isDragging && dist2 < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return

    // Crossed the threshold — promote to drag, suspend camera, prevent
    // browser default touch-action behavior (scroll/zoom).
    if (!drag.isDragging) {
      drag.isDragging = true
      useGarden.getState().setButtonDragActive(true)
    }
    e.preventDefault()

    const hit = projectFingerToGround(e.clientX, e.clientY)
    if (!hit) return

    const leader = drag.originals[drag.leaderId]
    if (!leader) return

    const affectedIds = new Set(Object.keys(drag.originals))
    const snapped = snapLeaderXZ(hit.x, hit.z, leader, affectedIds)

    // Initialize leaderStart on the FIRST move past threshold so the delta
    // begins from where the user actually started dragging the entity, not
    // from the button's screen position.
    if (!drag.leaderStart) drag.leaderStart = { x: snapped.x, z: snapped.z }

    // World-space delta. For the leader, when not parented, this just
    // re-positions to the snapped hit. For parented entities, parent-local
    // coords mean we apply the delta to the snapshot's stored local coords
    // (which is correct because all selected entities share the world delta
    // produced by the leader's snapped movement).
    const ddx = snapped.x - drag.leaderStart.x
    const ddz = snapped.z - drag.leaderStart.z

    // Apply the world-space delta to every snapshot. For non-parented
    // entities the snapshot's stored coords ARE world coords, so this places
    // the entity at (origWorld + delta). For parented entities the stored
    // coords are parent-local; since `ddx` / `ddz` are world-space and parent
    // rotation is ignored (matching useTranslateDrag's simplification), the
    // local delta equals the world delta and the same expression is correct.
    const { addOrUpdateEntity } = useGarden.getState()
    for (const id of Object.keys(drag.originals)) {
      const orig = drag.originals[id]
      const nx = orig.transform.position.x + ddx
      const nz = orig.transform.position.z + ddz
      addOrUpdateEntity({
        ...orig,
        transform: {
          ...orig.transform,
          position: { x: nx, y: orig.transform.position.y, z: nz },
        },
      })
    }
  }

  const onWindowPointerUp = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const handlers = handlersRef.current
    if (handlers) {
      window.removeEventListener('pointermove', handlers.onMove)
      window.removeEventListener('pointerup', handlers.onUp)
      window.removeEventListener('pointercancel', handlers.onUp)
    }
    try {
      drag.captureEl?.releasePointerCapture(drag.pointerId)
    } catch {
      /* no-op */
    }

    const wasDragging = drag.isDragging
    dragRef.current = null
    useGarden.getState().setButtonDragActive(false)

    // Pure tap: hand off to the legacy toggle (translate-mode / group-translate).
    if (!wasDragging) {
      optionsRef.current.onTap()
      return
    }

    // Drag commit: PATCH every moved entity. Revert ALL to snapshot if any
    // PATCH fails — matches the conservative policy in useGroupTranslateDrag.
    const { entities, currentGardenId, addOrUpdateEntity, setToast } = useGarden.getState()
    if (!currentGardenId) return

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
      const results = await Promise.allSettled(
        movedIds.map((id) => {
          const cur = useGarden.getState().entities[id]
          const transform: Transform = cur.transform
          return updateEntity(currentGardenId, id, { transform })
        }),
      )
      const anyFailure = results.some((r) => r.status === 'rejected')
      if (anyFailure) {
        // Revert every snapshot. We treat partial failures as catastrophic so
        // the user never sees a half-moved group.
        for (const id of Object.keys(drag.originals)) {
          addOrUpdateEntity(drag.originals[id])
        }
        const firstFail = results.find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined
        const err = firstFail?.reason
        const msg =
          err instanceof ApiError
            ? `Move failed (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Move failed'
        setToast(msg)
        console.error('[useButtonDragHandle] PATCH failed', err)
      } else {
        // Apply the server-confirmed entities so any backend-side coordinate
        // canonicalization is reflected locally.
        for (const r of results) {
          if (r.status === 'fulfilled') addOrUpdateEntity(r.value)
        }
      }
    })()
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // Stop propagation so pressing the button doesn't also trigger entity
    // selection / camera orbit on the canvas underneath.
    e.preventDefault()
    e.stopPropagation()

    // Snapshot the affected entity set. For single mode, just the entity. For
    // group mode, every currently selected entity. Bail if nothing's there.
    const opts = optionsRef.current
    const { entities } = useGarden.getState()
    const originals: Record<string, GardenEntity> = {}
    let leaderId: string | null = null
    if (opts.entity) {
      const fresh = entities[opts.entity.id] ?? opts.entity
      originals[fresh.id] = fresh
      leaderId = fresh.id
    } else if (opts.getSelectedIds) {
      const ids = opts.getSelectedIds()
      for (const id of ids) {
        const ent = entities[id]
        if (ent) originals[id] = ent
      }
      leaderId = ids[0] ?? null
    }
    if (!leaderId || Object.keys(originals).length === 0) return

    // Capture the pointer on the button so we get reliable pointerup even if
    // the finger drifts off-button. Window listeners back this up.
    const captureEl = e.currentTarget as HTMLElement
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      /* no-op — capture is a robustness boost, not a hard requirement */
    }

    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      isDragging: false,
      originals,
      leaderId,
      leaderStart: null,
      captureEl,
    }

    // Cache stable handler references so we can attach + detach the SAME
    // function (closure refs would change every render).
    handlersRef.current = { onMove: onWindowPointerMove, onUp: onWindowPointerUp }
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerUp)
  }

  return { onPointerDown }
}
