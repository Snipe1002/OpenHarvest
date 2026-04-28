/**
 * TourSystem — single React component that owns:
 *   1. The floating "?" help button (bottom-right above MainToolbar).
 *   2. The tour menu (popup listing every tour, gated by precondition).
 *   3. The active tour player (spotlight + tooltip + Prev/Next/Skip).
 *
 * Everything is rendered in a fixed-position layer over the live UI so
 * tours can highlight whichever element is on screen — they don't need to
 * mount into the page at any specific spot. Targets are resolved by
 * `data-tour-id="..."` attributes on the elements being explained.
 *
 * Spotlight strategy: a fullscreen SVG with a dark `<rect>` covering the
 * whole viewport plus a transparent (cut-out) `<rect>` over the target.
 * Using SVG + `fill-rule="evenodd"` instead of CSS clip-path because clip
 * has spotty support for the dim-overlay-with-hole pattern, and this
 * approach gives crisp rounded corners on the spotlight too.
 *
 * Tooltip placement: tries below first, falls back to above, then to a
 * centered modal if neither side has room. Edges of the viewport clamp
 * the horizontal position so the card never spills offscreen.
 *
 * Precondition checks: the menu reads from useGarden to grey out
 * unavailable tours; the active player subscribes to the same store and
 * exits cleanly if the precondition becomes false (e.g. user deselects).
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { useGarden } from '../store/garden'
import { TOURS, type Tour, type TourPrecondition, type TourStep } from './tourData'

const Z_HELP_BUTTON = 20
const Z_OVERLAY = 30 // above everything else (chips: 11, inspector: 12)

const HELP_BUTTON_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: 'rgba(60, 130, 200, 0.92)',
  color: '#fff',
  border: '1px solid #4a90c8',
  fontSize: 22,
  fontWeight: 700,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  cursor: 'pointer',
  zIndex: Z_HELP_BUTTON,
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
}

const MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 70,
  background: 'rgba(20, 22, 24, 0.96)',
  border: '1px solid #4ec9ff',
  borderRadius: 8,
  padding: 8,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  color: '#e5e5e5',
  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
  zIndex: Z_HELP_BUTTON,
  minWidth: 280,
  maxWidth: 'calc(100vw - 32px)',
}

const MENU_ITEM_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  background: 'rgba(20, 22, 24, 0.97)',
  border: '1px solid #4ec9ff',
  borderRadius: 8,
  padding: '12px 14px',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  color: '#e5e5e5',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  zIndex: Z_OVERLAY + 1,
  maxWidth: 320,
  pointerEvents: 'auto',
}

/**
 * Read the live store and decide whether each tour's precondition is met.
 * Used by the menu to grey out unavailable tours and by the player to
 * abort if the precondition becomes false during a walk.
 */
function checkPrecondition(p: TourPrecondition): boolean {
  if (p === 'always') return true
  const s = useGarden.getState()
  const n = s.primarySelectedIds.length
  if (p === 'one-selected') return n === 1
  if (p === 'many-selected') return n >= 2
  if (p === 'arrange-open') {
    // The arrange panel lives inside MultiSelectInspector and only renders
    // when (a) the multi-select bar is up and (b) its internal arrangeOpen
    // flag is true. We can't read that local React state from here, so we
    // detect it by checking the DOM for the panel's tagged element. This
    // keeps the precondition system source-of-truth-free of cross-cutting
    // concerns.
    return n >= 2 && document.querySelector('[data-tour-id="arrange-tabs"]') !== null
  }
  return false
}

function preconditionHint(p: TourPrecondition): string {
  if (p === 'one-selected') return 'Select one entity first.'
  if (p === 'many-selected') return 'Select two or more entities first.'
  if (p === 'arrange-open') return 'Select 2+ entities, then tap the ▤ arrange button.'
  return ''
}

