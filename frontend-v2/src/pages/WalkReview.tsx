/**
 * /walk-mode/<sessionId>/review — staging review for a finished walk.
 *
 * Polls the backend's review endpoint every 4s while captures are still in
 * `Pending` so the operator sees AI proposals appear as the classification
 * worker drains them. Each capture renders a thumbnail + proposals list with
 * accept/reject buttons; promoting creates a `GardenEntity` (the 3D scene
 * picks it up via the existing SignalR pipeline, but only the operator's
 * other browser tab will see that — this page deliberately stays text-only).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  getReview,
  promoteCapture,
  rejectCapture,
  type CaptureView,
  type ClassificationProposalView,
  type WalkReviewView,
} from '../api/walkMode'

interface Props {
  sessionId: string
}

const cardStyle: React.CSSProperties = {
  background: '#222',
  padding: '12px',
  margin: '10px 0',
  borderRadius: '10px',
  border: '1px solid #333',
}

const acceptBtn: React.CSSProperties = {
  background: '#4caf50',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  padding: '8px 14px',
  fontSize: '14px',
  cursor: 'pointer',
  marginRight: '6px',
}

const rejectBtn: React.CSSProperties = {
  background: '#c62828',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  padding: '8px 14px',
  fontSize: '14px',
  cursor: 'pointer',
}

const POLL_INTERVAL_MS = 4000

export default function WalkReview({ sessionId }: Props) {
  const [review, setReview] = useState<WalkReviewView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const v = await getReview(sessionId)
      setReview(v)
      setError(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!review) return
    const stillPending = review.captures.some((c) => c.status === 'Pending')
    if (!stillPending) return
    const t = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [review, refresh])

  if (error) {
    return (
      <Wrapper>
        <div style={{ ...cardStyle, background: '#3a1f1f', borderColor: '#c62828' }}>
          Failed to load review: {error}
        </div>
      </Wrapper>
    )
  }
  if (!review) {
    return (
      <Wrapper>
        <div style={cardStyle}>Loading review…</div>
      </Wrapper>
    )
  }

  const { session, captures } = review
  return (
    <Wrapper>
      <h1 style={{ fontSize: '22px', margin: '8px 0' }}>Walk Review</h1>
      <div style={cardStyle} data-testid="review-session-summary">
        <div>
          Status: <strong>{session.status}</strong>
        </div>
        <div>Started: {new Date(session.startedUtc).toLocaleString()}</div>
        {session.endedUtc && <div>Ended: {new Date(session.endedUtc).toLocaleString()}</div>}
        {session.note && <div style={{ marginTop: '4px', color: '#aaa' }}>Note: {session.note}</div>}
        <div style={{ marginTop: '6px', color: '#aaa' }}>
          {captures.length} capture{captures.length === 1 ? '' : 's'}
        </div>
      </div>

      {captures.length === 0 && (
        <div style={cardStyle}>No captures recorded.</div>
      )}

      {captures.map((c) => (
        <CaptureCard key={c.id} capture={c} onChanged={refresh} />
      ))}

      <div style={{ marginTop: '24px', textAlign: 'center' }}>
        <button
          data-testid="back-to-walk-mode"
          style={{
            background: '#444',
            color: '#ddd',
            border: '1px solid #555',
            borderRadius: '6px',
            padding: '10px 20px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
          onClick={() => {
            window.history.pushState(null, '', '/walk-mode')
            window.dispatchEvent(new PopStateEvent('popstate'))
          }}
        >
          Back to Walk Mode
        </button>
      </div>
    </Wrapper>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
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
      {children}
    </div>
  )
}

interface CaptureCardProps {
  capture: CaptureView
  onChanged: () => void | Promise<void>
}

function CaptureCard({ capture, onChanged }: CaptureCardProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const handlePromote = async (p: ClassificationProposalView) => {
    setBusy(`promote-${p.id}`)
    setLocalError(null)
    try {
      await promoteCapture(capture.id, p.id)
      await onChanged()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async () => {
    setBusy('reject')
    setLocalError(null)
    try {
      await rejectCapture(capture.id)
      await onChanged()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={cardStyle} data-testid={`capture-${capture.id}`} data-status={capture.status}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <img
          src={capture.photoUrl}
          alt="capture"
          style={{
            width: '120px',
            height: '120px',
            objectFit: 'cover',
            borderRadius: '6px',
            background: '#111',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '13px', color: '#aaa' }}>
            {new Date(capture.capturedUtc).toLocaleString()}
          </div>
          <div style={{ fontSize: '13px', color: '#aaa', marginTop: '2px' }}>
            Status: <strong style={{ color: statusColor(capture.status) }}>{capture.status}</strong>
          </div>
          {capture.gpsLat != null && capture.gpsLng != null && (
            <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
              GPS: {capture.gpsLat.toFixed(6)}, {capture.gpsLng.toFixed(6)}
              {capture.gpsAccuracyMeters != null && ` (±${capture.gpsAccuracyMeters.toFixed(0)} m)`}
            </div>
          )}
          {capture.manualReadings.length > 0 && (
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
              Readings:{' '}
              {capture.manualReadings.map((r, i) => (
                <span key={i}>
                  {r.tool}: {r.value} {r.unit}
                  {i < capture.manualReadings.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
          {capture.note && (
            <div style={{ fontSize: '13px', color: '#bbb', marginTop: '4px' }}>
              "{capture.note}"
            </div>
          )}
          {capture.classificationError && (
            <div style={{ fontSize: '12px', color: '#ff8a80', marginTop: '4px' }}>
              classification error: {capture.classificationError}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '12px' }}>
        {capture.proposals.length === 0 && capture.status === 'Pending' && (
          <em style={{ color: '#888' }}>Awaiting classification…</em>
        )}
        {capture.proposals.length === 0 && capture.status !== 'Pending' && capture.status !== 'Promoted' && (
          <em style={{ color: '#888' }}>No proposals.</em>
        )}
        {capture.proposals.map((p) => (
          <div
            key={p.id}
            data-testid={`proposal-${p.id}`}
            style={{
              padding: '8px',
              margin: '6px 0',
              background: '#1a1a1a',
              borderRadius: '6px',
              border: '1px solid #2a2a2a',
            }}
          >
            <div style={{ fontSize: '14px' }}>
              <strong>{p.kind}</strong> — {(p.confidence * 100).toFixed(0)}% confidence
            </div>
            {p.promotedEntityId ? (
              <div style={{ fontSize: '12px', color: '#81c784', marginTop: '4px' }}>
                promoted → entity {p.promotedEntityId.slice(0, 8)}…
              </div>
            ) : capture.status === 'Rejected' ? (
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                capture rejected
              </div>
            ) : (
              <div style={{ marginTop: '8px' }}>
                <button
                  style={acceptBtn}
                  onClick={() => handlePromote(p)}
                  disabled={busy != null}
                  data-testid={`promote-${p.id}`}
                >
                  {busy === `promote-${p.id}` ? 'Promoting…' : 'Promote'}
                </button>
              </div>
            )}
          </div>
        ))}
        {capture.status !== 'Rejected' && capture.status !== 'Promoted' && (
          <button
            style={rejectBtn}
            onClick={handleReject}
            disabled={busy != null}
            data-testid={`reject-${capture.id}`}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject capture'}
          </button>
        )}
        {localError && (
          <div style={{ marginTop: '6px', color: '#ff8a80', fontSize: '12px' }}>
            {localError}
          </div>
        )}
      </div>
    </div>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case 'Pending':
      return '#ffd54f'
    case 'Classified':
      return '#64b5f6'
    case 'ClassificationFailed':
      return '#ff8a80'
    case 'Promoted':
      return '#81c784'
    case 'Rejected':
      return '#bdbdbd'
    default:
      return '#ddd'
  }
}
