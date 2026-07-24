<script setup>
defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: "确认操作" },
  message: { type: String, default: "" },
  confirmText: { type: String, default: "确认" },
  cancelText: { type: String, default: "取消" },
  danger: { type: Boolean, default: false },
});

const emit = defineEmits(["confirm", "cancel"]);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="confirm-overlay" @click.self="emit('cancel')">
      <div class="confirm-card">
        <div class="confirm-icon" :class="{ danger }">
          <svg v-if="danger" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="confirm-body">
          <p class="confirm-title">{{ title }}</p>
          <p class="confirm-message">{{ message }}</p>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel" @click="emit('cancel')">{{ cancelText }}</button>
          <button class="confirm-btn" :class="danger ? 'confirm-btn-danger' : 'confirm-btn-primary'" @click="emit('confirm')">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: fadeIn 0.15s ease;
}

.confirm-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 28px 32px 24px;
  width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: var(--shadow-modal);
  animation: scaleIn 0.18s ease;
}

@keyframes scaleIn {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.confirm-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--rust);
  background: rgba(93, 42, 26, 0.08);
}
.confirm-icon.danger {
  color: var(--red);
  background: rgba(231, 76, 60, 0.08);
}

.confirm-body {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.confirm-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.confirm-message {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 4px;
}

.confirm-btn {
  flex: 1;
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.confirm-btn-cancel {
  background: var(--fog);
  color: var(--text-secondary);
}
.confirm-btn-cancel:hover {
  background: var(--border);
  color: var(--text-primary);
}

.confirm-btn-primary {
  background: var(--rust);
  color: #fff;
}
.confirm-btn-primary:hover {
  background: #4a2215;
}

.confirm-btn-danger {
  background: var(--red);
  color: #fff;
}
.confirm-btn-danger:hover {
  background: #c0392b;
}
</style>
