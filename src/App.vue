<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { echoSystem } from '@/native/echoSystem';
import { initKugouEngine } from '@/services/kugou/kugouEngine';
import { hydratePlaylistCoverCache } from '@/services/playback/playlistCoverResolver';
import { checkForAppUpdate, FALLBACK_APP_VERSION } from '@/services/update/updateService';
import { useSettingsStore } from '@/stores/settings';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { useUiStore } from '@/stores/ui';
import AppShell from '@/layouts/AppShell.vue';
import SplashOverlay from '@/components/SplashOverlay.vue';
import NowPlayingSheet from '@/components/NowPlayingSheet.vue';
import AccountVipSheet from '@/components/AccountVipSheet.vue';
import LoginModal from '@/components/LoginModal.vue';
import SongActionSheet from '@/components/SongActionSheet.vue';
import SongCommentsSheet from '@/components/SongCommentsSheet.vue';
import ArtistPickerSheet from '@/components/ArtistPickerSheet.vue';
import UnblockSourceSheet from '@/components/UnblockSourceSheet.vue';
import VerificationModal from '@/components/VerificationModal.vue';
import UpdateModal from '@/components/UpdateModal.vue';
import LyricPosterModal from '@/components/LyricPosterModal.vue';
import ComplianceDisclaimerModal, {
  COMPLIANCE_ACCEPTED_KEY,
  shouldShowComplianceDisclaimer,
  type ComplianceAcceptanceRecord,
} from '@/components/ComplianceDisclaimerModal.vue';

const router = useRouter();
const settings = useSettingsStore();
const accounts = useAccountsStore();
const vip = useVipStore();
const player = usePlayerStore();
const stats = useStatsStore();
const ui = useUiStore();

const splashDone = ref(false);
const pendingCompliancePrompt = ref(false);

function onSplashDone() {
  splashDone.value = true;
  if (pendingCompliancePrompt.value) {
    pendingCompliancePrompt.value = false;
    ui.complianceModalOpen = true;
  }
}

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

  const launchFlags = await echoSystem.getLaunchFlags();
  const currentVersion = launchFlags.versionName || FALLBACK_APP_VERSION;

  // Mandatory compliance disclaimer on first launch AND after EVERY version update
  const compliance = await echoSystem.kvGetJson<ComplianceAcceptanceRecord | null>(COMPLIANCE_ACCEPTED_KEY, null);
  if (shouldShowComplianceDisclaimer(compliance, currentVersion)) {
    if (splashDone.value) {
      ui.complianceModalOpen = true;
    } else {
      pendingCompliancePrompt.value = true;
    }
  }

  await echoSystem.onHardwareBack(() => {
    if (ui.closeTopOverlay()) return;
    const isRootTab = ['/home', '/library', '/search'].includes(router.currentRoute.value.path);
    if (!isRootTab && window.history.length > 1) {
      router.back();
    } else {
      void echoSystem.moveToBackground();
    }
  });

  await echoSystem.onOpenNowPlayingIntent(() => {
    if (player.currentSong) {
      ui.openNowPlaying('cover');
    }
  });

  if (launchFlags.openNowPlaying && player.currentSong) {
    ui.openNowPlaying('cover');
  }
  setTimeout(() => {
    void vip.maybeAutoClaimOnLaunch(false);
  }, 2000);

  // Silent daily update check (non-intrusive; China-friendly multi-mirror auto-fallback)
  setTimeout(async () => {
    try {
      const update = await checkForAppUpdate({
        silent: true,
        currentVersion,
        mirrorMode: settings.updateMirrorMode,
        customMirror: settings.customUpdateMirror,
      });
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
  <SongCommentsSheet />
  <ArtistPickerSheet />
  <UnblockSourceSheet />
  <LyricPosterModal />
  <VerificationModal />
  <UpdateModal />
  <ComplianceDisclaimerModal />
  <SplashOverlay @done="onSplashDone" />

  <!-- iOS 26 Liquid Glass Top Pill Toast -->
  <Transition name="am-fade">
    <div
      v-if="ui.toastMessage"
      class="fixed top-[calc(var(--safe-top)+14px)] left-1/2 -translate-x-1/2 z-[115] px-4 py-2 rounded-full lg-capsule text-[13px] font-semibold text-[var(--text-primary)] whitespace-nowrap max-w-[88vw] truncate pointer-events-none"
    >
      {{ ui.toastMessage }}
    </div>
  </Transition>
</template>
