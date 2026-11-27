<script setup lang="ts">
import { useAccountsStore } from '@/stores/accounts';
import { Icon } from '@iconify/vue';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';

const accounts = useAccountsStore();
</script>

<template>
  <Transition name="lg-dialog">
    <div
      v-if="accounts.pendingChallenge"
      class="fixed inset-0 z-[95] flex items-center justify-center px-6 lg-scrim"
    >
      <div class="w-full max-w-sm rounded-[24px] lg-sheet-panel lg-dialog-card p-5 shadow-2xl">
        <div class="w-12 h-12 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text mx-auto mb-3">
          <Icon :icon="iconShieldCheck" class="w-6 h-6" />
        </div>
        <h3 class="text-[18px] font-bold text-center text-[var(--text-primary)]">酷狗安全验证</h3>
        <p class="text-[13px] text-[var(--text-secondary)] text-center mt-1.5 leading-relaxed">
          酷狗风控返回验证事件（{{ accounts.pendingChallenge.eventId }}）。请在酷狗概念版完成一次安全校验后点击「已验证并重试」。
        </p>

        <div class="grid grid-cols-2 gap-2.5 mt-5">
          <button
            type="button"
            class="h-11 rounded-[12px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[15px] font-semibold border-0 am-tap"
            @click="accounts.resolveVerification(false)"
          >
            取消
          </button>
          <button
            type="button"
            class="h-11 rounded-[12px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
            @click="accounts.resolveVerification(true)"
          >
            重试请求
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
