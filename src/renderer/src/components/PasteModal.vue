<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { usePaste } from '@/composables/usePaste'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Paste — the EMULATOR's modal, with the machine's keyboard swapped for the
 * wire.
 *
 * There is no browser paste event to intercept here: the terminal's own
 * `keydown` handler owns ⌘V, and forwarding it as bytes would send `v`. A
 * textarea the system paste lands in, and an explicit Send, is the honest way
 * round that — and it also lets you see what is about to go up the line, which
 * on a serial link is worth a moment.
 */

const emit = defineEmits<{ close: [] }>()

const store = useTerminalStore()
const { injectText, cancel } = usePaste()

const text = ref('')
const sending = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

onMounted(async () => {
  await nextTick()
  textarea.value?.focus()
})

async function onSend(): Promise<void> {
  if (!text.value || sending.value) return
  sending.value = true
  try {
    await injectText(text.value)
  } finally {
    sending.value = false
    emit('close')
  }
}

function onCancel(): void {
  if (sending.value) {
    // Mid-send: stop it, and let `onSend`'s `finally` close the modal.
    cancel()
    return
  }
  emit('close')
}
</script>

<template>
  <div class="paste-backdrop" @click="onCancel" />

  <div class="paste-modal" @keydown.esc="onCancel">
    <div class="paste-header">
      <span class="paste-title">Paste Text</span>
      <button class="close-btn" title="Close" @click="onCancel">✕</button>
    </div>

    <div class="paste-body">
      <textarea
        ref="textarea"
        v-model="text"
        class="paste-input"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        placeholder="Paste or type text to send up the serial line…"
      />
      <p class="paste-hint">
        Sent as keystrokes, character by character: newlines send Return, and
        anything the keyboard could not have typed is dropped.
      </p>
      <p v-if="!store.serialConnected" class="paste-hint warn">
        Nothing is connected — there is nowhere for this to go.
      </p>
    </div>

    <div class="paste-footer">
      <span v-if="sending" class="paste-status">Sending…</span>
      <button class="btn-sm btn-secondary" @click="onCancel">
        {{ sending ? 'Stop' : 'Cancel' }}
      </button>
      <button
        class="btn-sm btn-primary"
        :disabled="sending || !text || !store.serialConnected"
        @click="onSend"
      >
        Send
      </button>
    </div>
  </div>
</template>

<style scoped>
.paste-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 199;
}

.paste-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, 90vw);
  background: var(--vt-panel);
  border: 1px solid var(--vt-panel-line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 200;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}

.paste-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vt-panel-line);
}

.paste-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--vt-phosphor);
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 14px;
  color: var(--vt-text-dim);
  transition:
    color 0.15s,
    background 0.15s;
}
.close-btn:hover {
  color: var(--vt-phosphor);
  background: rgba(255, 255, 255, 0.06);
}

.paste-body {
  padding: 14px 16px;
}

.paste-input {
  width: 100%;
  height: 200px;
  resize: vertical;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--vt-panel-line);
  border-radius: 4px;
  color: var(--vt-text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  outline: none;
}
.paste-input:focus {
  border-color: var(--vt-phosphor-dim);
}

.paste-hint {
  margin: 8px 2px 0;
  font-size: 11px;
  color: var(--vt-text-dim);
  line-height: 1.4;
}
.paste-hint.warn {
  color: var(--vt-amber);
}

.paste-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vt-panel-line);
}

.paste-status {
  margin-right: auto;
  font-size: 12px;
  color: var(--vt-text-dim);
}

.btn-sm {
  padding: 5px 14px;
  border-radius: 4px;
  font-size: 12px;
  height: 28px;
  white-space: nowrap;
}

.btn-primary {
  background: var(--vt-phosphor);
  color: var(--vt-screen);
  font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
  background: var(--vt-phosphor-hi);
}
.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  color: var(--vt-text);
  border: 1px solid var(--vt-panel-line);
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
</style>
