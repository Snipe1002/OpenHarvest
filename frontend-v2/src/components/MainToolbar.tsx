/**
 * MainToolbar — single bottom-center HTML toolbar that combines both the
 * Garden placement buttons (+ Bed / + Plant / + Prefab) and the House
 * construction buttons (+ Wall / + Door / + Window). The two sections are
 * separated by a small uppercase label and a vertical divider:
 *
 *   [Garden]  + Bed   + Plant  + Prefab    │    [House]  + Wall  + Door  + Window
 *
 * Behaviors preserved from the previous AddToolbar / HouseToolbar split:
 *   - Esc cancels whichever placement is active (garden or house).
 *   - Active button gets a highlighted style; the other buttons in BOTH
 *     sections are disabled while a placement is armed, so the user can't
 *     enter "double" placement mode across the two pipelines.
 *   - Sticky behavior is store-driven and unchanged.
 *   - The "+ Prefab" button reveals an inline picker with slugs; choosing
 *     one arms placement with that slug.
 *   - Status pills (orange) sit at top:152 — guaranteed below the top-left
 *     chip column (Snap/Sticky/Multi/Units) at any viewport width.
 *
 * Wall-corner placement (first vs second click) is driven by the ground
 * click handler in `DemoGround.tsx` reading `housePlacement.pendingFirstCorner`.
 * Door / window placement is driven by the `wall:click` subscriber in
 * `App.tsx`. Construction helpers live in `houseHelpers.ts`.
 *
 * Narrow viewports: the row uses `flex-wrap` so on phones (≈375px) the
 * House section can wrap to a second line below the Garden section without
 * overflowing. Both sections retain their internal layout in either case.
 */
import { useEffect, useMemo } from 'react'
import { listPrefabs, type PrefabCatalog, type PrefabSpec } from '../api/prefabs'
import type { GardenEntity } from '../api/types'
import {
  useGarden,
  type HousePlacementType,
  type PlacementType,
  type RegionScope,
} from '../store/garden'

/**
 * Status text for the region-paint pill, mirroring `houseStatusText` for the
 * three-phase lifecycle. The configuring phase is silent here — its UI lives
 * inline at the rectangle's center via the `<RegionPaint>` 3D component.
 *
 * Copy switches by scope: world-mode talks about "the ground", fill-container
 * mode names the target container so the user knows which entity will receive
 * the grid of children.
 */
function regionStatusText(
  phase: 'awaiting-first-corner' | 'awaiting-second-corner',
  scope: RegionScope,
): string {
  if (scope.kind === 'fill-container') {
    if (phase === 'awaiting-first-corner') {
      return `Drag two corners INSIDE ${scope.parentLabel} to fill with plants (Esc to cancel)`
    }
    return `Release to set the second corner inside ${scope.parentLabel} (Esc to cancel)`
  }
  if (phase === 'awaiting-first-corner') {
    return 'Drag two corners on the ground to define a region (Esc to cancel)'
  }
  return 'Release to set the second corner (Esc to cancel)'
}

/**
 * Decide whether a parent entity is a "container" that accepts plant children.
 * Used to flip `+ Region` into fill-container mode when exactly one such entity
 * is selected.
 *
 * Two paths:
 *   1. The entity has a prefab slug and the catalog's `accepts` list includes
 *      `'plant'` (the explicit, data-driven path).
 *   2. As a permissive fallback, the catalog spec's category === 'container'.
 *
 * Returns the matched `PrefabSpec` (with required `surface`) and the parent
 * entity, or `null` if not a viable fill target.
 */
function resolveFillTarget(
  parent: GardenEntity,
  catalog: PrefabCatalog | null,
): { spec: PrefabSpec; parent: GardenEntity } | null {
  if (!catalog) return null
  const slug = parent.geometry.prefabRef
  if (!slug) return null
  const spec = catalog[slug]
  if (!spec) return null
  // Need a top surface to plant ON; without one we can't compute Y for kids.
  if (!spec.surface) return null
  const acceptsPlant = spec.accepts.includes('plant')
  const isContainer = spec.category === 'container'
  if (!acceptsPlant && !isContainer) return null
  return { spec, parent }
}

