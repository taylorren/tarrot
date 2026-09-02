<script setup lang="ts">
import { computed } from 'vue'
import { useReading } from '../store/reading'
import { useToast } from '../composables/useToast'
import { buildMarkdown } from '../lib/markdown'
import type { Card } from '../lib/types'

const { chosen, questionText, aiReading, aiThread, aiStage } = useReading()
const { show } = useToast()

// Enabled once we're past loading (success or error) — so the user can always
// copy the manual cards + reminder, and gets the AI block once it's ready.
const disabled = computed(() => aiStage.value === 'loading')

async function onCopy() {
  const cards = chosen.value.filter((c): c is Card => c !== null)
  const text = buildMarkdown(
    questionText.value,
    cards,
    aiReading.value,
    aiThread.value,
    aiStage.value === 'done',
  )
  try {
    await navigator.clipboard.writeText(text)
    show()
  } catch {
    window.prompt('复制这份解读：', text) // clipboard blocked — fall back
  }
}
</script>

<template>
  <footer class="reading-footer" id="reading-footer">
    <button id="save-note" type="button" :disabled="disabled" @click="onCopy">
      复制整份解读 <span>↗</span>
    </button>
    <p class="footer-hint">含你的问题、三张牌、提醒与 AI 解读</p>
  </footer>
</template>