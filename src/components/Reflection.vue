<script setup lang="ts">
import { computed } from 'vue'
import { useReading } from '../store/reading'
import { cardTitle } from '../lib/cards'
import { noteFor } from '../lib/guidance'

const { chosen } = useReading()
const focus = computed(() => chosen.value[2])
const title = computed(() =>
  focus.value ? `${cardTitle(focus.value)} · ${focus.value.reversed ? '逆位' : '正位'}的提醒：` : '留给之后的一句话',
)
</script>

<template>
  <aside class="reflection" id="reflection" aria-live="polite" aria-atomic="true">
    <div>
      <p class="eyebrow">留住这条线索</p>
      <h3 id="reflection-title">{{ title }}</h3>
    </div>
    <p id="reflection-copy">{{ focus ? noteFor(focus, 2) : '' }}</p>
  </aside>
</template>