import { QuotaError, type AskedCard, type Quota, type ReadingResponse } from './types'

/** The user's timezone offset in minutes (Date#getTimezoneOffset convention). */
export const tzOffset = () => new Date().getTimezoneOffset()

/** Lightweight pre-flight check — free, never consumes quota. */
export async function fetchQuota(): Promise<Quota> {
  const res = await fetch(`/api/quota?tz=${tzOffset()}`)
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
    body: JSON.stringify({ question, cards, tzOffset: tzOffset() }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<ReadingResponse> & { error?: string }
  if (res.status === 429) {
    throw new QuotaError(
      (data.quota as Quota) || { used: 3, limit: 3, resetAt: Date.now() + 3600_000 },
    )
  }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`)
  return data as ReadingResponse
}