<script setup lang="ts">
defineProps<{ visible: boolean }>()
</script>

<template>
  <div class="toast" :class="{ show: visible }" role="status" aria-live="polite">Copied to clipboard</div>
</template>