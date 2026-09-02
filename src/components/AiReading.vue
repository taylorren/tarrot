<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useReading } from '../store/reading'

const { aiStage, aiReading, aiThread, retryAi } = useReading()

const thoughts = [
  '让三张牌之间的线索慢慢浮现……',
  '正在把散落的图像连成一条线……',
  '几乎就要看清了……',
]
const thinkingText = ref(thoughts[0])
let timer: ReturnType<typeof setInterval> | undefined

watch(
  aiStage,
  (stage) => {
    clearInterval(timer)
    if (stage === 'loading') {
      thinkingText.value = thoughts[0]
      let ti = 0
      timer = setInterval(() => {
        ti = (ti + 1) % thoughts.length
        thinkingText.value = thoughts[ti]
      }, 2200)
    }
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(timer))

const stateIcon = computed(() => ({
  idle: '',
  loading: '…',
  done: '✓',
  error: '—',
  quota: '·',
})[aiStage.value] ?? '')
</script>

<template>
  <section class="ai-reading" id="ai-reading" aria-live="polite">
    <div class="ai-heading">
      <span class="ai-crystal">✦</span>
      <div>
        <p class="eyebrow">一起看看这三张牌</p>
        <h3>关于你问题的一点解读</h3>
      </div>
      <span class="ai-state">{{ stateIcon }}</span>
    </div>

    <div class="ai-body">
      <p v-if="aiStage === 'loading'" class="ai-thinking">{{ thinkingText }}</p>
      <p v-if="aiStage === 'done'" class="ai-reading-copy">{{ aiReading }}</p>
      <p v-if="aiStage === 'done' && aiThread" class="ai-thread">
        <strong>今天就做的一小步：</strong><span>{{ aiThread }}</span>
      </p>
      <p v-if="aiStage === 'quota'" class="ai-quota">
        这次解读刚刚落下。上面的牌与那句提醒仍在——
        四小时后，再带着新的问题回来。
      </p>
    </div>

    <p v-if="aiStage === 'error'" class="ai-error">
      仍是手工的一句提醒在上方，稍后可按“再试一次”重新连线。
      <br />
      <button class="retry" type="button" @click="retryAi">再试一次</button>
    </p>
  </section>
</template>