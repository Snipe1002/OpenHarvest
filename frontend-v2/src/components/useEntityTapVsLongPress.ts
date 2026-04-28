/**
 * useEntityTapVsLongPress — distinguishes a quick tap from a long-press on
 * an R3F entity mesh and dispatches selection accordingly.
 *
 * Why a hook (not just inline logic): four entity components — DemoBed,
 * DemoPlant, PrefabPlaceholder, UnknownDebugCube — all need the same
 * gesture. Centralizing avoids drift if we later tune the threshold or add
 * a small drag-tolerance to suppress accidental long-presses on slightly
 * shaky fingers.
 *
 * Gesture semantics (m#7c):
 *   - Pointer-down arms a `LONG_PRESS_MS` timer. If the user holds without
 *     lifting, we fire `selectEntity(id, additive, 'self-only')` — the
 *     hierarchy "extension" is suppressed so macro ops scope to just this
 *     entity. The timer also clears so the subsequent pointer-up doesn't
 *     re-fire selection.
 *   - Pointer-up before the timer fires is a tap: cancel the timer and run
 *     `selectEntity(id, additive, 'extend')` so descendants are auto-pulled
 *     in (default behavior — m#7 cascading visuals + m#10b fill-mode).
 *   - Pointer-cancel (e.g. browser swallows the gesture for a touchpad
 *     pinch-zoom) tears down the timer without firing selection. This
 *     matches the existing translate-mode guards and keeps us out of weird
 *     half-armed states.
 *
 * IMPORTANT: this hook is invoked by entity components whose `handlePointer*`
 * functions also dispatch translate-mode / group-translate paths. The caller
 * is responsible for SHORT-CIRCUITING those branches FIRST, before passing
 * the event to this hook. The hook only handles the selection arm of the
 * gesture; it never fights with drag.
 */
import { useEffect, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Guid } from '../api/types'
import { useGarden } from '../store/garden'

/**
 * Long-press threshold in milliseconds. 500ms matches Android's default
 * long-press timeout and is comfortably above iOS's 350ms minimum, so
 * neither platform will fire it by accident on a quick tap.
 */
export const LONG_PRESS_MS = 500

export interface EntityTapHandlers {
  /** Forward into the entity group's `onPointerDown`. */
  onTapPointerDown: (e: ThreeEvent<PointerEvent>) => void
  /** Forward into the entity group's `onPointerUp`. Only meaningful when
   *  the entity is NOT mid-translate-drag — caller should branch first. */
  onTapPointerUp: (e: ThreeEvent<PointerEvent>) => void
  /** Forward into the entity group's `onPointerCancel`/`onPointerLeave` if
   *  the caller wants extra robustness; pure cleanup, never fires select. */
  onTapPointerCancel: () => void
}

/**
 * Returns pointer handlers that fire a tap-or-long-press selection for the
 * given entity id. The component should already have decided that selection
 * (not drag) is the active interpretation of the gesture before delegating
 * to these handlers.
 */
export function useEntityTapVsLongPress(entityId: Guid): EntityTapHandlers {
  // We hold the timer id in a ref so the component never re-renders just
  // because the gesture phase changed. Cleared explicitly on tap, long-press
  // fire, cancel, or unmount.
  const timerRef = useRef<number | null>(null)
  // Stash the additive flag captured at pointer-down so pointer-up uses the
  // SAME modifier state. Otherwise a release just after the user let go of
  // shift would silently flip from extend to replace mid-gesture.
  const additiveRef = useRef<boolean>(false)

  const cancel = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // Cleanup if the component unmounts while a finger is still down. Hooks
  // must clean up timers — otherwise a long-press timer can fire after the
  // entity has been removed and call selectEntity on a stale id.
  useEffect(() => cancel, [])

  return {
    onTapPointerDown: (e: ThreeEvent<PointerEvent>) => {
      // Read the additive flag fresh from the store rather than capturing
      // it from a stale closure — multiSelectMode flips at runtime.
      const { multiSelectMode } = useGarden.getState()
      const additive = e.nativeEvent.shiftKey || multiSelectMode
      additiveRef.current = additive

      // Arm the long-press timer. If the user holds past LONG_PRESS_MS, we
      // fire 'self-only' selection (no descendant extension). The matching
      // pointer-up is then a no-op because timerRef is already cleared.
      cancel()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        useGarden.getState().selectEntity(entityId, additiveRef.current, 'self-only')
      }, LONG_PRESS_MS)
    },
    onTapPointerUp: (_e: ThreeEvent<PointerEvent>) => {
      // If the timer is still pending, this is a tap — fire 'extend' and
      // cancel the long-press timer so it doesn't fire after the fact.
      if (timerRef.current !== null) {
        cancel()
        useGarden.getState().selectEntity(entityId, additiveRef.current, 'extend')
      }
      // Otherwise the long-press timer already fired; nothing to do.
    },
    onTapPointerCancel: cancel,
  }
}
