/**
 * Tour data — static definitions of every guided tour the user can launch
 * from the help (?) button. Each tour is a list of steps; each step points
 * at a stable `data-tour-id` somewhere in the live DOM and supplies the
 * tooltip copy that explains what the highlighted element does.
 *
 * Authoring guidelines:
 * - Keep `body` to 1-3 short sentences. The tooltip card is small.
 * - When an element behaves differently in alternate states (e.g. delete's
 *   first-tap-arms / second-tap-confirms), describe both in the body — we
 *   don't actually trigger the alt state during the tour.
 * - If a step's target is conditionally rendered (e.g. arrange-grid fields
 *   when the user is in Ring mode), the player falls back to a centered
 *   tooltip with no spotlight rather than failing.
 *
 * Adding a new tour: append to TOURS, add a `data-tour-id` to each step's
 * target in the corresponding component, and the menu picks it up
 * automatically.
 */

/**
 * What the live UI must look like for the tour to make sense. The menu
 * disables a tour with this hint when the precondition isn't met; the
 * active tour also auto-aborts if the precondition becomes false mid-walk
 * (e.g. user deselects partway through the inspector tour).
 */
export type TourPrecondition = 'always' | 'one-selected' | 'many-selected' | 'arrange-open'

export interface TourStep {
  /** data-tour-id of the target element. null = centered modal step. */
  target: string | null
  title: string
  body: string
  /** Pixels of breathing room around the spotlight rectangle. */
  pad?: number
}

