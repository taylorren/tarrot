import { ref } from 'vue'
import { drawOne } from '../lib/cards'
import { fetchReading, fetchQuota } from '../lib/api'
import { QuotaError, type AiStage, type Card, type Phase, type Quota, type ReadingResponse } from '../lib/types'

// Module-level singleton store (shared by all components via useReading()).
const phase = ref<Phase>('intro')
const questionText = ref('')
// Three empty slots — each card is drawn only when the user flips it.
const chosen = ref<(Card | null)[]>([null, null, null])
const drawn = ref(0) // how many cards revealed (0..3)

const aiStage = ref<AiStage>('idle')
const aiReading = ref('')
const aiThread = ref('')

// Daily allowance, refreshed from the server (never trusted from the client).
const quota = ref<Quota>({ used: 0, limit: 3, resetAt: 0 })

let pending: Promise<ReadingResponse> | null = null
let abort: AbortController | null = null

function applyQuota(q?: Quota) {
  if (q) quota.value = q
}

/** Free pre-flight so the intro screen can show today's allowance. */
async function refreshQuota() {
  try { applyQuota(await fetchQuota()) } catch { /* offline — keep last known */ }
}

/**
 * Called only after the third card is revealed — this is the moment a usage
 * is deducted and the AI is actually asked. Keeping the call here (instead of
 * prefetching at start) means an abandoned reading never costs the user quota.
 */
function requestReading() {
  abort?.abort()
  abort = new AbortController()
  const q = questionText.value
  // Only called after all 3 cards are drawn — filter is order-preserving here.
  const cards = chosen.value
    .filter((c): c is Card => c !== null)
    .map((c, i) => ({ name: c.name, reversed: !!c.reversed, position: i }))
  const p = fetchReading(q, cards, abort.signal)
  pending = p
  return p
}

function start(question: string) {
  questionText.value = question.trim() || '此刻有什么正停留在我心里'
  chosen.value = [null, null, null] // cards are drawn at click-time
  drawn.value = 0
  aiStage.value = 'idle'
  aiReading.value = ''
  aiThread.value = ''
  pending = null
  phase.value = 'reading'
  // No AI call yet — quota is only consumed once all 3 cards are revealed.
}

function drawCard(index: number) {
  if (index !== drawn.value || index >= chosen.value.length) return
  const taken = chosen.value.filter((c): c is Card => c !== null).map((c) => c.name)
  chosen.value[index] = drawOne(taken) // drawn at the moment of the flip
  drawn.value++
  if (drawn.value >= chosen.value.length) showAi()
}

async function showAi() {
  const p = pending ?? requestReading()
  aiStage.value = 'loading'
  try {
    const data = await p
    aiReading.value = data.reading
    aiThread.value = data.thread
    applyQuota(data.quota)
    aiStage.value = 'done'
  } catch (err) {
    if (err instanceof QuotaError) {
      applyQuota(err.quota)
      aiStage.value = 'quota'
    } else {
      aiStage.value = 'error'
    }
  }
}

function retryAi() {
  if (quota.value.limit !== null && quota.value.used >= quota.value.limit) { aiStage.value = 'quota'; return }
  pending = null
  showAi()
}

function reset() {
  abort?.abort()
  abort = null
  pending = null
  phase.value = 'intro'
  drawn.value = 0
  chosen.value = [null, null, null]
  refreshQuota()
}

// Re-export refs as lifecycle-stable getters via a small wrapper, so callers
// can destructure `const { phase } = useReading()` and keep reactivity.
export function useReading() {
  return {
    phase, questionText, chosen, drawn, aiStage, aiReading, aiThread, quota,
    start, drawCard, retryAi, reset, refreshQuota,
  }
}