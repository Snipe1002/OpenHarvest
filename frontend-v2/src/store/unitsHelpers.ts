/**
 * unitsHelpers — display-and-input layer for converting between the internal
 * coordinate model (always meters) and the user's preferred display units.
 *
 * The store keeps everything in meters. UI components call `formatLength` to
 * render a value, and `parseLength` to interpret a user input string back
 * into meters before committing to the store / API.
 *
 * Design notes:
 *   - Internal meters are NEVER rewritten. Backend payloads stay in meters.
 *   - In imperial mode, lengths are formatted as feet+inches with quote/prime
 *     marks (e.g. `5'0"`, `0'6"`). For values < 1 ft we still emit the same
 *     `0'N"` form so parsers don't choke on a bare `6"` round-trip.
 *   - parseLength is permissive: `"5'0\""`, `"5ft"`, `"5 ft 6 in"`, `"60in"`,
 *     `"60\""`, `"1.5"` (interpreted as ft in imperial / m in metric), etc.
 *   - parseLength returns `null` on unparseable input; callers fall back to
 *     the previous value.
 */

export type Units = 'metric' | 'imperial'

const M_PER_FT = 0.3048
const M_PER_IN = 0.0254

/** A unit-system-aware short label, e.g. `m` or `ft`. */
export function unitDisplay(units: Units): string {
  return units === 'metric' ? 'm' : 'ft'
}

/**
 * Format a length in meters into a string for display, in the active unit
 * system. Metric: `1.52 m`. Imperial: `5'0"` (rounded to nearest inch).
 *
 * `precision` only applies to metric (decimal places, default 2). In imperial
 * we always round to whole inches; finer precision hits the snap grid anyway.
 */
export function formatLength(meters: number, units: Units, precision = 2): string {
  if (!Number.isFinite(meters)) return units === 'metric' ? '0 m' : "0'0\""
  if (units === 'metric') {
    const rounded = roundTo(meters, precision)
    return `${trimZeros(rounded.toFixed(precision))} m`
  }
  // Imperial: convert to total inches, round, split into ft + in.
  const totalIn = meters / M_PER_IN
  const sign = totalIn < 0 ? -1 : 1
  const absRounded = Math.round(Math.abs(totalIn))
  const ft = Math.floor(absRounded / 12)
  const inch = absRounded - ft * 12
  const signStr = sign < 0 ? '-' : ''
  return `${signStr}${ft}'${inch}"`
}

/**
 * Parse a user-typed length string into meters, given the active unit system.
 * Returns `null` when the input can't be made sense of.
 *
 * Recognized forms (case-insensitive, whitespace-tolerant):
 *   - `1.52`          — bare number; metric:m, imperial:ft
 *   - `1.52 m`        — explicit meters
 *   - `152 cm`        — centimeters
 *   - `1520 mm`       — millimeters
 *   - `5'0"`          — feet+inches with prime/quote
 *   - `5' 0"`         — same, with whitespace
 *   - `5 ft 0 in`     — words
 *   - `5ft`, `5 feet` — feet only
 *   - `60in`, `60"`   — inches only
 *   - leading `-` allowed for negative values
 */
export function parseLength(input: string, units: Units): number | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().toLowerCase()
  if (raw.length === 0) return null

  // Bare number — interpret as the active unit's "default" (m for metric,
  // ft for imperial). This is what the user sees when an input field shows
  // a value and they tweak the digits without re-typing the unit suffix.
  const bare = Number(raw)
  if (Number.isFinite(bare) && /^[-+]?\d*\.?\d+$/.test(raw)) {
    return units === 'metric' ? bare : bare * M_PER_FT
  }

  // Strip optional leading sign.
  let rest = raw
  let sign = 1
  if (rest.startsWith('-')) {
    sign = -1
    rest = rest.slice(1).trimStart()
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1).trimStart()
  }

  // Try metric suffixes first (works in either units mode — explicit wins).
  const metricMatch = rest.match(/^([\d.]+)\s*(mm|cm|m)$/)
  if (metricMatch) {
    const n = Number(metricMatch[1])
    if (!Number.isFinite(n)) return null
    const factor = metricMatch[2] === 'mm' ? 0.001 : metricMatch[2] === 'cm' ? 0.01 : 1
    return sign * n * factor
  }

  // Imperial: feet+inches in many shapes.
  // 1) `5'0"` or `5' 0"` or `5'0` or `5'`
  const ftInPrime = rest.match(/^([\d.]+)\s*['′]\s*([\d.]*)\s*(?:["″]|in|inch|inches)?$/)
  if (ftInPrime) {
    const ft = Number(ftInPrime[1])
    const inch = ftInPrime[2].length > 0 ? Number(ftInPrime[2]) : 0
    if (!Number.isFinite(ft) || !Number.isFinite(inch)) return null
    return sign * (ft * M_PER_FT + inch * M_PER_IN)
  }

  // 2) `5 ft 6 in` / `5feet6inches` / `5ft`
  const ftWords = rest.match(/^([\d.]+)\s*(?:ft|feet|foot)(?:\s*([\d.]+)\s*(?:in|inch|inches|["″])?)?$/)
  if (ftWords) {
    const ft = Number(ftWords[1])
    const inch = ftWords[2] ? Number(ftWords[2]) : 0
    if (!Number.isFinite(ft) || !Number.isFinite(inch)) return null
    return sign * (ft * M_PER_FT + inch * M_PER_IN)
  }

  // 3) Inches only: `60in`, `60"`, `60 inches`
  const inOnly = rest.match(/^([\d.]+)\s*(?:in|inch|inches|["″])$/)
  if (inOnly) {
    const inch = Number(inOnly[1])
    if (!Number.isFinite(inch)) return null
    return sign * inch * M_PER_IN
  }

  return null
}

/**
 * Convert a value displayed in the active units back to meters, given the
 * user typed a bare number (no unit suffix). Useful for `step` math in
 * NumberField where the input box's underlying value is the active-unit
 * scalar and the spinner buttons increment by `step` in that scalar.
 */
export function bareToMeters(value: number, units: Units): number {
  if (!Number.isFinite(value)) return 0
  return units === 'metric' ? value : value * M_PER_FT
}

/**
 * Convert internal meters to the active-unit scalar for putting into a
 * NumberField's `value` prop. Round to a sensible precision so the input
 * doesn't show `1.5239999999`.
 */
export function metersToBare(meters: number, units: Units): number {
  if (!Number.isFinite(meters)) return 0
  if (units === 'metric') return roundTo(meters, 3)
  return roundTo(meters / M_PER_FT, 3)
}

function roundTo(n: number, digits: number): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

function trimZeros(s: string): string {
  // "1.50" -> "1.5", "1.00" -> "1", but leave "1.52" alone.
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}