/**
 * Categories shown in the user-facing prefab picker. `plant` is excluded —
 * plants get their own "+ Plant" button. Anything else from the catalog is
 * surfaced under its own group header for readability.
 */
const PICKER_CATEGORIES: ReadonlyArray<PrefabSpec['category']> = [
  'container',
  'fixture',
  'decoration',
]

interface PickerEntry {
  slug: string
  spec: PrefabSpec
}

/** Group catalog entries by category, preserving the iteration order of
 * {@link PICKER_CATEGORIES}. Slugs within a group are alphabetized for stable
 * UI ordering across renders. Returns an empty array if the catalog is null. */
function buildPickerGroups(
  catalog: PrefabCatalog | null,
): Array<{ category: PrefabSpec['category']; entries: PickerEntry[] }> {
  if (!catalog) return []
  const groups = new Map<PrefabSpec['category'], PickerEntry[]>()
  for (const cat of PICKER_CATEGORIES) groups.set(cat, [])
  for (const [slug, spec] of listPrefabs(catalog)) {
    const bucket = groups.get(spec.category)
    if (bucket) bucket.push({ slug, spec })
  }
  for (const [, list] of groups) {
    list.sort((a, b) => a.spec.displayName.localeCompare(b.spec.displayName))
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([category, entries]) => ({ category, entries }))
}

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  zIndex: 10,
}

const BUTTON_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(20, 22, 24, 0.92)',
  padding: 6,
  borderRadius: 6,
  border: '1px solid #333',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  maxWidth: 'calc(100vw - 32px)',
}

const SECTION_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  paddingRight: 2,
  userSelect: 'none',
}

const DIVIDER_STYLE: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#444',
  margin: '0 10px',
  flex: '0 0 auto',
}

const BUTTON_STYLE: React.CSSProperties = {
  background: '#2a2d31',
  color: '#e5e5e5',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '6px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const PILL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 152,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(255, 170, 0, 0.92)',
  color: '#1a1a1a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #d99a00',
  zIndex: 10,
  cursor: 'pointer',
}

const PICKER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'rgba(20, 22, 24, 0.92)',
  padding: 6,
  borderRadius: 6,
  border: '1px solid #333',
  maxWidth: 'calc(100vw - 32px)',
}

const PICKER_GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
}

const PICKER_GROUP_LABEL_STYLE: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  paddingRight: 4,
  userSelect: 'none',
}

const PICKER_LOADING_STYLE: React.CSSProperties = {
  color: '#aaa',
  fontSize: 12,
  padding: '4px 8px',
  fontStyle: 'italic',
}

function buttonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    ...BUTTON_STYLE,
    background: active ? '#5a4a1a' : BUTTON_STYLE.background,
    borderColor: active ? '#aa8a3a' : BUTTON_STYLE.border?.toString().split(' ').pop(),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function gardenLabel(
  type: PlacementType,
  prefabSlug: string | null | undefined,
  catalog: PrefabCatalog | null,
): string {
  if (type === 'prefab') {
    if (!prefabSlug) return 'Prefab'
    return catalog?.[prefabSlug]?.displayName ?? prefabSlug
  }
  if (type === 'bed') return 'Bed'
  if (type === 'plant') return 'Plant'
  return type
}

function houseStatusText(type: HousePlacementType, hasFirstCorner: boolean): string {
  if (type === 'wall') {
    return hasFirstCorner
      ? 'Click second corner (Esc to cancel)'
      : 'Click first corner (Esc to cancel)'
  }
  if (type === 'door') return 'Tap a wall to place door (Esc to cancel)'
  return 'Tap a wall to place window (Esc to cancel)'
}

