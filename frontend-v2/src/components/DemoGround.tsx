/**
 * DemoGround — large flat grass plane. Receives shadows.
 *
 * Pointer responsibilities for the editing loop:
 *   - In placement mode: clicking the ground spawns a new entity at the
 *     hit point.
 *   - Out of placement mode: a click on empty space (no entity hit) clears
 *     the active selection. We use R3F's `onPointerMissed` callback wired
 *     up at the App level for that, but the ground also handles its own
 *     `onClick` to support placement.
 *
 * R3F's built-in `onClick` semantic already handles drag-vs-click: it only
 * fires when pointer-up lands on the same target as pointer-down without a
 * significant move, so a camera-orbit drag won't trip it. That's why we no
 * longer track pointerdown/pointerup coords manually.
 */
import type { ThreeEvent } from '@react-three/fiber'
import { ApiError, createEntity } from '../api/client'
import type { PrefabCatalog, PrefabSpec } from '../api/prefabs'
import type {
  CreateEntityRequest,
  GardenEntity,
  Geometry,
  Guid,
  Transform,
} from '../api/types'
import type { PlacementType } from '../store/garden'
import { useGarden } from '../store/garden'
import { createWallBetween, snapXZ } from './houseHelpers'

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

/** Hardcoded fallback used only if the prefab catalog hasn't loaded yet (race
 * between toolbar arming and catalog fetch). Logs a warning so the dev sees
 * the race in the console; once the catalog lands the lookup wins. */
const FALLBACK_PREFAB_SIZE = { x: 0.4, y: 0.5, z: 0.4 }

function defaultPrefabGeometry(slug: string, catalog: PrefabCatalog | null): Geometry {
  // Phase v2 — read default size + geometry kind from the data-driven catalog
  // rather than hardcoding. The `accepts` / `parentableTo` fields on the spec
  // are exposed but not yet enforced here; that wiring lands with the upcoming
  // hierarchy / parented-placement work.
  const spec = catalog?.[slug]
  if (!spec) {
    console.warn('[DemoGround] prefab catalog missing entry for', slug, '— using fallback size')
    return {
      kind: 'Prefab',
      prefabRef: slug,
      size: { ...FALLBACK_PREFAB_SIZE },
    }
  }
  return {
    // The wire-format Geometry uses the broader GeometryKind union, but only
    // 'Box' / 'Cylinder' / 'Prefab' are valid for catalog entries. We always
    // emit 'Prefab' on the wire so the entity round-trip preserves the slug
    // via prefabRef — the catalog's `geometryKind` is metadata for the client
    // renderer, not the wire kind.
    kind: 'Prefab',
    prefabRef: slug,
    size: { x: spec.defaultSize.x, y: spec.defaultSize.y, z: spec.defaultSize.z },
  }
}

/**
 * Resolve the catalog `category` for the entity we're about to create. Used to
 * check the parent's `accepts` rule. Beds and plants have well-known buckets
 * by entity kind; prefab placements look the category up by slug.
 *
 * Returns null when we can't infer a category (e.g. unknown prefab slug or
 * catalog hasn't loaded yet). Callers should be permissive when null — the
 * task spec says missing info should ALLOW the placement, not block it.
 */
function inferChildCategory(
  type: PlacementType,
  prefabSlug: string | null | undefined,
  catalog: PrefabCatalog | null,
): string | null {
  switch (type) {
    case 'bed':
      // Beds are first-class hosts in v0; treat them as the "bed" category so
      // a future catalog entry that whitelists "bed" parents Just Works.
      return 'bed'
    case 'plant':
      return 'plant'
    case 'prefab': {
      if (!prefabSlug || !catalog) return null
      const spec = catalog[prefabSlug]
      return spec?.category ?? null
    }
  }
}

/**
 * Look up a parent entity's catalog spec via its prefab slug. Returns null
 * when the parent is non-prefab geometry (no slug to look up) or the catalog
 * hasn't loaded — both cases let the parent-rule check fall through to
 * "permissive: allow placement when info is missing".
 */
function parentSpec(parent: GardenEntity, catalog: PrefabCatalog | null): PrefabSpec | null {
  const slug = parent.geometry.prefabRef
  if (!slug || !catalog) return null
  return catalog[slug] ?? null
}

function buildCreateRequest(
  type: PlacementType,
  point: { x: number; y: number; z: number },
  prefabSlug: string | null | undefined,
  catalog: PrefabCatalog | null,
  parent: GardenEntity | null,
  parentId: Guid | null,
): CreateEntityRequest {
  // ----- Position math -----
  // World hit point comes in via `point`. When parented, transform.position is
  // stored in the parent's local frame (Three's scene graph applies the parent
  // transform during render). We ignore parent rotation in v0, so the conversion
  // is just a vector subtraction. Y is replaced with the parent's `surface.y`
  // (from the catalog) when the parent declares one — this is what makes a
  // plant land ON TOP of a bed at the correct height instead of at its base.
  let position = { x: point.x, y: point.y, z: point.z }
  if (parent) {
    const pPos = parent.transform.position
    const pSpec = parentSpec(parent, catalog)
    const localY = pSpec?.surface?.y ?? 0
    position = {
      x: point.x - pPos.x,
      y: localY,
      z: point.z - pPos.z,
    }
  }
  const transform: Transform = {
    ...IDENTITY_TRANSFORM,
    position,
  }
  switch (type) {
    case 'bed':
      return {
        kind: 'Bed',
        name: 'New Bed',
        parentId,
        transform,
        geometry: defaultBedGeometry(),
        tags: [],
      }
    case 'plant':
      return {
        kind: 'Plant',
        name: 'New Plant',
        parentId,
        transform,
        geometry: defaultPlantGeometry(),
        tags: [],
      }
    case 'prefab': {
      const slug = prefabSlug ?? 'terracotta-pot'
      const spec = catalog?.[slug]
      return {
        kind: 'Structure',
        name: spec?.displayName ?? prefabSlug ?? 'New Prefab',
        parentId,
        transform,
        geometry: defaultPrefabGeometry(slug, catalog),
        tags: [],
      }
    }
  }
}

