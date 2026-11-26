<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { echoSystem } from '@/native/echoSystem';
import { initKugouEngine } from '@/services/kugou/kugouEngine';
import { hydratePlaylistCoverCache } from '@/services/playback/playlistCoverResolver';
import { checkForAppUpdate } from '@/services/update/updateService';
import { useSettingsStore } from '@/stores/settings';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { useUiStore } from '@/stores/ui';
import AppShell from '@/layouts/AppShell.vue';
import NowPlayingSheet from '@/components/NowPlayingSheet.vue';
import AccountVipSheet from '@/components/AccountVipSheet.vue';
import LoginModal from '@/components/LoginModal.vue';
import SongActionSheet from '@/components/SongActionSheet.vue';
import UnblockSourceSheet from '@/components/UnblockSourceSheet.vue';
import VerificationModal from '@/components/VerificationModal.vue';
import UpdateModal from '@/components/UpdateModal.vue';

const router = useRouter();
const settings = useSettingsStore();
const accounts = useAccountsStore();
const vip = useVipStore();
const player = usePlayerStore();
const stats = useStatsStore();
const ui = useUiStore();

onMounted(async () => {
  await ui.initSystemInsets();
  await Promise.all([
    settings.hydrate(),
    accounts.hydrate(),
    vip.hydrate(),
    player.hydrate(),
    stats.hydrate(),
    hydratePlaylistCoverCache(),
  ]);

  void initKugouEngine();

  await echoSystem.onHardwareBack(() => {
    if (ui.closeTopOverlay()) return;
    const isRootTab = ['/home', '/library', '/search'].includes(router.currentRoute.value.path);
    if (!isRootTab && window.history.length > 1) {
      router.back();
    } else {
      void echoSystem.moveToBackground();
    }
  });

  await echoSystem.onAutoClaimIntent(() => {
    ui.accountSheetOpen = true;
    void vip.maybeAutoClaimOnLaunch(true);
  });

  await echoSystem.onOpenNowPlayingIntent(() => {
    if (player.currentSong) {
      ui.openNowPlaying('cover');
    }
  });

  const launchFlags = await echoSystem.getLaunchFlags();
  if (launchFlags.openNowPlaying && player.currentSong) {
    ui.openNowPlaying('cover');
  }
  if (launchFlags.autoClaim) {
    ui.accountSheetOpen = true;
    void vip.maybeAutoClaimOnLaunch(true);
  } else {
    setTimeout(() => {
      void vip.maybeAutoClaimOnLaunch(false);
    }, 2000);
  }

  // Silent daily update check (non-intrusive; only pops modal if a newer GitHub Release exists)
  setTimeout(async () => {
    try {
      const update = await checkForAppUpdate({ silent: true, currentVersion: launchFlags.versionName });
      if (update?.hasUpdate) {
        ui.updateReleaseInfo = update;
      }
    } catch {
      // silent network error
    }
  }, 4500);
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
  <UpdateModal />

  <!-- iOS 26 Liquid Glass Top Pill Toast -->
  <Transition name="am-fade">
    <div
      v-if="ui.toastMessage"
      class="fixed top-[calc(var(--safe-top)+14px)] left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full lg-capsule text-[13px] font-semibold text-[var(--text-primary)] whitespace-nowrap max-w-[88vw] truncate pointer-events-none"
    >
      {{ ui.toastMessage }}
    </div>
  </Transition>
</template>