export default function MainToolbar() {
  const placement = useGarden((s) => s.placement)
  const setPlacement = useGarden((s) => s.setPlacement)
  const housePlacement = useGarden((s) => s.housePlacement)
  const setHousePlacement = useGarden((s) => s.setHousePlacement)
  const regionPaint = useGarden((s) => s.regionPaint)
  const setRegionPaint = useGarden((s) => s.setRegionPaint)
  const prefabCatalog = useGarden((s) => s.prefabCatalog)
  const pickerGroups = useMemo(() => buildPickerGroups(prefabCatalog), [prefabCatalog])

  // Esc cancels whichever placement is active. The three pipelines are
  // mutually exclusive (arming one cancels the other two via their setters),
  // so any one of these `if`s will be true.
  useEffect(() => {
    if (!placement && !housePlacement && !regionPaint) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placement) setPlacement(null)
      if (housePlacement) setHousePlacement(null)
      if (regionPaint) setRegionPaint(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [placement, housePlacement, regionPaint, setPlacement, setHousePlacement, setRegionPaint])

  const isGardenPicking = placement?.type === 'prefab' && !placement.prefabSlug
  const isGardenPlacing = !!placement && !isGardenPicking
  const isHousePlacing = !!housePlacement
  const isRegionPainting = !!regionPaint
  const hasFirstCorner = !!housePlacement?.pendingFirstCorner
  // Any placement at all disables the OTHER mode's buttons too — mirrors the
  // pre-merge behavior where switching modes via the toolbar called the other
  // setter to cancel. (The cross-mode disabled logic lives in the helpers
  // below; the flags above feed those helpers.)

  const enterGarden = (type: PlacementType, prefabSlug?: string) => {
    // Entering garden placement cancels any house / region paint placement.
    setHousePlacement(null)
    setRegionPaint(null)
    setPlacement({ type, prefabSlug: prefabSlug ?? null })
  }

  const enterHouse = (type: HousePlacementType) => {
    // Entering house placement cancels any garden / region placement.
    setPlacement(null)
    setRegionPaint(null)
    setHousePlacement({ type, pendingFirstCorner: null })
  }

  const enterRegion = () => {
    // Region paint cancels both garden + house placement (its setter does this
    // too, but we clear here for symmetry with the other enter* helpers).
    setPlacement(null)
    setHousePlacement(null)
    // Selection-driven scope decision: if EXACTLY ONE container-ish entity is
    // selected, drag fills it with plants. Otherwise, drag paints a top-level
    // region of beds (m#10a behavior).
    const { selectedEntityIds, entities, prefabCatalog } = useGarden.getState()
    let scope: RegionScope = { kind: 'world' }
    if (selectedEntityIds.length === 1) {
      const parent = entities[selectedEntityIds[0]]
      if (parent) {
        const target = resolveFillTarget(parent, prefabCatalog)
        if (target) {
          scope = {
            kind: 'fill-container',
            parentId: parent.id,
            parentLabel: target.spec.displayName,
            // surface.y is in PARENT-LOCAL meters relative to the parent's
            // base. The parent's transform.position.y IS the parent's base in
            // world coords (DemoBed offsets up by h/2 inside the group, but
            // the entity's logical base is unchanged), so world surface Y is
            // base + surface.y.
            surfaceY: parent.transform.position.y + (target.spec.surface?.y ?? 0),
            parentWorldX: parent.transform.position.x,
            parentWorldZ: parent.transform.position.z,
          }
        }
      }
    }
    setRegionPaint({ phase: 'awaiting-first-corner', scope })
  }

  const gardenDisabled = (myType: PlacementType): boolean =>
    (isGardenPlacing && placement?.type !== myType) || isHousePlacing || isRegionPainting

  const houseDisabled = (myType: HousePlacementType): boolean =>
    (isHousePlacing && housePlacement?.type !== myType) || isGardenPlacing || isRegionPainting

  const regionDisabled: boolean = isGardenPlacing || isHousePlacing

  return (
    <>
      {isGardenPlacing && placement && (
        <div
          style={PILL_STYLE}
          role="status"
          onClick={() => setPlacement(null)}
          title="Click to cancel placement"
        >
          Click ground to place {gardenLabel(placement.type, placement.prefabSlug, prefabCatalog)} (Esc to cancel)
        </div>
      )}
      {housePlacement && (
        <div
          style={PILL_STYLE}
          role="status"
          onClick={() => setHousePlacement(null)}
          title="Click to cancel"
        >
          {houseStatusText(housePlacement.type, hasFirstCorner)}
        </div>
      )}
      {regionPaint && regionPaint.phase !== 'configuring' && (
        <div
          style={PILL_STYLE}
          role="status"
          onClick={() => setRegionPaint(null)}
          title="Click to cancel"
        >
          {regionStatusText(regionPaint.phase, regionPaint.scope)}
        </div>
      )}

      <div style={BAR_STYLE} data-toolbar="main">
        {isGardenPicking && (
          <div style={PICKER_STYLE}>
            {!prefabCatalog && (
              <div style={PICKER_LOADING_STYLE}>Loading prefab catalog…</div>
            )}
            {prefabCatalog && pickerGroups.length === 0 && (
              <div style={PICKER_LOADING_STYLE}>No prefabs available</div>
            )}
            {pickerGroups.map(({ category, entries }) => (
              <div key={category} style={PICKER_GROUP_STYLE}>
                <span style={PICKER_GROUP_LABEL_STYLE}>{category}</span>
                {entries.map(({ slug, spec }) => (
                  <button
                    key={slug}
                    style={BUTTON_STYLE}
                    title={slug}
                    onClick={() => enterGarden('prefab', slug)}
                  >
                    {spec.displayName}
                  </button>
                ))}
              </div>
            ))}
            <div style={PICKER_GROUP_STYLE}>
              <button style={BUTTON_STYLE} onClick={() => setPlacement(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={BUTTON_ROW_STYLE}>
          <div style={SECTION_STYLE}>
            <span style={SECTION_LABEL_STYLE}>Garden</span>
            <button
              style={buttonStyle(placement?.type === 'bed', gardenDisabled('bed'))}
              disabled={gardenDisabled('bed')}
              onClick={() => (placement?.type === 'bed' ? setPlacement(null) : enterGarden('bed'))}
            >
              + Bed
            </button>
            <button
              style={buttonStyle(placement?.type === 'plant', gardenDisabled('plant'))}
              disabled={gardenDisabled('plant')}
              onClick={() => (placement?.type === 'plant' ? setPlacement(null) : enterGarden('plant'))}
            >
              + Plant
            </button>
            <button
              style={buttonStyle(placement?.type === 'prefab', isHousePlacing || isRegionPainting)}
              disabled={isHousePlacing || isRegionPainting}
              onClick={() => {
                if (placement?.type === 'prefab') setPlacement(null)
                else {
                  setHousePlacement(null)
                  setRegionPaint(null)
                  setPlacement({ type: 'prefab', prefabSlug: null })
                }
              }}
            >
              + Prefab
            </button>
            <button
              style={buttonStyle(isRegionPainting, regionDisabled)}
              disabled={regionDisabled}
              onClick={() => (isRegionPainting ? setRegionPaint(null) : enterRegion())}
              title="Drag-paint a rectangle of beds in a grid"
            >
              + Region
            </button>
          </div>

          <div style={DIVIDER_STYLE} aria-hidden="true" />

          <div style={SECTION_STYLE}>
            <span style={SECTION_LABEL_STYLE}>House</span>
            <button
              style={buttonStyle(housePlacement?.type === 'wall', houseDisabled('wall'))}
              disabled={houseDisabled('wall')}
              onClick={() => (housePlacement?.type === 'wall' ? setHousePlacement(null) : enterHouse('wall'))}
            >
              + Wall
            </button>
            <button
              style={buttonStyle(housePlacement?.type === 'door', houseDisabled('door'))}
              disabled={houseDisabled('door')}
              onClick={() => (housePlacement?.type === 'door' ? setHousePlacement(null) : enterHouse('door'))}
            >
              + Door
            </button>
            <button
              style={buttonStyle(housePlacement?.type === 'window', houseDisabled('window'))}
              disabled={houseDisabled('window')}
              onClick={() => (housePlacement?.type === 'window' ? setHousePlacement(null) : enterHouse('window'))}
            >
              + Window
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
