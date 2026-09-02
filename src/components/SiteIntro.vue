<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DEFAULT_QUESTION } from '../lib/spread'
import { useReading } from '../store/reading'

const emit = defineEmits<{ (e: 'start', question: string): void }>()
const { quota, refreshQuota, resumePreviousReading } = useReading()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  refreshQuota()
  clock = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => clearInterval(clock))

const coolingDown = computed(() =>
  quota.value.limit !== null && quota.value.used >= quota.value.limit && quota.value.resetAt > now.value,
)

const cooldownLabel = computed(() => {
  if (!quota.value.resetAt) return ''
  const remainingMs = Math.max(0, quota.value.resetAt - now.value)
  let hours = Math.floor(remainingMs / 3600_000)
  let minutes = Math.ceil((remainingMs % 3600_000) / 60_000)
  if (minutes === 60) {
    hours++
    minutes = 0
  }
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${Math.max(1, minutes)} 分钟`
})

const remainingLabel = computed(() =>
  quota.value.limit === null
    ? '开发模式 · 不限次数'
    : quota.value.used < quota.value.limit
      ? '可以开始一次新的解读'
      : `${cooldownLabel.value}可以再次解读`,
)

const prompts = ['我需要做出的一个选择', '我正在逃避的事', '我想守护的能量']

function submit() {
  emit('start', q.value.trim() || DEFAULT_QUESTION)
}
function usePrompt(text: string) {
  q.value = text
  input.value?.focus()
}

async function resume() {
  await resumePreviousReading()
}
</script>

<template>
  <section class="intro" id="intro">
    <p class="eyebrow">五分钟的心灵笔记 · {{ remainingLabel }}</p>
    <h1>为一个<br /><em>诚实的问题留出空间。</em></h1>
    <p class="intro-copy">不是预言，而是换个角度，看见此刻正向你索求关注的事。</p>

    <div v-if="coolingDown" class="cooldown-panel" aria-live="polite">
      <p>下次解读还有 {{ cooldownLabel }}</p>
      <button type="button" @click="resume">重读上一次解读 <span>↗</span></button>
    </div>

    <form v-else class="question-form" @submit.prevent="submit">
      <label for="question">今天，有什么正停留在你心里？</label>
      <div class="input-wrap">
        <input
          id="question"
          ref="input"
          v-model="q"
          name="question"
          maxlength="130"
          autocomplete="off"
          placeholder="我一直在想着……"
        />
        <button type="submit">开始 <span>→</span></button>
      </div>
      <div class="suggestions" aria-label="问题提示">
        <button v-for="p in prompts" :key="p" type="button" @click="usePrompt(p)">{{ p }}</button>
      </div>
    </form>

    <p class="landing-disclaimer">
      解读用于自我觉察，不构成医疗、法律、财务或其他专业建议。为在冷却期间重读本次内容，
      我们会暂存你的问题、牌面与解读，并在四小时后删除。
    </p>
  </section>
</template>