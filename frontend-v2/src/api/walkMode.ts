/**
 * Walk-mode REST client. The shapes mirror the backend DTOs in
 * `src/OpenHarvest.API/Controllers/WalksController.cs` and `CapturesController.cs`.
 *
 * The base URL is shared with the gardens client (`apiBase`) so a single
 * `VITE_API_BASE` override moves both clients at once.
 */
import { apiBase } from './client'
import type { Guid } from './types'

const API_BASE = apiBase

export interface YardView {
  id: Guid
  slug: string
  name: string
  gardenId?: Guid | null
  centroidLat?: number | null
  centroidLng?: number | null
}

export type WalkSessionStatus = 'Active' | 'Ended' | 'Classified'

export interface WalkSessionView {
  id: Guid
  yardId: Guid
  startedUtc: string
  endedUtc?: string | null
  status: WalkSessionStatus
  note?: string | null
}

export type CaptureStatus =
  | 'Pending'
  | 'Classified'
  | 'ClassificationFailed'
  | 'Promoted'
  | 'Rejected'

export interface ManualReading {
  tool: string
  value: number
  unit: string
}

export interface ClassificationProposalView {
  id: Guid
  captureId: Guid
  kind: string
  confidence: number
  payload?: unknown
  promotedEntityId?: Guid | null
  createdUtc: string
}

export interface CaptureView {
  id: Guid
  walkSessionId: Guid
  yardId: Guid
  photoUrl: string
  capturedUtc: string
  gpsLat?: number | null
  gpsLng?: number | null
  gpsAccuracyMeters?: number | null
  manualReadings: ManualReading[]
  note?: string | null
  status: CaptureStatus
  classificationError?: string | null
  classifiedUtc?: string | null
  proposals: ClassificationProposalView[]
}

export interface WalkReviewView {
  session: WalkSessionView
  captures: CaptureView[]
}

export interface PromoteOverrides {
  name?: string | null
  sizeM?: { w?: number | null; h?: number | null; d?: number | null } | null
}

export interface PromoteResult {
  entityId: Guid
  gardenId: Guid
  captureId: Guid
  proposalId: Guid
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* */ }
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const listYards = (): Promise<YardView[]> => jsonFetch('/walks/yards')

export const startWalk = (yardId: Guid, note?: string): Promise<WalkSessionView> =>
  jsonFetch('/walks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ yardId, note: note ?? null }),
  })

export interface AddCaptureInput {
  photo: Blob
  gpsLat?: number | null
  gpsLng?: number | null
  gpsAccuracyM?: number | null
  manualReadings?: ManualReading[]
  note?: string | null
}

export const addCapture = (sessionId: Guid, input: AddCaptureInput): Promise<CaptureView> => {
  const form = new FormData()
  form.append(
    'Photo',
    input.photo,
    input.photo instanceof File ? input.photo.name : 'capture.jpg',
  )
  if (input.gpsLat != null) form.append('GpsLat', String(input.gpsLat))
  if (input.gpsLng != null) form.append('GpsLng', String(input.gpsLng))
  if (input.gpsAccuracyM != null) form.append('GpsAccuracyM', String(input.gpsAccuracyM))
  if (input.manualReadings && input.manualReadings.length > 0) {
    form.append('ManualReadings', JSON.stringify(input.manualReadings))
  }
  if (input.note) form.append('Note', input.note)
  return jsonFetch(`/walks/${sessionId}/captures`, { method: 'POST', body: form })
}

export const endWalk = (sessionId: Guid): Promise<WalkSessionView> =>
  jsonFetch(`/walks/${sessionId}/end`, { method: 'POST' })

export const getReview = (sessionId: Guid): Promise<WalkReviewView> =>
  jsonFetch(`/walks/${sessionId}/review`)

export const promoteCapture = (
  captureId: Guid,
  entityProposalId: Guid,
  overrides?: PromoteOverrides | null,
): Promise<PromoteResult> =>
  jsonFetch(`/captures/${captureId}/promote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entityProposalId, overrides: overrides ?? null }),
  })

export const rejectCapture = (captureId: Guid): Promise<void> =>
  jsonFetch(`/captures/${captureId}/reject`, { method: 'POST' })
