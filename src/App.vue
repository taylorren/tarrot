<script setup lang="ts">
import { useReading } from './store/reading'
import { useToast } from './composables/useToast'
import SiteIntro from './components/SiteIntro.vue'
import ReadingView from './components/ReadingView.vue'
import Toast from './components/Toast.vue'

const { phase, start, reset } = useReading()
const { visible } = useToast()
</script>

<template>
  <main class="app-shell">
    <header class="site-header">
      <a class="wordmark" href="/" aria-label="小小问题首页">一 个 <i>小 小</i> 问 题</a>
      <p class="edition">每日练习 · 78 张牌</p>
    </header>

    <SiteIntro v-if="phase === 'intro'" @start="start" />
    <ReadingView v-else @start-over="reset" />
  </main>
  <div class="moon" aria-hidden="true"></div>
  <Toast :visible="visible" />
</template>