export default function DemoGround() {
  const handleClick = async (e: ThreeEvent<MouseEvent>) => {
    const state = useGarden.getState()
    const {
      selectedEntityIds,
      selectedWallId,
      placement,
      housePlacement,
      currentGardenId,
      snap,
      multiSelectMode,
      prefabCatalog,
    } = state

    // ---- House placement: wall corner clicks override everything else ----
    if (housePlacement?.type === 'wall') {
      e.stopPropagation()
      const [sx, sz] = snapXZ(e.point.x, e.point.z, snap)
      if (!housePlacement.pendingFirstCorner) {
        // First corner: stash and wait for the second click.
        useGarden.getState().setHousePlacement({
          type: 'wall',
          pendingFirstCorner: [sx, sz],
        })
        return
      }
      // Second corner: build the wall.
      const wallId = createWallBetween(housePlacement.pendingFirstCorner, [sx, sz])
      if (!wallId) {
        useGarden.getState().setToast('No level found — cannot create wall')
      }
      // Sticky: stay armed for another wall (reset to first-corner-pending).
      // Otherwise: exit placement entirely.
      const sticky = useGarden.getState().stickyPlacement
      if (sticky) {
        useGarden.getState().setHousePlacement({ type: 'wall' })
      } else {
        useGarden.getState().setHousePlacement(null)
      }
      return
    }

    // Door / window placement is handled by the wall-click subscriber in
    // App.tsx — a click on the ground while in those modes does nothing
    // except cancel garden placement clutter. Don't fall through to garden
    // placement here, or a misclick would create a stray entity.
    if (housePlacement?.type === 'door' || housePlacement?.type === 'window') {
      e.stopPropagation()
      return
    }

    if (placement) {
      // Stop propagation so the camera control / pointer-missed don't react.
      e.stopPropagation()
      if (!currentGardenId) {
        useGarden.getState().setToast('No active garden — cannot place')
        useGarden.getState().setPlacement(null)
        return
      }

      // Selection-driven parenthood: when EXACTLY ONE entity is selected, the
      // new entity becomes its child. Multi-selection or empty-selection both
      // map to "place at world top-level" (parentId = null). This mirrors the
      // mental model of "drop into the thing you have your finger on".
      const { entities } = useGarden.getState()
      const parentId: Guid | null =
        selectedEntityIds.length === 1 ? selectedEntityIds[0] : null
      const parent: GardenEntity | null = parentId ? entities[parentId] ?? null : null

      // Catalog rule check: if the parent has a known catalog entry AND that
      // entry declares an `accepts` whitelist that doesn't include the child
      // category, refuse and toast. We fall through (allow) whenever data is
      // missing — the spec asks us to be GENEROUS when info isn't loaded yet,
      // not block on partial knowledge.
      if (parent) {
        const pSpec = parentSpec(parent, prefabCatalog)
        const childCategory = inferChildCategory(
          placement.type,
          placement.prefabSlug,
          prefabCatalog,
        )
        if (pSpec && childCategory && pSpec.accepts.length > 0 && !pSpec.accepts.includes(childCategory)) {
          useGarden.getState().setToast(
            `${pSpec.displayName} doesn't accept ${childCategory}s`,
          )
          // Don't exit placement mode — the user might just have the wrong
          // selection and want to retry against a different parent.
          return
        }
      }

      const point = e.point
      const body = buildCreateRequest(
        placement.type,
        point,
        placement.prefabSlug,
        prefabCatalog,
        parent,
        parentId,
      )
      try {
        const created: GardenEntity = await createEntity(currentGardenId, body)
        // Optimistic local insert; SignalR `entityUpserted` will arrive too,
        // but `addOrUpdateEntity` is idempotent so duplicates are harmless.
        useGarden.getState().addOrUpdateEntity(created)
        useGarden.getState().selectEntity(created.id, false)
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
        // Sticky: stay armed for another placement of the same kind. Esc still
        // cancels.
        if (!useGarden.getState().stickyPlacement) {
          useGarden.getState().setPlacement(null)
        }
      }
      return
    }

    // No placement — empty ground click clears selection (entity OR wall).
    // Holding shift or being in multi-select mode preserves the selection so
    // users don't accidentally lose a multi-pick when missing on the ground.
    const preserveSelection = e.nativeEvent.shiftKey || multiSelectMode
    if (!preserveSelection) {
      if (selectedEntityIds.length > 0) {
        useGarden.getState().clearSelection()
      }
      if (selectedWallId) {
        useGarden.getState().selectWall(null)
      }
    }
  }

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
      onClick={handleClick}
    >
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#4a6b3a" roughness={0.9} metalness={0} />
    </mesh>
  )
}
