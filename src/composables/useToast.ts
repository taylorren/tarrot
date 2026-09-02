import { ref } from 'vue'

// Module-level so the footer can trigger it and App can render it.
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

export function useToast() {
  function show(ms = 1800) {
    visible.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (visible.value = false), ms)
  }
  return { visible, show }
}