export interface Tour {
  id: string
  title: string
  /** One-line description shown in the menu. */
  description: string
  precondition: TourPrecondition
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'chips',
    title: 'Top-left chips',
    description: 'Snap distance, sticky placement, multi-select, units.',
    precondition: 'always',
    steps: [
      {
        target: 'snap-value',
        title: 'Snap distance',
        body: 'Tap to cycle through snap distances in the active unit system. The value sets the grid spacing for placement and the step size for nudging.',
      },
      {
        target: 'snap-mode',
        title: 'Snap mode',
        body: '"edge" magnets the dragged entity to a neighbor\'s edge using the snap distance as the gap. "center" quantizes the entity center to a fixed world grid.',
      },
      {
        target: 'sticky-chip',
        title: 'Sticky placement',
        body: 'When ON, the placement tool stays armed after each click — drop multiple beds in a row without re-tapping the toolbar.',
      },
      {
        target: 'multi-chip',
        title: 'Multi-select',
        body: 'When ON, taps add or remove from the selection instead of replacing it. Long-press also extends the selection to descendants.',
      },
      {
        target: 'units-chip',
        title: 'Units',
        body: 'Toggle metric / imperial. All length inputs and readouts re-format instantly.',
      },
    ],
  },
  {
    id: 'main-toolbar',
    title: 'Bottom toolbar',
    description: 'Add beds, plants, prefabs, walls, doors, and windows.',
    precondition: 'always',
    steps: [
      {
        target: 'tb-bed',
        title: '+ Bed',
        body: 'Place a raised bed on the ground. Tap the button, then tap on the ground to drop one. With sticky ON, keeps placing.',
      },
      {
        target: 'tb-plant',
        title: '+ Plant',
        body: 'Place a plant. Plants can sit on the ground or inside a bed — drop on a bed to parent automatically.',
      },
      {
        target: 'tb-prefab',
        title: '+ Prefab',
        body: 'Open the prefab catalog (planters, cages, trellises). Pick a slug, then tap to drop — prefab\'s acceptance rules decide where it can land.',
      },
      {
        target: 'tb-region',
        title: '+ Region',
        body: 'Drag two corners on the ground to lay down a grid of beds (or fill a container with plants). Inputs let you tune rows / cols / gap before commit.',
      },
      {
        target: 'tb-wall',
        title: '+ Wall',
        body: 'Pascal house tool — tap two corners to lay a wall segment. Snap distance applies. Walls are the structural skeleton; doors / windows attach to them.',
      },
      {
        target: 'tb-door',
        title: '+ Door',
        body: 'Tap a wall to add a door at that point along its centerline. The position is clamped 5%–95% so doors don\'t end at a corner.',
      },
      {
        target: 'tb-window',
        title: '+ Window',
        body: 'Same flow as door — tap a wall to add a window at the click point.',
      },
    ],
  },
  {
    id: 'inspector',
    title: 'Inspector (1 selected)',
    description: 'The pill that appears when you tap a single entity.',
    precondition: 'one-selected',
    steps: [
      {
        target: 'insp-type-label',
        title: 'Type label',
        body: 'Shows what kind of entity is selected. If it has a parent, you also see "child of …" — useful for spotting plants that landed in the wrong bed.',
      },
      {
        target: 'insp-rotate',
        title: 'Rotate 90°',
        body: 'Quick-rotate around world Y. Rotates the entity in place; tap again for another 90°.',
      },
      {
        target: 'insp-move',
        title: 'Move',
        body: 'Tap to toggle translate-mode (then drag the entity directly). Or press-and-drag the button itself to move without your finger covering the entity — the smarter mobile path.',
      },
      {
        target: 'insp-copy',
        title: 'Copy',
        body: 'Duplicate the selected entity with a 0.5m offset on X. Selection jumps to the new copy and translate-mode arms automatically so you can drag it where you want.',
      },
      {
        target: 'insp-delete',
        title: 'Delete (two-tap)',
        body: 'First tap arms the confirm state (button turns brighter red, label says "confirm?"). Second tap deletes. Tap elsewhere to cancel.',
      },
      {
        target: 'insp-size',
        title: 'Size details',
        body: 'Expands a panel below with numeric Pos (X/Y/Z) and Size (W/H/L) inputs. Type values in your active unit system; commit on blur or Enter.',
      },
      {
        target: 'insp-close',
        title: 'Close',
        body: 'Clear the selection and dismiss the inspector. Esc also works.',
      },
      {
        target: 'insp-nudge-pad',
        title: 'Nudge pad',
        body: 'Fine-tune translation. Each arrow moves the entity by one snap step on world XZ. Center cell shows the active step. Desktop: arrow keys do the same thing.',
      },
    ],
  },
  {
    id: 'multi-inspector',
    title: 'Multi-select (2+ selected)',
    description: 'The bottom-center bar for group operations.',
    precondition: 'many-selected',
    steps: [
      {
        target: 'multi-header',
        title: 'Selection header',
        body: 'How many primaries are picked, what they are, and whether they share a hierarchy level. Mixed-level selections disable level-sensitive ops.',
      },
      {
        target: 'multi-rotate',
        title: 'Rotate group',
        body: 'Rotate every primary 90° around the GROUP centroid on world Y. Each entity also re-orients so its facing follows the rotation.',
      },
      {
        target: 'multi-translate',
        title: 'Group translate',
        body: 'Tap to enter group-translate (then drag any selected entity to move all). Press-and-drag the button to move the group directly without finger occlusion.',
      },
      {
        target: 'multi-duplicate',
        title: 'Duplicate all',
        body: 'Copy every primary with a 0.5m X offset, then jump selection to the new copies and arm group-translate.',
      },
      {
        target: 'multi-normalize',
        title: 'Normalize',
        body: 'Pick the longer axis (X or Z) and distribute the primaries evenly along it. Needs 3+ entities to do anything useful.',
      },
      {
        target: 'multi-distribute-x',
        title: 'Distribute X',
        body: 'Sort by X, keep the extremes fixed, redistribute the middle entities at equal spacing. Needs 3+ entities.',
      },
      {
        target: 'multi-distribute-z',
        title: 'Distribute Z',
        body: 'Same idea on Z. Needs 3+ entities.',
      },
      {
        target: 'multi-spread-x',
        title: 'Spread X',
        body: 'Inverse of distribute — pushes every primary 25% farther from the X centroid. Tap repeatedly to spread out more. Cross axis is preserved.',
      },
      {
        target: 'multi-spread-z',
        title: 'Spread Z',
        body: 'Same idea on Z. Tap repeatedly to keep pushing apart.',
      },
      {
        target: 'multi-align-l',
        title: 'Align Left (min X)',
        body: 'Snap every primary to the smallest X in the selection. Pairs with Align Right.',
      },
      {
        target: 'multi-align-r',
        title: 'Align Right (max X)',
        body: 'Snap every primary to the largest X.',
      },
      {
        target: 'multi-align-t',
        title: 'Align Top (min Z)',
        body: 'Snap every primary to the smallest Z. With the default camera, "top" of the screen is +/-Z depending on view — the icon is suggestive.',
      },
      {
        target: 'multi-align-b',
        title: 'Align Bottom (max Z)',
        body: 'Snap every primary to the largest Z.',
      },
      {
        target: 'multi-arrange',
        title: 'Arrange wizard',
        body: 'Open the grid (cartesian) / ring (polar) layout panel. Select 2+ entities then tap this — the panel walks you through cols / gaps or radius / angle. Also a tour of its own.',
      },
      {
        target: 'multi-delete',
        title: 'Delete all (two-tap)',
        body: 'First tap arms (button gets brighter), second tap deletes every primary. Partial failures revert the whole batch.',
      },
      {
        target: 'multi-close',
        title: 'Close',
        body: 'Clear the selection.',
      },
    ],
  },
  {
    id: 'arrange-wizard',
    title: 'Arrange wizard',
    description: 'Grid / ring layout. Open the panel first by tapping ▤ on the multi-select bar.',
    precondition: 'arrange-open',
    steps: [
      {
        target: 'arrange-tabs',
        title: 'Layout mode',
        body: 'Two modes: Grid lays the selection in rows × cols at chosen gaps. Ring spaces them evenly around a circle.',
      },
      {
        target: 'arrange-grid-cols',
        title: 'Grid: columns',
        body: 'How many columns. Rows derive automatically (ceil of selection-count / cols). Default ≈ √N for a roughly square layout. (Visible in Grid mode.)',
      },
      {
        target: 'arrange-grid-gap-x',
        title: 'Grid: gap X',
        body: 'Horizontal spacing between cells. Defaults to the active snap distance. Type any length in the active unit system. (Visible in Grid mode.)',
      },
      {
        target: 'arrange-grid-gap-z',
        title: 'Grid: gap Z',
        body: 'Same on the Z axis (front-to-back spacing). (Visible in Grid mode.)',
      },
      {
        target: 'arrange-ring-radius',
        title: 'Ring: radius',
        body: 'Distance from the centroid to each entity. Defaults to half the current selection extent. (Visible in Ring mode.)',
      },
      {
        target: 'arrange-ring-start',
        title: 'Ring: start angle',
        body: 'Where the first entity is placed (degrees, 0° = +X). Subsequent entities sweep evenly around the circle.',
      },
      {
        target: 'arrange-apply',
        title: 'Apply',
        body: 'Commits the layout to every selected entity. Y is preserved per-entity. Failures revert the whole batch.',
      },
    ],
  },
]
