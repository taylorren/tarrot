import { QuotaError, type AskedCard, type PreviousReadingResponse, type Quota, type ReadingResponse } from './types'

/** Lightweight pre-flight check — free, never consumes quota. */
export async function fetchQuota(): Promise<Quota> {
  const res = await fetch('/api/quota')
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

/** Retrieves the completed reading that is currently protected by cooldown. */
export async function fetchPreviousReading(): Promise<PreviousReadingResponse> {
  const res = await fetch('/api/previous-reading')
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

/** Call the backend `/api/reading`, which proxies to the Ollama cloud API. */
export async function fetchReading(
  question: string,
  cards: AskedCard[],
  signal?: AbortSignal,
): Promise<ReadingResponse> {
  const res = await fetch('/api/reading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ question, cards }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<ReadingResponse> & { error?: string }
  if (res.status === 429) {
    throw new QuotaError(
      (data.quota as Quota) || { used: 1, limit: 1, resetAt: Date.now() + 4 * 3600_000 },
    )
  }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`)
  return data as ReadingResponse
}