<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { echoSystem } from '@/native/echoSystem';
import { initKugouEngine } from '@/services/kugou/kugouEngine';
import { useSettingsStore } from '@/stores/settings';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import AppShell from '@/layouts/AppShell.vue';
import NowPlayingSheet from '@/components/NowPlayingSheet.vue';
import AccountVipSheet from '@/components/AccountVipSheet.vue';
import LoginModal from '@/components/LoginModal.vue';
import SongActionSheet from '@/components/SongActionSheet.vue';
import UnblockSourceSheet from '@/components/UnblockSourceSheet.vue';
import VerificationModal from '@/components/VerificationModal.vue';

const router = useRouter();
const settings = useSettingsStore();
const accounts = useAccountsStore();
const vip = useVipStore();
const player = usePlayerStore();
const ui = useUiStore();

onMounted(async () => {
  await ui.initSystemInsets();
  await Promise.all([
    settings.hydrate(),
    accounts.hydrate(),
    vip.hydrate(),
    player.hydrate(),
  ]);

  // Initialize local KuGou device identity in background
  void initKugouEngine();

  // Hardware & gesture back button coordination
  await echoSystem.onHardwareBack(() => {
    if (ui.closeTopOverlay()) return;
    const isRootTab = ['/home', '/library', '/search'].includes(router.currentRoute.value.path);
    if (!isRootTab && window.history.length > 1) {
      router.back();
    } else {
      void echoSystem.moveToBackground();
    }
  });

  // Handle tap on daily VIP reminder notification
  await echoSystem.onAutoClaimIntent(() => {
    ui.accountSheetOpen = true;
    void vip.maybeAutoClaimOnLaunch(true);
  });

  const launchFlags = await echoSystem.getLaunchFlags();
  if (launchFlags.autoClaim) {
    ui.accountSheetOpen = true;
    void vip.maybeAutoClaimOnLaunch(true);
  } else {
    // Silent auto-claim 2s after cold launch
    setTimeout(() => {
      void vip.maybeAutoClaimOnLaunch(false);
    }, 2000);
  }
});
</script>

<template>
  <AppShell />
  <NowPlayingSheet />
  <AccountVipSheet />
  <LoginModal />
  <SongActionSheet />
  <UnblockSourceSheet />
  <VerificationModal />

  <!-- Subtle iOS Top Pill Toast -->
  <Transition name="am-fade">
    <div
      v-if="ui.toastMessage"
      class="fixed top-[calc(var(--safe-top)+14px)] left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full am-glass shadow-xl text-[13px] font-semibold text-[var(--text-primary)] whitespace-nowrap max-w-[88vw] truncate pointer-events-none"
    >
      {{ ui.toastMessage }}
    </div>
  </Transition>
</template>