/**
 * Find a target element by data-tour-id and return its bounding rectangle.
 * Returns null when the element isn't in the DOM (e.g. arrange-grid fields
 * while the user is on the Ring tab) — the player falls back to a centered
 * modal in that case.
 */
function findTarget(targetId: string | null): DOMRect | null {
  if (!targetId) return null
  const el = document.querySelector(`[data-tour-id="${targetId}"]`)
  if (!el) return null
  return (el as HTMLElement).getBoundingClientRect()
}

interface SpotlightProps {
  rect: DOMRect | null
  pad: number
}

/**
 * Renders the dim overlay with a transparent rounded-rectangle hole over
 * the target. When `rect` is null we still dim the screen but with no
 * cutout — used for the "centered modal" step style.
 */
function Spotlight({ rect, pad }: SpotlightProps) {
  // We expand the hole by `pad` so the highlighted control gets some
  // breathing room and the user can clearly see what's being pointed at.
  const x = rect ? Math.max(0, rect.left - pad) : 0
  const y = rect ? Math.max(0, rect.top - pad) : 0
  const w = rect ? rect.width + pad * 2 : 0
  const h = rect ? rect.height + pad * 2 : 0
  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z_OVERLAY,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <mask id="tour-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {rect && <rect x={x} y={y} width={w} height={h} rx="8" ry="8" fill="black" />}
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(0, 0, 0, 0.55)"
        mask="url(#tour-mask)"
      />
      {rect && (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="8"
          ry="8"
          fill="none"
          stroke="#4ec9ff"
          strokeWidth="2"
        />
      )}
    </svg>
  )
}

/**
 * Place the tooltip card relative to the spotlight rect. Prefers below,
 * then above, then centered. Clamps to the viewport so the card always
 * stays on screen.
 */
function placeTooltip(
  rect: DOMRect | null,
  cardWidth: number,
  cardHeight: number,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 12
  if (!rect) {
    // Centered modal style.
    return {
      left: Math.max(margin, (vw - cardWidth) / 2),
      top: Math.max(margin, (vh - cardHeight) / 2),
    }
  }
  // Try below first.
  let top = rect.bottom + margin
  if (top + cardHeight > vh - margin) {
    // Try above.
    const aboveTop = rect.top - margin - cardHeight
    if (aboveTop >= margin) {
      top = aboveTop
    } else {
      // Fall back to centered vertically.
      top = Math.max(margin, (vh - cardHeight) / 2)
    }
  }
  // Center horizontally on the target, then clamp.
  let left = rect.left + rect.width / 2 - cardWidth / 2
  if (left < margin) left = margin
  if (left + cardWidth > vw - margin) left = vw - margin - cardWidth
  return { left, top }
}

interface PlayerProps {
  tour: Tour
  onExit: () => void
}

