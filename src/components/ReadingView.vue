<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useReading } from '../store/reading'
import { instructionCopy } from '../lib/spread'
import CardSlot from './CardSlot.vue'
import Reflection from './Reflection.vue'
import AiReading from './AiReading.vue'
import ReadingFooter from './ReadingFooter.vue'

const emit = defineEmits<{ (e: 'start-over'): void }>()
const { questionText, chosen, drawn, drawCard, quota } = useReading()

const slotRefs = ref<InstanceType<typeof CardSlot>[]>([])
const finished = computed(() => drawn.value >= chosen.value.length)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

const coolingDown = computed(() =>
  quota.value.limit !== null && quota.value.used >= quota.value.limit && quota.value.resetAt > now.value,
)
const cooldownLabel = computed(() => {
  const remainingMs = Math.max(0, quota.value.resetAt - now.value)
  let hours = Math.floor(remainingMs / 3600_000)
  let minutes = Math.ceil((remainingMs % 3600_000) / 60_000)
  if (minutes === 60) {
    hours++
    minutes = 0
  }
  return `下次解读还有 ${hours} 小时 ${minutes} 分钟`
})

// Highlight copy: after revealing card i, show instructions for the next stage.
const heading = computed(() => {
  const last = drawn.value - 1
  return drawn.value === 0
    ? '让第一张图像缓缓到来。'
    : instructionCopy[Math.min(last, instructionCopy.length - 1)]
})

function focusNext() {
  const i = drawn.value
  if (i < chosen.value.length) {
    nextTick(() => {
      slotRefs.value[i]?.buttonEl?.focus({ preventScroll: true })
    })
  }
}
onMounted(() => {
  focusNext()
  clock = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => clearInterval(clock))
watch(drawn, focusNext)
</script>

<template>
  <section class="reading" id="reading">
    <div class="reading-topline">
      <button
        class="back-button"
        id="start-over"
        type="button"
        :disabled="coolingDown"
        :aria-live="coolingDown ? 'polite' : undefined"
        @click="emit('start-over')"
      >{{ coolingDown ? cooldownLabel : '← 换一个问题' }}</button>
      <p class="question-echo" id="question-echo" aria-label="你的问题">
        <span class="echo-mark">关于</span><span class="echo-text">{{ questionText }}</span>
      </p>
      <div class="draw-count" role="status" aria-live="polite" :aria-label="`已翻开 ${drawn} / 3 张`">
        <span class="dots" aria-hidden="true">
          <i v-for="i in 3" :key="i" :class="{ filled: drawn >= i }"></i>
        </span>
        <span class="count-text"><b>{{ drawn }}</b> / 3 已翻开</span>
      </div>
    </div>
    <div class="reading-heading">
      <p class="eyebrow">你的心灵笔记</p>
      <h2 id="reading-title" aria-live="polite" aria-atomic="true">{{ heading }}</h2>
    </div>

    <div class="spread" id="spread">
      <CardSlot
        v-for="(card, i) in chosen"
        :key="i"
        ref="slotRefs"
        :card="card"
        :index="i"
        :revealed="drawn > i"
        :enabled="drawn === i"
        @draw="drawCard"
      />
    </div>

    <div v-if="finished" class="reading-results">
      <div class="reading-results-copy">
        <p class="result-question"><span>关于这个问题</span>{{ questionText }}</p>
        <Reflection />
        <AiReading />
      </div>
      <ReadingFooter />
    </div>
  </section>
</template>