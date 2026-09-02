<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_QUESTION } from '../lib/spread'
import { useReading } from '../store/reading'

const emit = defineEmits<{ (e: 'start', question: string): void }>()
const { quota, refreshQuota } = useReading()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)

onMounted(refreshQuota)

const remainingLabel = computed(() =>
  quota.value.limit === null
    ? '开发模式 · 不限次数'
    : quota.value.used < quota.value.limit
      ? `今日还可用 ${quota.value.limit - quota.value.used} / ${quota.value.limit} 次`
      : '今日次数已用完 · 明天再见',
)

const prompts = ['我需要做出的一个选择', '我正在逃避的事', '我想守护的能量']

function submit() {
  emit('start', q.value.trim() || DEFAULT_QUESTION)
}
function usePrompt(text: string) {
  q.value = text
  input.value?.focus()
}
</script>

<template>
  <section class="intro" id="intro">
    <p class="eyebrow">五分钟的心灵笔记 · {{ remainingLabel }}</p>
    <h1>为一个<br /><em>诚实的问题留出空间。</em></h1>
    <p class="intro-copy">不是预言，而是换个角度，看见此刻正向你索求关注的事。</p>

    <form class="question-form" @submit.prevent="submit">
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
  </section>
</template>