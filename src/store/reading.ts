import { ref } from 'vue'
import { cards as deck, drawOne } from '../lib/cards'
import { fetchPreviousReading, fetchReading, fetchQuota } from '../lib/api'
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

// Reading cooldown, refreshed from the server (never trusted from the client).
const quota = ref<Quota>({ used: 0, limit: 3, resetAt: 0 })
const READING_STORAGE_KEY = 'tarrot:last-completed-reading'

let pending: Promise<ReadingResponse> | null = null
let abort: AbortController | null = null

interface SavedReading {
  question: string
  cards: Card[]
  reading: string
  thread: string
  resetAt: number
}

function applyQuota(q?: Quota) {
  if (q) quota.value = q
}

function isCoolingDown(q: Quota) {
  return q.limit !== null && q.used >= q.limit && q.resetAt > Date.now()
}

function restoreSavedReading(q: Quota) {
  if (!isCoolingDown(q)) return false
  try {
    const saved = JSON.parse(localStorage.getItem(READING_STORAGE_KEY) || '') as SavedReading
    if (saved.resetAt !== q.resetAt || !Array.isArray(saved.cards) || saved.cards.length !== 3) return false
    const resolved = saved.cards.map((c) => {
      const card = deck.find((d) => d.index === c.index) ?? deck.find((d) => d.name === c.name)
      return card ? { ...card, reversed: c.reversed } : null
    })
    if (resolved.some((card) => card === null)) return false
    questionText.value = saved.question
    chosen.value = resolved as Card[]
    drawn.value = saved.cards.length
    aiReading.value = saved.reading
    aiThread.value = saved.thread
    aiStage.value = 'done'
    phase.value = 'reading'
    return true
  } catch {
    return false
  }
}

function saveCompletedReading(q: Quota) {
  if (q.limit === null) return
  const saved: SavedReading = {
    question: questionText.value,
    cards: chosen.value.filter((card): card is Card => card !== null),
    reading: aiReading.value,
    thread: aiThread.value,
    resetAt: q.resetAt,
  }
  localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(saved))
}

/** Free pre-flight so the intro screen can show the next available reading. */
async function refreshQuota() {
  try {
    const nextQuota = await fetchQuota()
    applyQuota(nextQuota)
  } catch { /* offline — keep last known */ }
}

async function resumePreviousReading() {
  if (restoreSavedReading(quota.value)) return true
  if (!isCoolingDown(quota.value)) return false
  try {
    const previous = await fetchPreviousReading()
    const restoredCards = previous.cards
      .slice()
      .sort((first, second) => first.position - second.position)
      .map((asked) => {
        const card = deck.find((candidate) => candidate.index === asked.index) ?? deck.find((candidate) => candidate.name === asked.name)
        return card ? { ...card, reversed: asked.reversed } : null
      })
    if (restoredCards.some((card) => card === null) || restoredCards.length !== 3) return false
    const saved: SavedReading = {
      question: previous.question,
      cards: restoredCards as Card[],
      reading: previous.reading,
      thread: previous.thread,
      resetAt: previous.quota.resetAt,
    }
    localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(saved))
    applyQuota(previous.quota)
    return restoreSavedReading(previous.quota)
  } catch {
    return false
  }
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
    .map((c, i) => ({ index: c.index, name: c.name, reversed: !!c.reversed, position: i }))
  const p = fetchReading(q, cards, abort.signal)
  pending = p
  return p
}

function start(question: string) {
  if (restoreSavedReading(quota.value)) return
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
  const taken = chosen.value.filter((c): c is Card => c !== null).map((c) => c.index)
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
    if (data.quota) saveCompletedReading(data.quota)
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
    start, drawCard, retryAi, reset, refreshQuota, resumePreviousReading,
  }
}