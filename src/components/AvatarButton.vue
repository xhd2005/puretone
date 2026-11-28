<script setup lang="ts">
import { Icon } from '@iconify/vue';
import iconUser from '@iconify/icons-tabler/user';
import { useAccountsStore } from '@/stores/accounts';
import { useUiStore } from '@/stores/ui';

const accounts = useAccountsStore();
const ui = useUiStore();
</script>

<template>
  <button
    type="button"
    class="avatar-btn am-tap"
    aria-label="个人中心与扩展"
    @click="ui.openAccountSheet('profile')"
  >
    <img
      v-if="accounts.activeAccount?.avatar"
      :src="accounts.activeAccount.avatar"
      :alt="accounts.activeAccount.nickname"
      class="w-full h-full object-cover rounded-full"
    />
    <div
      v-else
      class="w-full h-full rounded-full bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text"
    >
      <Icon :icon="iconUser" class="w-5 h-5" />
    </div>
    <!-- Subtle dot only when a newer app release is available -->
    <span v-if="ui.availableUpdateVersion" class="avatar-dot" aria-hidden="true" />
  </button>
</template>

<style scoped>
.avatar-btn {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
  cursor: pointer;
}

.avatar-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background-color: var(--accent);
  border: 2px solid var(--bg-canvas);
}
</style>
