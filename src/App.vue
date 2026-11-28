<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { echoSystem } from '@/native/echoSystem';
import { initKugouEngine } from '@/services/kugou/kugouEngine';
import { hydratePlaylistCoverCache } from '@/services/playback/playlistCoverResolver';
import { checkForAppUpdate, FALLBACK_APP_VERSION, type ReleaseUpdateInfo } from '@/services/update/updateService';
import { useSettingsStore } from '@/stores/settings';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { useUiStore } from '@/stores/ui';
import AppShell from '@/layouts/AppShell.vue';
import SplashOverlay from '@/components/SplashOverlay.vue';
import NowPlayingSheet from '@/components/NowPlayingSheet.vue';
import AudioEffectSheet from '@/components/AudioEffectSheet.vue';
import AccountVipSheet from '@/components/AccountVipSheet.vue';
import LoginModal from '@/components/LoginModal.vue';
import SongActionSheet from '@/components/SongActionSheet.vue';
import AddToPlaylistSheet from '@/components/AddToPlaylistSheet.vue';
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
const complianceReady = ref(false);
const pendingCompliancePrompt = ref(false);
const pendingAutoUpdate = ref<ReleaseUpdateInfo | null>(null);
let autoUpdatePromptTimer: ReturnType<typeof setTimeout> | null = null;
let onlineServicesStarted = false;
let resolvedAppVersion = FALLBACK_APP_VERSION;
let pendingOpenNowPlayingOnConsent = false;

function flushPendingAutoUpdateIfReady() {
  if (!splashDone.value || !complianceReady.value || ui.complianceModalOpen || !pendingAutoUpdate.value) return;
  if (autoUpdatePromptTimer) clearTimeout(autoUpdatePromptTimer);
  autoUpdatePromptTimer = setTimeout(() => {
    autoUpdatePromptTimer = null;
    if (!splashDone.value || !complianceReady.value || ui.complianceModalOpen || !pendingAutoUpdate.value || ui.updateReleaseInfo) {
      return;
    }
    const next = pendingAutoUpdate.value;
    pendingAutoUpdate.value = null;
    ui.updateReleaseInfo = next;
  }, 260);
}

/**
 * Strictly gated behind explicit user acceptance of ComplianceDisclaimerModal:
 * ZERO external network requests fire before the user agrees!
 */
function startOnlineServicesOnce() {
  if (onlineServicesStarted) return;
  onlineServicesStarted = true;
  complianceReady.value = true;

  void initKugouEngine();
  if (accounts.activeAccount) {
    void accounts.refreshAccountProfile(accounts.activeAccount.userid);
  }
  if (pendingOpenNowPlayingOnConsent && player.currentSong) {
    pendingOpenNowPlayingOnConsent = false;
    ui.openNowPlaying('cover');
  }

  setTimeout(() => {
    void vip.maybeAutoClaimOnLaunch(false);
  }, 2000);

  // Automatic cold-start update check (queues gracefully behind Splash & Compliance modal)
  setTimeout(async () => {
    if (!settings.autoCheckUpdate) return;
    try {
      const update = await checkForAppUpdate({
        silent: true,
        currentVersion: resolvedAppVersion,
        mirrorMode: settings.updateMirrorMode,
        customMirror: settings.customUpdateMirror,
      });
      if (update?.hasUpdate) {
        ui.availableUpdateVersion = update.latestVersion;
        pendingAutoUpdate.value = update;
      }
    } catch {
      // silent network error
    }
  }, 800);
}

watch([splashDone, complianceReady, () => ui.complianceModalOpen, pendingAutoUpdate], () => {
  flushPendingAutoUpdateIfReady();
});

watch(
  () => [ui.complianceAccepted, ui.complianceModalOpen],
  ([accepted, open]) => {
    if (accepted && !open && !onlineServicesStarted) {
      startOnlineServicesOnce();
    }
  },
);

onUnmounted(() => {
  if (autoUpdatePromptTimer) {
    clearTimeout(autoUpdatePromptTimer);
    autoUpdatePromptTimer = null;
  }
});

function onSplashDone() {
  splashDone.value = true;
  if (pendingCompliancePrompt.value) {
    pendingCompliancePrompt.value = false;
    ui.complianceModalOpen = true;
  }
  flushPendingAutoUpdateIfReady();
}

onMounted(async () => {
  await ui.initSystemInsets();
  // Pure local-sandbox hydration first (zero external network calls)
  await Promise.all([
    settings.hydrate(),
    accounts.hydrate({ deferNetworkRefresh: true }),
    vip.hydrate(),
    player.hydrate(),
    stats.hydrate(),
    hydratePlaylistCoverCache(),
  ]);

  const launchFlags = await echoSystem.getLaunchFlags();
  resolvedAppVersion = launchFlags.versionName || FALLBACK_APP_VERSION;
  pendingOpenNowPlayingOnConsent = Boolean(launchFlags.openNowPlaying);

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
    if (complianceReady.value && player.currentSong) {
      ui.openNowPlaying('cover');
    }
  });

  // Mandatory compliance disclaimer gate on first launch AND after EVERY version update
  const compliance = await echoSystem.kvGetJson<ComplianceAcceptanceRecord | null>(COMPLIANCE_ACCEPTED_KEY, null);
  if (shouldShowComplianceDisclaimer(compliance, resolvedAppVersion)) {
    ui.complianceAccepted = false;
    complianceReady.value = false;
    if (splashDone.value) {
      ui.complianceModalOpen = true;
    } else {
      pendingCompliancePrompt.value = true;
    }
  } else {
    ui.complianceAccepted = true;
    startOnlineServicesOnce();
  }
});
</script>

<template>
  <AppShell v-if="complianceReady" />
  <NowPlayingSheet />
  <AudioEffectSheet />
  <AccountVipSheet />
  <LoginModal />
  <SongActionSheet />
  <AddToPlaylistSheet />
  <SongCommentsSheet />
  <ArtistPickerSheet />
  <UnblockSourceSheet />
  <LyricPosterModal />
  <VerificationModal />
  <UpdateModal />
  <ComplianceDisclaimerModal />
  <SplashOverlay @done="onSplashDone" />

  <!-- iOS 26 Liquid Glass Top Pill Toast -->
  <Transition name="am-toast">
    <div
      v-if="ui.toastMessage"
      class="fixed top-[calc(var(--safe-top)+14px)] left-1/2 -translate-x-1/2 z-[115] px-4 py-2 rounded-full lg-capsule text-[13px] font-semibold text-[var(--text-primary)] whitespace-nowrap max-w-[88vw] truncate pointer-events-none"
    >
      {{ ui.toastMessage }}
    </div>
  </Transition>
</template>
