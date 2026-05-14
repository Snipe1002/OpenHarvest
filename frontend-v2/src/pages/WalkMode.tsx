/**
 * /walk-mode — the phone-facing capture flow.
 *
 * UI shape (mobile-first): large central buttons, the GPS-on banner sits at
 * the top, a "tap to capture" photo button uses the native camera input,
 * three small input rows for analog tool readings, and a row of Start/End
 * walk buttons at the bottom. The page deliberately avoids any 3D content —
 * walk-mode runs cleanly on a low-power phone, possibly under bright sun.
 *
 * The page is route-driven (App-level router in App.tsx) — no react-router
 * dependency.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { listYards } from '../api/walkMode'
import { useWalkMode } from '../store/walkMode'
import type { ManualReading } from '../api/walkMode'

const cardStyle: React.CSSProperties = {
  background: '#222',
  padding: '16px',
  margin: '12px 0',
  borderRadius: '10px',
  border: '1px solid #333',
}

const buttonBase: React.CSSProperties = {
  padding: '20px',
  fontSize: '18px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  width: '100%',
  marginTop: '12px',
}

const primaryButton: React.CSSProperties = {
  ...buttonBase,
  background: '#4caf50',
  color: 'white',
}

const dangerButton: React.CSSProperties = {
  ...buttonBase,
  background: '#c62828',
  color: 'white',
}

const captureButton: React.CSSProperties = {
  ...buttonBase,
  background: '#1976d2',
  color: 'white',
  padding: '32px',
  fontSize: '22px',
}

const secondaryButton: React.CSSProperties = {
  ...buttonBase,
  background: '#444',
  color: '#ddd',
  fontSize: '16px',
  padding: '12px',
  marginTop: '8px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  fontSize: '16px',
  background: '#111',
  color: '#ddd',
  border: '1px solid #444',
  borderRadius: '6px',
  boxSizing: 'border-box',
}

export default function WalkMode() {
  const currentSession = useWalkMode((s) => s.currentSession)
  const yards = useWalkMode((s) => s.yards)
  const captures = useWalkMode((s) => s.captures)
  const gps = useWalkMode((s) => s.gps)
  const gpsActive = useWalkMode((s) => s.gpsActive)
  const gpsError = useWalkMode((s) => s.gpsError)
  const capturing = useWalkMode((s) => s.capturing)
  const lastError = useWalkMode((s) => s.lastError)
  const setYards = useWalkMode((s) => s.setYards)
  const startWalkAction = useWalkMode((s) => s.startWalkAction)
  const addCaptureAction = useWalkMode((s) => s.addCaptureAction)
  const endWalkAction = useWalkMode((s) => s.endWalkAction)
  const startGps = useWalkMode((s) => s.startGps)
  const hydrate = useWalkMode((s) => s.hydrate)
  const clearError = useWalkMode((s) => s.clearError)

  const [selectedYardId, setSelectedYardId] = useState<string>('')
  const [walkNote, setWalkNote] = useState<string>('')
  const [readings, setReadings] = useState<ManualReading[]>([
    { tool: '', value: 0, unit: '' },
  ])
  const [captureNote, setCaptureNote] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    hydrate()
    // Kick off geolocation as soon as the page loads so the operator sees the
    // accuracy banner stabilize before they tap Start Walk. If a session is
    // already in flight (hydrated from localStorage), this also restarts the
    // watcher after a tab refresh.
    startGps()
    // Fetch the yard list so the operator can pick one before starting.
    listYards()
      .then((ys) => {
        setYards(ys)
        if (ys.length > 0) setSelectedYardId((cur) => cur || ys[0].id)
      })
      .catch((err) => console.warn('listYards failed', err))
  }, [hydrate, startGps, setYards])

  const isActive = currentSession?.status === 'Active'

  // Pull a stable list of tool rows so the keys stay consistent across renders.
  const readingRows = useMemo(() => readings, [readings])

  const updateReading = (i: number, field: keyof ManualReading, value: string) => {
    setReadings((rows) =>
      rows.map((r, idx) =>
        idx === i
          ? {
              ...r,
              [field]: field === 'value' ? Number(value) || 0 : value,
            }
          : r,
      ),
    )
  }

  const addReadingRow = () =>
    setReadings((rows) => [...rows, { tool: '', value: 0, unit: '' }])

  const removeReadingRow = (i: number) =>
    setReadings((rows) => rows.filter((_, idx) => idx !== i))

  const handleStart = async () => {
    if (!selectedYardId) return
    clearError()
    try {
      await startWalkAction(selectedYardId, walkNote || undefined)
    } catch {
      /* lastError populated in store */
    }
  }

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Clear the input so the same file name can be selected again next round
    // (otherwise the browser fires no `change` event for repeat selections).
    e.target.value = ''
    const filteredReadings = readings.filter((r) => r.tool.trim().length > 0)
    try {
      await addCaptureAction(file, filteredReadings, captureNote || undefined)
      // Reset per-capture fields. Tool list stays — operator usually uses the
      // same probe set for the whole walk.
      setCaptureNote('')
    } catch {
      /* lastError populated in store */
    }
  }

  const handleEnd = async () => {
    clearError()
    try {
      const ended = await endWalkAction()
      if (ended) {
        // Auto-navigate to the review panel — the operator just finished a
        // walk, they want to see what landed in staging.
        const url = `${window.location.pathname.replace(/\/?$/, '')}/${ended.id}/review`
        window.history.pushState(null, '', url)
        // Trigger our App-level router by dispatching popstate.
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    } catch {
      /* */
    }
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflowY: 'auto',
        padding: '16px',
        boxSizing: 'border-box',
        background: '#181818',
        color: '#ddd',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <h1 style={{ fontSize: '24px', margin: '8px 0 16px' }}>Walk Mode</h1>

      <div
        style={{
          ...cardStyle,
          background: gpsActive && gps ? '#1f3a1f' : '#3a2a1f',
          borderColor: gpsActive && gps ? '#3c763d' : '#a07a3a',
        }}
        data-testid="gps-banner"
      >
        <strong>GPS:</strong>{' '}
        {gps
          ? `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${gps.accuracyMeters.toFixed(0)} m)`
          : gpsActive
          ? 'acquiring…'
          : 'off'}
        {gpsError && (
          <div style={{ marginTop: '6px', color: '#ff8a80', fontSize: '14px' }}>
            error: {gpsError}
          </div>
        )}
      </div>

      {lastError && (
        <div
          style={{
            ...cardStyle,
            background: '#3a1f1f',
            borderColor: '#c62828',
          }}
          data-testid="walk-error"
        >
          {lastError}
        </div>
      )}

      {!isActive && (
        <div style={cardStyle}>
          <label style={{ fontSize: '14px', color: '#aaa' }}>Yard</label>
          <select
            data-testid="yard-select"
            value={selectedYardId}
            onChange={(e) => setSelectedYardId(e.target.value)}
            style={{ ...inputStyle, marginTop: '4px' }}
          >
            <option value="">— pick yard —</option>
            {yards.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name} ({y.slug})
              </option>
            ))}
          </select>
          <label style={{ fontSize: '14px', color: '#aaa', marginTop: '12px', display: 'block' }}>
            Note (optional)
          </label>
          <input
            value={walkNote}
            onChange={(e) => setWalkNote(e.target.value)}
            placeholder="e.g. after spring rain"
            style={{ ...inputStyle, marginTop: '4px' }}
          />
          <button
            data-testid="start-walk"
            style={primaryButton}
            onClick={handleStart}
            disabled={!selectedYardId}
          >
            Start Walk
          </button>
        </div>
      )}

      {isActive && (
        <>
          <div style={cardStyle} data-testid="active-walk">
            <strong>Walk in progress.</strong>{' '}
            Captures: <span data-testid="capture-count">{captures.length}</span>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>
              Manual readings
            </div>
            {readingRows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr auto',
                  gap: '6px',
                  marginBottom: '6px',
                }}
              >
                <input
                  data-testid={`reading-tool-${i}`}
                  placeholder="tool"
                  value={r.tool}
                  onChange={(e) => updateReading(i, 'tool', e.target.value)}
                  style={inputStyle}
                />
                <input
                  data-testid={`reading-value-${i}`}
                  placeholder="value"
                  type="number"
                  value={r.value || ''}
                  onChange={(e) => updateReading(i, 'value', e.target.value)}
                  style={inputStyle}
                  inputMode="decimal"
                />
                <input
                  data-testid={`reading-unit-${i}`}
                  placeholder="unit"
                  value={r.unit}
                  onChange={(e) => updateReading(i, 'unit', e.target.value)}
                  style={inputStyle}
                />
                <button
                  onClick={() => removeReadingRow(i)}
                  style={{
                    background: '#333',
                    color: '#ddd',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    padding: '0 10px',
                    fontSize: '18px',
                  }}
                  aria-label={`remove reading ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button style={secondaryButton} onClick={addReadingRow}>
              + Add reading
            </button>
          </div>

          <div style={cardStyle}>
            <label style={{ fontSize: '14px', color: '#aaa' }}>Capture note</label>
            <input
              value={captureNote}
              onChange={(e) => setCaptureNote(e.target.value)}
              placeholder="e.g. north corner planter"
              style={{ ...inputStyle, marginTop: '4px' }}
              data-testid="capture-note"
            />

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleCapture}
              data-testid="capture-photo-input"
            />
            <button
              data-testid="capture-photo"
              style={captureButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={capturing}
            >
              {capturing ? 'Uploading…' : 'Tap to Capture Photo'}
            </button>
          </div>

          <div style={cardStyle}>
            <button data-testid="end-walk" style={dangerButton} onClick={handleEnd}>
              End Walk
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: '40px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
        Captures upload to the backend. AI classification runs after End Walk.
      </div>
    </div>
  )
}
