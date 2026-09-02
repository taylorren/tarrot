// Shared types for the reading domain.

export interface Card {
  name: string
  file: string
  src: string
  reversed?: boolean
}

/** A picked card in its position, ready to send to the AI. */
export interface AskedCard {
  name: string
  reversed: boolean
  position: number
}

export interface ReadingResponse {
  reading: string
  thread: string
  quota?: Quota
}

export interface PreviousReadingResponse {
  question: string
  cards: AskedCard[]
  reading: string
  thread: string
  quota: Quota
}

export interface Quota {
  used: number
  limit: number | null
  resetAt: number
}

export type AiStage = 'idle' | 'loading' | 'done' | 'error' | 'quota'
export type Phase = 'intro' | 'reading'

/** Thrown when the server answers 429 — carries the quota snapshot. */
export class QuotaError extends Error {
  quota: Quota
  constructor(quota: Quota) {
    super('quota exhausted')
    this.name = 'QuotaError'
    this.quota = quota
  }
}