function TourPlayer({ tour, onExit }: PlayerProps) {
  const [stepIdx, setStepIdx] = useState(0)
  // We store the latest target rect in state so the overlay re-renders
  // when the window resizes (a step's target can move as the layout
  // reflows on rotation or window-size change).
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Keep a sane default size for placeTooltip — measured size lands after
  // the first paint.
  const [cardSize, setCardSize] = useState({ w: 320, h: 180 })

  const step: TourStep | undefined = tour.steps[stepIdx]

  // Re-measure target on step change, and again whenever the viewport or
  // any element resizes. Polling at 16ms during the step is wasteful but
  // simple and bulletproof — the overlay is a heavyweight modal moment,
  // not a constant background cost.
  useLayoutEffect(() => {
    if (!step) return
    const measure = () => setRect(findTarget(step.target))
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const interval = window.setInterval(measure, 100)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(interval)
    }
  }, [step])

  // Auto-exit if the tour's precondition becomes false (user deselects
  // mid-tour). Subscribe to the store directly to dodge re-rendering on
  // every entity update.
  useEffect(() => {
    const unsub = useGarden.subscribe(() => {
      if (!checkPrecondition(tour.precondition)) onExit()
    })
    return unsub
  }, [tour.precondition, onExit])

  // Esc to skip.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
      if (e.key === 'ArrowRight') setStepIdx((i) => Math.min(i + 1, tour.steps.length - 1))
      if (e.key === 'ArrowLeft') setStepIdx((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onExit, tour.steps.length])

  if (!step) return null

  const pos = placeTooltip(rect, cardSize.w, cardSize.h)
  const isLast = stepIdx === tour.steps.length - 1
  const targetMissing = step.target !== null && rect === null

  return (
    <>
      <Spotlight rect={rect} pad={step.pad ?? 8} />
      <div
        style={{ ...TOOLTIP_STYLE, left: pos.left, top: pos.top }}
        ref={(el) => {
          if (el) {
            const r = el.getBoundingClientRect()
            if (Math.abs(r.width - cardSize.w) > 2 || Math.abs(r.height - cardSize.h) > 2) {
              setCardSize({ w: r.width, h: r.height })
            }
          }
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#4ec9ff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {tour.title} — step {stepIdx + 1} / {tour.steps.length}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
        <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.45 }}>{step.body}</div>
        {targetMissing && (
          <div style={{ fontSize: 11, color: '#ffaa55', marginTop: 8, fontStyle: 'italic' }}>
            (this control isn't currently visible — switch to the right mode to see it)
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'space-between' }}>
          <button
            onClick={onExit}
            style={{
              background: 'transparent',
              color: '#888',
              border: 'none',
              fontSize: 11,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            Skip
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
              style={{
                background: '#2a2d31',
                color: stepIdx === 0 ? '#555' : '#ddd',
                border: '1px solid #444',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: stepIdx === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={() => {
                if (isLast) onExit()
                else setStepIdx((i) => i + 1)
              }}
              style={{
                background: 'rgba(60, 130, 200, 0.85)',
                color: '#fff',
                border: '1px solid #4a90c8',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {isLast ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default function TourSystem() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTour, setActiveTour] = useState<Tour | null>(null)
  // We want the menu to re-render when selection changes (tour availability
  // depends on it). Subscribe by reading primarySelectedIds.length.
  const selectionCount = useGarden((s) => s.primarySelectedIds.length)

  // Close the menu on Esc.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [menuOpen])

  return (
    <>
      {!activeTour && (
        <button
          style={HELP_BUTTON_STYLE}
          onClick={() => setMenuOpen((v) => !v)}
          title="Help / guided tours"
          aria-label="Open help menu"
        >
          ?
        </button>
      )}
      {menuOpen && !activeTour && (
        <div style={MENU_STYLE} onPointerDown={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: '#4ec9ff', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 10px 8px' }}>
            Guided tours
          </div>
          {TOURS.map((tour) => {
            const available = checkPrecondition(tour.precondition)
            const hint = available ? '' : preconditionHint(tour.precondition)
            return (
              <button
                key={tour.id}
                style={{
                  ...MENU_ITEM_STYLE,
                  opacity: available ? 1 : 0.5,
                  cursor: available ? 'pointer' : 'not-allowed',
                }}
                disabled={!available}
                onClick={() => {
                  if (!available) return
                  setActiveTour(tour)
                  setMenuOpen(false)
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e5e5', marginBottom: 2 }}>
                  {tour.title}
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>{tour.description}</div>
                {!available && (
                  <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 2, fontStyle: 'italic' }}>
                    {hint}
                  </div>
                )}
              </button>
            )
          })}
          <div style={{ fontSize: 10, color: '#666', padding: '6px 10px 0', borderTop: '1px solid #333', marginTop: 4 }}>
            Esc to close. {selectionCount > 0 ? `${selectionCount} selected.` : ''}
          </div>
        </div>
      )}
      {activeTour && <TourPlayer tour={activeTour} onExit={() => setActiveTour(null)} />}
    </>
  )
}
