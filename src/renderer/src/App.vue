<script setup lang="ts">
// Phase 0 scaffold. The screen canvas arrives in Phase 3, the control bar and
// settings panel in Phase 7.
</script>

<template>
  <div class="app">
    <span class="cursor" />
  </div>
</template>

<style scoped>
.app {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vt-screen);
}

/* Stand-in for the screen: a blinking phosphor cursor block, at 8×8 scaled. */
.cursor {
  width: 24px;
  height: 24px;
  background: var(--vt-phosphor);
  animation: blink 1s steps(1, end) infinite;
}

@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  50.01%,
  100% {
    opacity: 0;
  }
}
</style>
