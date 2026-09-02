<script setup lang="ts">
import { computed, ref } from 'vue'
import { cardTitle } from '../lib/cards'
import { positions } from '../lib/spread'
import type { Card } from '../lib/types'

const props = defineProps<{
  card: Card | null
  index: number
  revealed: boolean
  enabled: boolean
}>()

const emit = defineEmits<{ (e: 'draw', index: number): void }>()

const buttonEl = ref<HTMLElement | null>(null)
// Expose the underlying button so the parent can move focus between slots.
defineExpose({ buttonEl })

const position = computed(() => positions[props.index])
const orientationText = computed(() =>
  props.card?.reversed ? '↕ 逆位 · 能量内收' : '↑ 正位 · 能量可被接住',
)
const a11yLabel = computed(() =>
  props.revealed && props.card ? cardTitle(props.card) : `抽取第 ${props.index + 1} 张牌`,
)
</script>

<template>
  <article class="card-slot">
    <button
      ref="buttonEl"
      class="tarot-card"
      :class="revealed && card ? 'revealed' + (card.reversed ? ' reversed' : '') : 'card-back'"
      :disabled="!enabled"
      :aria-label="a11yLabel"
      @click="emit('draw', index)"
    >
      <template v-if="revealed && card">
        <img :src="card.src" :alt="card.name + (card.reversed ? ' (reversed)' : '')" />
        <span v-if="card.reversed" class="reversed-badge" aria-hidden="true">↕ 逆位</span>
      </template>
      <template v-else>
        <span class="back-star">✦</span>
        <span class="back-word">翻 开</span>
      </template>
    </button>
    <div class="card-caption">
      <span>{{ position.num }}</span>
      <strong>{{ position.title }}</strong>
      <p>{{ position.sub }}</p>
      <template v-if="revealed && card">
        <p class="card-name">{{ cardTitle(card) }}</p>
        <p class="orientation">{{ orientationText }}</p>
      </template>
    </div>
  </article>
</template>