<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconCheck from '@iconify/icons-tabler/check';
import iconPlus from '@iconify/icons-tabler/plus';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconTrash from '@iconify/icons-tabler/trash';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconCrown from '@iconify/icons-tabler/crown';
import iconDeviceMobile from '@iconify/icons-tabler/device-mobile';
import iconDatabase from '@iconify/icons-tabler/database';
import iconBrandGithub from '@iconify/icons-tabler/brand-github';
import iconDownload from '@iconify/icons-tabler/download';
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import iconPalette from '@iconify/icons-tabler/palette';
import iconChevronDown from '@iconify/icons-tabler/chevron-down';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconFileExport from '@iconify/icons-tabler/file-export';
import iconFileImport from '@iconify/icons-tabler/file-import';
import iconLanguage from '@iconify/icons-tabler/language';
import iconMessageQuote from '@iconify/icons-tabler/blockquote';
import iconWaveSine from '@iconify/icons-tabler/wave-sine';
import iconVolume from '@iconify/icons-tabler/volume';
import iconInfoCircle from '@iconify/icons-tabler/info-circle';
import iconFolder from '@iconify/icons-tabler/folder';
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import { useAccountsStore } from '@/stores/accounts';
import {
  useSettingsStore,
  type AccentThemeMode,
  type AppearanceMode,
  type AppLocale,
  type AudioCacheLimitMb,
  type LyricFontSize,
  type TrackTransitionFadeMs,
  type UpdateMirrorMode,
} from '@/stores/settings';
import { useStatsStore } from '@/stores/stats';
import { usePluginsStore } from '@/stores/plugins';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import { echoPlayer } from '@/native/echoPlayer';
import { resolvePluginVisual } from '@/services/plugins/pluginUiMeta';
import { exportLocalBackupJson, restoreLocalBackupJson } from '@/services/backup/backupService';
import {
  APP_AUTHOR,
  APP_REPO_URL,
  checkForAppUpdate,
  FALLBACK_APP_VERSION,
  getCurrentAppVersion,
} from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';
import ListeningStatsChart from './ListeningStatsChart.vue';
import PluginHubTab from './PluginHubTab.vue';

type ProfileSectionTab = 'profile' | 'plugins' | 'settings';

const accounts = useAccountsStore();
const settings = useSettingsStore();
const stats = useStatsStore();
const plugins = usePluginsStore();
const ui = useUiStore();
const { t } = useI18n();

const profileScrollRef = ref<HTMLElement | null>(null);
const pluginsScrollRef = ref<HTMLElement | null>(null);
const settingsScrollRef = ref<HTMLElement | null>(null);
const activeTab = ref<ProfileSectionTab>('profile');
const activeScrollRef = computed(() => {
  if (activeTab.value === 'plugins') return pluginsScrollRef.value;
  if (activeTab.value === 'settings') return settingsScrollRef.value;
  return profileScrollRef.value;
});
const showAccountSwitcher = ref(false);
const showBackupPanel = ref(false);
const importJsonText = ref('');
const importingBackup = ref(false);
const notifGranted = ref(true);
const showOemIslandHint = ref(false);
const cacheUsedBytes = ref(0);
const cacheMaxBytes = ref(2048 * 1024 * 1024);
const clearingCache = ref(false);
const snapshotUsedBytes = ref(0);
const snapshotPlaylistCount = ref(0);
const clearingSnapshots = ref(false);
const checkingUpdate = ref(false);
const appVersion = ref(FALLBACK_APP_VERSION);

function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

const cacheUsedLabel = computed(() => formatStorageSize(cacheUsedBytes.value));
const cacheLimitLabel = computed(() => {
  const mb = settings.audioCacheMaxMb;
  if (mb <= 0) return t('settings.cacheUnlimited');
  return mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`;
});
const cacheUsagePercent = computed(() => {
  if (settings.audioCacheMaxMb <= 0 || cacheMaxBytes.value <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((cacheUsedBytes.value / cacheMaxBytes.value) * 100)));
});
const snapshotUsedLabel = computed(() => formatStorageSize(snapshotUsedBytes.value));

const audioCacheOptions = computed<Array<{ mb: AudioCacheLimitMb; label: string }>>(() => [
  { mb: 500, label: '500M' },
  { mb: 1024, label: '1G' },
  { mb: 2048, label: '2G' },
  { mb: 4096, label: '4G' },
  { mb: 0, label: t('settings.cacheUnlimitedShort') },
]);

const dragSheet = useDraggableSheet({
  detents: [0.60, 0.92],
  initialDetentIndex: 1,
  scrollElRef: activeScrollRef,
  onDismiss: () => {
    ui.accountSheetOpen = false;
  },
});

const sectionTabs = computed<Array<{ id: ProfileSectionTab; label: string }>>(() => [
  { id: 'profile', label: t('profile.tab.profile') },
  { id: 'plugins', label: t('profile.tab.plugins') },
  { id: 'settings', label: t('profile.tab.settings') },
]);

const activeTabIndex = computed(() => {
  const idx = sectionTabs.value.findIndex((item) => item.id === activeTab.value);
  return idx >= 0 ? idx : 0;
});

function switchTab(next: ProfileSectionTab) {
  if (activeTab.value === next) return;
  echoSystem.haptic('selection');
  activeTab.value = next;
  ui.accountSheetTab = next;
}

async function refreshDeviceStats() {
  const [perm, cache, snapStats, ver] = await Promise.all([
    echoSystem.checkNotificationPermission(),
    echoPlayer.getAudioCacheStats(),
    echoSystem.getSnapshotCacheStats(),
    getCurrentAppVersion(),
  ]);
  notifGranted.value = perm.granted;
  cacheUsedBytes.value = cache.usedBytes;
  cacheMaxBytes.value = cache.maxBytes;
  snapshotUsedBytes.value = snapStats.usedBytes;
  snapshotPlaylistCount.value = snapStats.playlistCount;
  appVersion.value = ver;
}

watch(
  () => ui.accountSheetTab,
  (nextTab) => {
    if (nextTab && activeTab.value !== nextTab) {
      activeTab.value = nextTab;
    }
  },
);

watch(
  () => ui.accountSheetOpen,
  (open) => {
    if (open) {
      activeTab.value = ui.accountSheetTab || 'profile';
      dragSheet.reset();
      showBackupPanel.value = false;
      echoSystem.haptic('light');
      void refreshDeviceStats();
      if (accounts.activeAccount) {
        void accounts.refreshAccountProfile(accounts.activeAccount.userid);
      }
    }
  },
);

const eqOptions = computed<Array<{ id: EqPresetId; label: string }>>(() => [
  { id: 'flat', label: t('settings.eq.flat') },
  { id: 'vocal', label: t('settings.eq.vocal') },
  { id: 'bass', label: t('settings.eq.bass') },
  { id: 'night', label: t('settings.eq.night') },
  { id: 'live', label: t('settings.eq.live') },
]);

const langOptions = computed<Array<{ id: AppLocale; label: string }>>(() => [
  { id: 'system', label: t('settings.lang.system') },
  { id: 'zh-CN', label: t('settings.lang.zhCN') },
  { id: 'zh-TW', label: t('settings.lang.zhTW') },
  { id: 'en', label: t('settings.lang.en') },
]);

const lyricSizeOptions = computed<Array<{ id: LyricFontSize; label: string }>>(() => [
  { id: 'standard', label: t('settings.lyricSize.standard') },
  { id: 'large', label: t('settings.lyricSize.large') },
  { id: 'xlarge', label: t('settings.lyricSize.xlarge') },
]);

const transitionOptions = computed<Array<{ id: TrackTransitionFadeMs; label: string }>>(() => [
  { id: 0, label: t('settings.transitionOff') },
  { id: 1500, label: t('settings.transition15') },
  { id: 3000, label: t('settings.transition30') },
  { id: 5000, label: t('settings.transition50') },
]);

const activeAcc = computed(() => accounts.activeAccount);

const genderLabel = computed(() => {
  const g = activeAcc.value?.gender;
  if (g === 1) return t('profile.genderMale');
  if (g === 0 || g === 2) return t('profile.genderFemale');
  return t('profile.genderSecret');
});

const regionLabel = computed(() => {
  const p = activeAcc.value?.province?.trim() || '';
  const c = activeAcc.value?.city?.trim() || '';
  if (p && c && p !== c) return `${p.replace(/[省市自治区]+$/, '')} · ${c.replace(/市$/, '')}`;
  return (p || c || '--').replace(/[省市自治区]+$/, '');
});

const shortRegionTag = computed(() => {
  const p = activeAcc.value?.province?.trim() || '';
  return p.replace(/[省市自治区特别行政区]+$/g, '');
});

const musicAgeLabel = computed(() => {
  const rt = activeAcc.value?.registerTime;
  if (!rt || rt <= 0) return '--';
  const start = new Date(rt > 1e11 ? rt : rt * 1000);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += 30;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return '--';
  if (years > 0) return t('profile.ageYM', { y: years, m: months });
  return t('profile.ageMD', { m: months, d: days });
});

const kugouListenDurationLabel = computed(() => {
  const mins = activeAcc.value?.listenDurationMin;
  if (!mins || mins <= 0) return '--';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMin = Math.floor(mins % 60);
  if (days > 0) return t('profile.durDH', { d: days, h: hours });
  if (hours > 0) return t('profile.durHM', { h: hours, m: remMin });
  return t('profile.durM', { m: remMin });
});

const mirrorOptions = computed<Array<{ id: UpdateMirrorMode; label: string }>>(() => [
  { id: 'auto', label: t('update.channelAuto') },
  { id: 'direct', label: t('update.channelDirect') },
]);

const showUpdateRoutePanel = ref(false);
const showPhilosophy = ref(false);

async function handleMediaControlAction() {
  echoSystem.haptic('light');
  if (!notifGranted.value) {
    const ok = await echoSystem.requestNotificationPermission();
    notifGranted.value = ok;
    if (ok) {
      ui.showToast(t('settings.mediaControl'));
      return;
    }
  }
  await echoSystem.openAppNotificationSettings();
}

async function handleOpenAppBatterySettings() {
  echoSystem.haptic('light');
  await echoSystem.openAppDetailsSettings();
}

async function handleSelectCacheLimit(mb: AudioCacheLimitMb) {
  echoSystem.haptic('selection');
  settings.audioCacheMaxMb = mb;
  const statsRes = await echoPlayer.setAudioCacheMaxMb(mb);
  cacheUsedBytes.value = statsRes.usedBytes;
  cacheMaxBytes.value = statsRes.maxBytes;
}

async function handleClearAudioCache() {
  if (clearingCache.value) return;
  echoSystem.haptic('medium');
  clearingCache.value = true;
  try {
    await echoPlayer.clearAudioCache();
    await refreshDeviceStats();
    ui.showToast(t('settings.audioCacheCleared'));
  } finally {
    clearingCache.value = false;
  }
}

async function handleClearSnapshotCache() {
  if (clearingSnapshots.value) return;
  echoSystem.haptic('medium');
  clearingSnapshots.value = true;
  try {
    await echoSystem.clearSnapshotCache();
    await refreshDeviceStats();
    ui.showToast(t('settings.snapshotCleared'));
  } finally {
    clearingSnapshots.value = false;
  }
}

async function handleExportBackup() {
  echoSystem.haptic('light');
  try {
    const json = await exportLocalBackupJson(stats.exportSnapshot(), settings.exportSnapshot());
    await echoSystem.copyToClipboard(json);
    ui.showToast(t('settings.backupCopied'));
  } catch {
    ui.showToast('Backup failed');
  }
}

async function handleRestoreBackup() {
  if (importingBackup.value) return;
  importingBackup.value = true;
  echoSystem.haptic('medium');
  try {
    const summary = await restoreLocalBackupJson(importJsonText.value, {
      applyStats: (s) => stats.importSnapshot(s),
      applySettings: (s) => settings.importSnapshot(s),
    });
    importJsonText.value = '';
    showBackupPanel.value = false;
    ui.showToast(`Restored ${summary.totalPlays} plays & ${summary.pinnedCount} pinned sources`);
  } catch (e: any) {
    ui.showToast(e?.message || 'Restore failed', 3000);
  } finally {
    importingBackup.value = false;
  }
}

async function handleCheckUpdate() {
  if (checkingUpdate.value) return;
  echoSystem.haptic('light');
  checkingUpdate.value = true;
  try {
    const res = await checkForAppUpdate({
      silent: false,
      currentVersion: appVersion.value,
      mirrorMode: settings.updateMirrorMode,
      customMirror: settings.customUpdateMirror,
    });
    if (res && res.hasUpdate) {
      ui.availableUpdateVersion = res.latestVersion;
      ui.updateReleaseInfo = res;
    } else {
      ui.availableUpdateVersion = '';
      const via = res?.checkedVia ? ` (${res.checkedVia})` : '';
      ui.showToast(`${t('settings.upToDate', { ver: appVersion.value })}${via}`);
    }
  } catch (e: any) {
    ui.showToast(e?.message || 'Update check failed', 3200);
  } finally {
    checkingUpdate.value = false;
  }
}

async function openGithubRepo() {
  echoSystem.haptic('light');
  await echoSystem.openExternalUrl(APP_REPO_URL);
}

async function openAuthorProfile() {
  echoSystem.haptic('light');
  await echoSystem.openExternalUrl(`https://github.com/${APP_AUTHOR}`);
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.accountSheetOpen"
      class="fixed inset-0 z-[75] flex flex-col justify-end lg-scrim"
      @click="ui.accountSheetOpen = false"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- 120fps GPU-Draggable Handle, Header & iOS 3-Segment Tabs -->
          <div
            class="shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="pt-2.5 pb-1 flex justify-center">
              <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55" />
            </div>

            <div class="flex items-center justify-between px-5 pt-0.5 pb-2.5">
              <span class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">{{ t('profile.header') }}</span>
              <button
                type="button"
                class="text-[16px] font-semibold am-accent-text bg-transparent border-0 px-1 py-1 am-tap"
                @click="ui.accountSheetOpen = false"
              >
                {{ t('common.done') }}
              </button>
            </div>

            <!-- iOS 26 Segmented Navigation Control with Sliding Pill Thumb -->
            <div class="px-4 pb-3 am-hairline-b" @touchstart.stop>
              <div class="pt-seg-group grid-cols-3 !p-1 !rounded-[15px]">
                <div
                  class="pt-seg-thumb !top-1 !bottom-1 !left-1 !rounded-[11px]"
                  :style="{
                    width: 'calc((100% - 8px) / 3)',
                    transform: `translate3d(${activeTabIndex * 100}%, 0, 0)`,
                  }"
                />
                <button
                  v-for="tab in sectionTabs"
                  :key="tab.id"
                  type="button"
                  class="relative z-[1] h-8 rounded-[11px] text-[13px] font-semibold border-0 bg-transparent transition-colors duration-200"
                  :class="
                    activeTab === tab.id
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  "
                  @click="switchTab(tab.id)"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Persistent 3-Pane GPU Stage: ZERO unmount, ZERO blank gap, independent scroll -->
          <div class="pt-pane-stage">
              <!-- ==================== TAB 1: 档案统计 ==================== -->
              <div
                ref="profileScrollRef"
                class="pt-pane am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+32px)] space-y-4"
                :class="activeTabIndex === 0 ? 'is-active' : 'is-before'"
                :aria-hidden="activeTabIndex !== 0"
                @touchstart.passive="dragSheet.onBodyTouchStart"
                @touchmove="dragSheet.onBodyTouchMove"
                @touchend.passive="dragSheet.onBodyTouchEnd"
                @touchcancel.passive="dragSheet.onBodyTouchEnd"
              >
              <section class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
                <div v-if="!accounts.isLoggedIn" class="p-5 text-center">
                  <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                    <Icon :icon="iconCrown" class="w-7 h-7" />
                  </div>
                  <div class="text-[17px] font-semibold text-[var(--text-primary)]">{{ t('home.loginCardTitle') }}</div>
                  <p class="text-[13px] text-[var(--text-secondary)] mt-1">
                    {{ t('home.loginCardDesc') }}
                  </p>
                  <button
                    type="button"
                    class="mt-4 w-full h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                    @click="ui.loginModalOpen = true"
                  >
                    {{ t('home.loginNow') }}
                  </button>
                </div>

                <div v-else-if="activeAcc" class="p-4 space-y-3.5">
                  <div class="flex items-center gap-3">
                    <div class="w-14 h-14 rounded-full overflow-hidden bg-[var(--bg-subtle)] shrink-0 ring-2 ring-[var(--accent)]/20 shadow-xs">
                      <img v-if="activeAcc.avatar" :src="activeAcc.avatar" class="w-full h-full object-cover" alt="" />
                      <div v-else class="w-full h-full flex items-center justify-center text-[18px] font-bold text-[var(--text-secondary)]">
                        {{ activeAcc.nickname.slice(0, 1) }}
                      </div>
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[18px] font-bold text-[var(--text-primary)] truncate">{{ activeAcc.nickname }}</span>
                        <span
                          v-if="activeAcc.isVip || activeAcc.tvipEndTime"
                          class="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-r from-[#fa243c] to-[#ff6b4a] text-white shrink-0 leading-none"
                        >
                          VIP
                        </span>
                        <span
                          v-if="shortRegionTag"
                          class="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[var(--bg-subtle)] text-[var(--text-secondary)] shrink-0 leading-none"
                        >
                          {{ shortRegionTag }}
                        </span>
                      </div>

                      <div class="mt-1 flex items-center gap-2 whitespace-nowrap overflow-hidden">
                        <span class="text-[12px] text-[var(--text-secondary)] tabular-nums truncate">
                          UID {{ activeAcc.userid }}
                        </span>
                        <span
                          v-if="activeAcc.tvipEndTime"
                          class="text-[11px] text-[var(--text-tertiary)] tabular-nums truncate"
                        >
                          · {{ activeAcc.tvipEndTime.slice(0, 10) }}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="px-2.5 h-8 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-secondary)] border-0 inline-flex items-center gap-0.5 am-tap shrink-0"
                      @click="showAccountSwitcher = !showAccountSwitcher"
                    >
                      <span>{{ t('profile.switch') }}</span>
                      <Icon
                        :icon="iconChevronDown"
                        class="w-3.5 h-3.5 transition-transform"
                        :class="{ 'rotate-180': showAccountSwitcher }"
                      />
                    </button>
                  </div>

                  <div v-if="showAccountSwitcher" class="rounded-2xl bg-[var(--bg-subtle)]/70 divide-y divide-[var(--hairline)] overflow-hidden">
                    <div
                      v-for="acc in accounts.accounts"
                      :key="acc.userid"
                      class="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
                      @click="echoSystem.haptic('selection'); accounts.switchAccount(acc.userid); showAccountSwitcher = false"
                    >
                      <div class="w-8 h-8 rounded-full overflow-hidden bg-[var(--bg-card)] shrink-0">
                        <img v-if="acc.avatar" :src="acc.avatar" class="w-full h-full object-cover" alt="" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-[14px] font-semibold text-[var(--text-primary)] truncate">{{ acc.nickname }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] truncate">
                          {{ acc.tvipEndTime ? `VIP ${acc.tvipEndTime.slice(0, 10)}` : `UID ${acc.userid}` }}
                        </div>
                      </div>
                      <Icon v-if="acc.userid === activeAcc.userid" :icon="iconCheck" class="w-4 h-4 am-accent-text shrink-0" />
                      <button
                        type="button"
                        class="w-7 h-7 rounded-full bg-transparent border-0 flex items-center justify-center text-[var(--text-tertiary)]"
                        @click.stop="accounts.removeAccount(acc.userid)"
                      >
                        <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      class="w-full h-10 px-3 flex items-center justify-center gap-1.5 bg-transparent border-0 text-[13px] font-semibold am-accent-text am-tap"
                      @click="ui.loginModalOpen = true"
                    >
                      <Icon :icon="iconPlus" class="w-4 h-4" />
                      <span>{{ t('profile.addAccount') }}</span>
                    </button>
                  </div>

                  <div class="grid grid-cols-5 divide-x divide-[var(--hairline)] py-2.5 rounded-2xl bg-[var(--bg-subtle)]/55 text-center">
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">Lv.{{ activeAcc.pGrade ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.level') }}</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.friends ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.friends') }}</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.follows ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.follows') }}</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.fans ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.fans') }}</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.visitors ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.visitors') }}</div>
                    </div>
                  </div>

                  <div class="grid grid-cols-3 gap-2 text-center">
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] truncate">
                        {{ genderLabel }} · {{ regionLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.region') }}</div>
                    </div>
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] tabular-nums truncate">
                        {{ musicAgeLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.musicAge') }}</div>
                    </div>
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] tabular-nums truncate">
                        {{ kugouListenDurationLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">{{ t('profile.accountListen') }}</div>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Pinned Extension Quick-Launch Capsules (zero space when none pinned) -->
              <section v-if="plugins.pinnedPanelPlugins.length" class="space-y-1.5" data-pinned-plugin-bar>
                <div class="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('plugins.pinnedQuickBar') }}
                </div>
                <div class="am-hscroll flex items-center gap-2 pb-0.5">
                  <button
                    v-for="item in plugins.pinnedPanelPlugins"
                    :key="item.manifest.id"
                    type="button"
                    class="h-10 pl-2 pr-3.5 rounded-full bg-[var(--bg-card)] shadow-xs border-0 inline-flex items-center gap-2 shrink-0 am-tap"
                    @click="echoSystem.haptic('light'); plugins.openPluginDetail(item.manifest.id)"
                  >
                    <span
                      class="w-6.5 h-6.5 rounded-full bg-gradient-to-br flex items-center justify-center text-white shrink-0"
                      :class="resolvePluginVisual(item.manifest).gradientClass"
                    >
                      <Icon :icon="resolvePluginVisual(item.manifest).icon" class="w-3.5 h-3.5" />
                    </span>
                    <span class="text-[13px] font-semibold text-[var(--text-primary)] whitespace-nowrap">
                      {{ item.manifest.name }}
                    </span>
                  </button>
                </div>
              </section>

              <ListeningStatsChart />
              </div>

              <!-- ==================== TAB 2: 扩展插件 (melune-ext/v1) ==================== -->
              <div
                ref="pluginsScrollRef"
                class="pt-pane am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+32px)] space-y-4"
                :class="activeTabIndex === 1 ? 'is-active' : activeTabIndex > 1 ? 'is-before' : 'is-after'"
                :aria-hidden="activeTabIndex !== 1"
                @touchstart.passive="dragSheet.onBodyTouchStart"
                @touchmove="dragSheet.onBodyTouchMove"
                @touchend.passive="dragSheet.onBodyTouchEnd"
                @touchcancel.passive="dragSheet.onBodyTouchEnd"
              >
                <PluginHubTab :visible="ui.accountSheetOpen && activeTab === 'plugins'" />
              </div>

              <!-- ==================== TAB 3: 偏好设置 ==================== -->
              <div
                ref="settingsScrollRef"
                class="pt-pane am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+32px)] space-y-4"
                :class="activeTabIndex === 2 ? 'is-active' : 'is-after'"
                :aria-hidden="activeTabIndex !== 2"
                @touchstart.passive="dragSheet.onBodyTouchStart"
                @touchmove="dragSheet.onBodyTouchMove"
                @touchend.passive="dragSheet.onBodyTouchEnd"
                @touchcancel.passive="dragSheet.onBodyTouchEnd"
              >
              <!-- Group A: Playback, Transitions, EQ, Language & Appearance (Uniform 2-Row Zero-Overflow!) -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupPlayback') }}
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <!-- Language Selector (Auto / 简体 / 繁體 / EN) -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)]">
                      <Icon :icon="iconLanguage" class="w-4 h-4 am-accent-text shrink-0" />
                      <span class="truncate">{{ t('settings.language') }}</span>
                    </div>
                    <div class="pt-seg-group grid-cols-4">
                      <button
                        v-for="lang in langOptions"
                        :key="lang.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.locale === lang.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.locale = lang.id"
                      >
                        {{ lang.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Audio Quality (4 Tiers: Std / HQ / FLAC / Hi-Res) -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="text-[14.5px] font-medium text-[var(--text-primary)]">{{ t('settings.quality') }}</div>
                    <div class="pt-seg-group grid-cols-4">
                      <button
                        v-for="q in [
                          { id: '128', label: t('settings.quality128') },
                          { id: '320', label: t('settings.quality320') },
                          { id: 'flac', label: t('settings.qualityFlac') },
                          { id: 'high', label: t('settings.qualityHigh') },
                        ]"
                        :key="q.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.quality === q.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.quality = q.id as AudioQuality"
                      >
                        {{ q.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Smooth Track Transition Fade -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)] min-w-0">
                        <Icon :icon="iconWaveSine" class="w-4 h-4 am-accent-text shrink-0" />
                        <span class="truncate">{{ t('settings.transitionTitle') }}</span>
                      </div>
                      <span class="text-[11px] text-[var(--text-secondary)] shrink-0 truncate">{{ t('settings.transitionSub') }}</span>
                    </div>
                    <div class="pt-seg-group grid-cols-4">
                      <button
                        v-for="tr in transitionOptions"
                        :key="tr.id"
                        type="button"
                        class="pt-seg-btn tabular-nums"
                        :class="
                          settings.transitionFadeMs === tr.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.transitionFadeMs = tr.id"
                      >
                        {{ tr.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Volume Leveling -->
                  <label class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
                    <div class="flex items-center gap-2 min-w-0">
                      <Icon :icon="iconVolume" class="w-4 h-4 am-accent-text shrink-0" />
                      <div class="min-w-0">
                        <div class="text-[14.5px] text-[var(--text-primary)] leading-snug">{{ t('settings.volumeLeveling') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">{{ t('settings.volumeLevelingSub') }}</div>
                      </div>
                    </div>
                    <input v-model="settings.volumeLeveling" type="checkbox" class="ios-switch" />
                  </label>

                  <!-- Subtractive Zero-Clip EQ -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)] min-w-0">
                        <Icon :icon="iconAdjustments" class="w-4 h-4 am-accent-text shrink-0" />
                        <span class="truncate">{{ t('settings.eqTitle') }}</span>
                      </div>
                      <span class="text-[11px] text-[var(--text-secondary)] shrink-0 truncate">{{ t('settings.eqSub') }}</span>
                    </div>
                    <div class="pt-seg-group grid-cols-5">
                      <button
                        v-for="eq in eqOptions"
                        :key="eq.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.eqPreset === eq.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.eqPreset = eq.id"
                      >
                        {{ eq.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Appearance Mode -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="text-[14.5px] font-medium text-[var(--text-primary)]">{{ t('settings.appearance') }}</div>
                    <div class="pt-seg-group grid-cols-3">
                      <button
                        v-for="ap in [
                          { id: 'system', label: t('settings.ap.system') },
                          { id: 'light', label: t('settings.ap.light') },
                          { id: 'dark', label: t('settings.ap.dark') },
                        ]"
                        :key="ap.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.appearance === ap.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.appearance = ap.id as AppearanceMode"
                      >
                        {{ ap.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Theme Accent Color -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)]">
                      <Icon :icon="iconPalette" class="w-4 h-4 am-accent-text shrink-0" />
                      <span class="truncate">{{ t('settings.accent') }}</span>
                    </div>
                    <div class="pt-seg-group grid-cols-2">
                      <button
                        v-for="ac in [
                          { id: 'dynamic', label: t('settings.ac.dynamic') },
                          { id: 'apple-red', label: t('settings.ac.red') },
                        ]"
                        :key="ac.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.accentMode === ac.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.accentMode = ac.id as AccentThemeMode"
                      >
                        {{ ac.label }}
                      </button>
                    </div>
                  </div>

                  <!-- Lyrics Font Size 3-Step Selector -->
                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)]">
                      <Icon :icon="iconMessageQuote" class="w-4 h-4 am-accent-text shrink-0" />
                      <span class="truncate">{{ t('settings.lyricSize') }}</span>
                    </div>
                    <div class="pt-seg-group grid-cols-3">
                      <button
                        v-for="ls in lyricSizeOptions"
                        :key="ls.id"
                        type="button"
                        class="pt-seg-btn"
                        :class="
                          settings.lyricFontSize === ls.id
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="echoSystem.haptic('selection'); settings.lyricFontSize = ls.id"
                      >
                        {{ ls.label }}
                      </button>
                    </div>
                  </div>

                  <label class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
                    <div class="min-w-0">
                      <div class="text-[14.5px] text-[var(--text-primary)] leading-snug">{{ t('settings.coverLyrics') }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">{{ t('settings.coverLyricsSub') }}</div>
                    </div>
                    <input v-model="settings.showCoverLyricsPreview" type="checkbox" class="ios-switch" />
                  </label>

                  <label class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
                    <div class="min-w-0">
                      <div class="text-[14.5px] text-[var(--text-primary)] leading-snug">{{ t('settings.lockLyrics') }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">{{ t('settings.lockLyricsSub') }}</div>
                    </div>
                    <input v-model="settings.showLockScreenLyrics" type="checkbox" class="ios-switch" />
                  </label>
                </div>
              </section>

              <!-- Group B: System Media Controls, Smart 2GB Audio Cache, Playlist Snapshots, Backup & Auto-Update -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupSystem') }}
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <!-- 1. Lock Screen & System Live Media Controls (Compact + Collapsible OEM Note) -->
                  <div class="px-4 py-3.5 space-y-2.5">
                    <div class="flex items-start gap-2.5">
                      <Icon :icon="iconDeviceMobile" class="w-4 h-4 am-accent-text shrink-0 mt-0.5" />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)]">
                          <span class="truncate">{{ t('settings.mediaControl') }}</span>
                          <span class="w-2 h-2 rounded-full shrink-0" :class="notifGranted ? 'bg-[#34c759]' : 'bg-[#ff9500]'" />
                        </div>
                        <div class="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                          {{ notifGranted ? t('settings.mediaControlSubGranted') : t('settings.mediaControlSubDenied') }}
                        </div>
                      </div>
                    </div>
                    <div class="grid gap-2" :class="notifGranted ? 'grid-cols-2' : 'grid-cols-1'">
                      <button
                        type="button"
                        class="h-8.5 px-3 rounded-xl text-[12px] font-semibold border-0 am-tap truncate"
                        :class="notifGranted ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)]' : 'am-accent-bg text-white'"
                        @click="handleMediaControlAction"
                      >
                        {{ notifGranted ? t('settings.btnNotif') : t('common.open') }}
                      </button>
                      <button
                        v-if="notifGranted"
                        type="button"
                        class="h-8.5 px-3 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[12px] font-semibold border-0 am-tap truncate"
                        @click="handleOpenAppBatterySettings"
                      >
                        {{ t('settings.btnKeepAlive') }}
                      </button>
                    </div>
                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-2 pt-0.5 bg-transparent border-0 text-[11px] font-medium text-[var(--text-tertiary)] text-left"
                      @click="echoSystem.haptic('selection'); showOemIslandHint = !showOemIslandHint"
                    >
                      <span class="inline-flex items-center gap-1 min-w-0 truncate">
                        <Icon :icon="iconInfoCircle" class="w-3.5 h-3.5 shrink-0 opacity-75" />
                        <span class="truncate">{{ t('settings.oemIslandToggle') }}</span>
                      </span>
                      <Icon
                        :icon="iconChevronDown"
                        class="w-3.5 h-3.5 shrink-0 transition-transform opacity-70"
                        :class="{ 'rotate-180': showOemIslandHint }"
                      />
                    </button>
                    <p
                      v-if="showOemIslandHint"
                      class="m-0 px-3 py-2 rounded-xl bg-[var(--bg-subtle)]/55 text-[11px] leading-relaxed text-[var(--text-secondary)]"
                    >
                      {{ t('settings.oemIslandHint') }}
                    </p>
                  </div>

                  <!-- 2. Configurable Local Smart Audio Cache (Default 2 GB + 5-Step Selector + Offline Ready) -->
                  <div class="px-4 py-3.5 space-y-2.5">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex items-center gap-2.5 min-w-0">
                        <Icon :icon="iconDatabase" class="w-4 h-4 am-accent-text shrink-0" />
                        <div class="min-w-0">
                          <div class="text-[14.5px] font-medium text-[var(--text-primary)] truncate">{{ t('settings.cacheTitle') }}</div>
                          <div class="text-[11px] text-[var(--text-secondary)] tabular-nums truncate mt-0.5">
                            {{ t('settings.cacheSub', { used: cacheUsedLabel, limit: cacheLimitLabel }) }}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="px-3 h-7.5 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 am-tap shrink-0"
                        :disabled="clearingCache"
                        @click="handleClearAudioCache"
                      >
                        {{ clearingCache ? t('settings.btnClearing') : t('settings.btnClear') }}
                      </button>
                    </div>
                    <div
                      v-if="settings.audioCacheMaxMb > 0"
                      class="h-[5px] rounded-full bg-[var(--bg-subtle)] overflow-hidden"
                    >
                      <div
                        class="h-full rounded-full am-accent-bg transition-all duration-300"
                        :style="{ width: `${cacheUsagePercent}%` }"
                      />
                    </div>
                    <div class="pt-seg-group grid-cols-5">
                      <button
                        v-for="opt in audioCacheOptions"
                        :key="opt.mb"
                        type="button"
                        class="pt-seg-btn tabular-nums"
                        :class="
                          settings.audioCacheMaxMb === opt.mb
                            ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                            : 'bg-transparent text-[var(--text-secondary)]'
                        "
                        @click="handleSelectCacheLimit(opt.mb)"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>

                  <!-- 3. Transparent Playlist & Home Local Snapshot Cache (Independent Clear) -->
                  <div class="px-4 py-3.5 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <Icon :icon="iconFolder" class="w-4 h-4 am-accent-text shrink-0" />
                      <div class="min-w-0">
                        <div class="text-[14.5px] font-medium text-[var(--text-primary)] truncate">
                          {{ t('settings.snapshotCacheTitle') }}
                        </div>
                        <div class="text-[11px] text-[var(--text-secondary)] tabular-nums truncate mt-0.5">
                          {{ t('settings.snapshotCacheSub', { count: snapshotPlaylistCount, size: snapshotUsedLabel }) }}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="px-3 h-7.5 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 am-tap shrink-0"
                      :disabled="clearingSnapshots"
                      @click="handleClearSnapshotCache"
                    >
                      {{ clearingSnapshots ? t('settings.btnClearing') : t('settings.btnClear') }}
                    </button>
                  </div>

                  <!-- 4. Stats & Preferences JSON Backup -->
                  <div class="px-4 py-3.5 space-y-2.5">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="text-[14.5px] font-medium text-[var(--text-primary)] leading-snug">{{ t('settings.backupTitle') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">{{ t('settings.backupSub') }}</div>
                      </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        class="h-8.5 px-3 rounded-xl bg-[var(--bg-subtle)] text-[12px] font-semibold am-accent-text border-0 inline-flex items-center justify-center gap-1 am-tap truncate"
                        @click="handleExportBackup"
                      >
                        <Icon :icon="iconFileExport" class="w-3.5 h-3.5 shrink-0" />
                        <span class="truncate">{{ t('settings.btnBackup') }}</span>
                      </button>
                      <button
                        type="button"
                        class="h-8.5 px-3 rounded-xl bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center justify-center gap-1 am-tap truncate"
                        @click="showBackupPanel = !showBackupPanel"
                      >
                        <Icon :icon="iconFileImport" class="w-3.5 h-3.5 shrink-0" />
                        <span class="truncate">{{ t('settings.btnRestore') }}</span>
                      </button>
                    </div>

                    <div v-if="showBackupPanel" class="space-y-2 pt-1">
                      <textarea
                        v-model="importJsonText"
                        rows="3"
                        :placeholder="t('settings.restorePlaceholder')"
                        class="w-full rounded-xl bg-[var(--bg-subtle)] p-2.5 text-[12px] text-[var(--text-primary)] border-0 outline-none resize-none"
                      />
                      <button
                        type="button"
                        class="w-full h-9 rounded-xl am-accent-bg text-white text-[13px] font-semibold border-0 am-tap"
                        :disabled="importingBackup"
                        @click="handleRestoreBackup"
                      >
                        {{ importingBackup ? t('common.loading') : t('settings.btnConfirmRestore') }}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Group C: Dedicated Software Update Card (All Update Controls Unified in One Place!) -->
              <section class="space-y-2" data-settings-update>
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupUpdate') }}
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <!-- 1. Current Version Status + One-Tap Check Update Pill -->
                  <div class="px-4 py-3.5 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <Icon :icon="iconDownload" class="w-4 h-4 am-accent-text shrink-0" />
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--text-primary)]">
                          <span class="truncate tabular-nums">v{{ appVersion }}</span>
                          <span
                            v-if="ui.availableUpdateVersion"
                            class="w-2 h-2 rounded-full bg-[#ff3b30] shrink-0"
                          />
                        </div>
                        <div class="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                          {{
                            ui.availableUpdateVersion
                              ? t('settings.updateStatusNew', { ver: ui.availableUpdateVersion })
                              : t('settings.updateStatusLatest')
                          }}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="h-8 px-3.5 rounded-full text-[12px] font-semibold border-0 inline-flex items-center gap-1.5 am-tap shrink-0"
                      :class="
                        ui.availableUpdateVersion
                          ? 'am-accent-bg text-white shadow-xs'
                          : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                      "
                      :disabled="checkingUpdate"
                      @click="handleCheckUpdate"
                    >
                      <Icon
                        :icon="checkingUpdate ? iconRefresh : iconDownload"
                        class="w-3.5 h-3.5 shrink-0"
                        :class="{ 'animate-spin': checkingUpdate }"
                      />
                      <span>
                        {{
                          checkingUpdate
                            ? t('about.checking')
                            : ui.availableUpdateVersion
                              ? t('update.newBadge', { ver: ui.availableUpdateVersion })
                              : t('about.checkUpdate')
                        }}
                      </span>
                    </button>
                  </div>

                  <!-- 2. Cold-Start Auto-Check Toggle -->
                  <label class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
                    <div class="min-w-0">
                      <div class="text-[14.5px] text-[var(--text-primary)] leading-snug">
                        {{ t('settings.autoCheckUpdate') }}
                      </div>
                      <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">
                        {{ t('settings.autoCheckUpdateSub') }}
                      </div>
                    </div>
                    <input v-model="settings.autoCheckUpdate" type="checkbox" class="ios-switch" />
                  </label>

                  <!-- 3. Collapsible Update Acceleration Route (HTTPS + SHA-256 Verified) -->
                  <div>
                    <button
                      type="button"
                      class="w-full px-4 py-3 bg-transparent border-0 flex items-center justify-between gap-2.5 text-left am-tap"
                      @click="echoSystem.haptic('selection'); showUpdateRoutePanel = !showUpdateRoutePanel"
                    >
                      <span class="text-[14.5px] text-[var(--text-primary)] truncate">{{ t('update.channel') }}</span>
                      <div class="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] shrink-0">
                        <span>{{ settings.updateMirrorMode === 'direct' ? t('update.channelDirect') : t('update.channelAuto') }}</span>
                        <Icon
                          :icon="iconChevronDown"
                          class="w-3.5 h-3.5 transition-transform opacity-70"
                          :class="{ 'rotate-180': showUpdateRoutePanel }"
                        />
                      </div>
                    </button>

                    <div v-if="showUpdateRoutePanel" class="px-4 pb-3.5 pt-0.5 space-y-2.5">
                      <div class="pt-seg-group grid-cols-2">
                        <button
                          v-for="m in mirrorOptions"
                          :key="m.id"
                          type="button"
                          class="pt-seg-btn"
                          :class="
                            settings.updateMirrorMode === m.id
                              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                              : 'bg-transparent text-[var(--text-secondary)]'
                          "
                          @click="echoSystem.haptic('selection'); settings.updateMirrorMode = m.id"
                        >
                          {{ m.label }}
                        </button>
                      </div>
                      <input
                        v-model.trim="settings.customUpdateMirror"
                        type="url"
                        inputmode="url"
                        :placeholder="t('update.customMirrorPlaceholder')"
                        class="w-full h-9 px-3 rounded-xl bg-[var(--bg-subtle)] text-[12.5px] text-[var(--text-primary)] border-0 outline-none"
                      />
                      <p class="text-[11px] text-[var(--text-tertiary)] leading-relaxed m-0">
                        {{ t('update.customMirrorHint') }}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Group D: Compact iOS 26 About Card (Collapsible Philosophy) + Clean Author / Repo / Compliance List -->
              <section class="space-y-2.5" data-settings-about>
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupAbout') }}
                </div>

                <!-- 1. Refined Compact Brand Card with Collapsible Philosophy & Replay Splash -->
                <div
                  class="ml-about-hero relative rounded-[22px] px-4 py-4 overflow-hidden shadow-xs"
                  data-brand-philosophy
                >
                  <div class="ml-about-glow pointer-events-none absolute -top-12 -right-10 w-44 h-44 rounded-full" />
                  <div class="relative z-10">
                    <!-- Compact Horizontal Identity Row -->
                    <div class="flex items-center gap-3.5">
                      <PureToneMark :size="48" class="shadow-md rounded-[13px] shrink-0" />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-[17px] font-bold tracking-[0.04em] ml-about-title truncate">
                            {{ t('app.fullName') }}
                          </span>
                          <span class="px-2 py-0.5 rounded-full ml-about-meta-pill text-[10px] font-semibold tabular-nums shrink-0">
                            v{{ appVersion }} · GPL-3.0
                          </span>
                        </div>
                        <p class="m-0 mt-1 text-[12px] ml-about-copy truncate">
                          {{ t('app.slogan') }}
                        </p>
                      </div>
                    </div>

                    <!-- Slim Action Row: Expandable Brand Philosophy + Replay Splash -->
                    <div class="mt-3.5 pt-3 ml-about-divider flex items-center justify-between gap-2">
                      <button
                        type="button"
                        class="flex items-center gap-1.5 bg-transparent border-0 p-0 text-[12.5px] font-semibold ml-about-title am-tap min-w-0"
                        @click="echoSystem.haptic('selection'); showPhilosophy = !showPhilosophy"
                      >
                        <span class="truncate">{{ t('about.philosophyToggle') }}</span>
                        <span class="text-[11px] font-normal ml-about-en truncate">{{ t('about.philosophyHint') }}</span>
                        <Icon
                          :icon="iconChevronDown"
                          class="w-3.5 h-3.5 shrink-0 transition-transform opacity-75"
                          :class="{ 'rotate-180': showPhilosophy }"
                        />
                      </button>
                      <button
                        type="button"
                        class="h-7 px-2.5 rounded-full ml-about-secondary-btn text-[11px] font-semibold inline-flex items-center gap-1 am-tap shrink-0"
                        @click="ui.replaySplash()"
                      >
                        <Icon :icon="iconSparkles" class="w-3 h-3 shrink-0" />
                        <span>{{ t('about.replaySplash') }}</span>
                      </button>
                    </div>

                    <!-- Smoothly Collapsible Full Brand Philosophy -->
                    <div v-if="showPhilosophy" class="mt-3 pt-3 ml-about-divider space-y-2">
                      <p class="m-0 flex items-start gap-2.5">
                        <span class="ml-about-char w-[20px] h-[20px] rounded-[6px] text-[11px] font-bold inline-flex items-center justify-center shrink-0 mt-[2px]">
                          {{ t('about.miChar') }}
                        </span>
                        <span class="text-[12.5px] leading-[1.68] ml-about-copy">
                          {{ t('about.miDesc') }}
                        </span>
                      </p>
                      <p class="m-0 flex items-start gap-2.5">
                        <span class="ml-about-char w-[20px] h-[20px] rounded-[6px] text-[11px] font-bold inline-flex items-center justify-center shrink-0 mt-[2px]">
                          {{ t('about.yinChar') }}
                        </span>
                        <span class="text-[12.5px] leading-[1.68] ml-about-copy">
                          {{ t('about.yinDesc') }}
                        </span>
                      </p>
                      <p class="m-0 pt-0.5 text-[12px] leading-[1.68] ml-about-vision">
                        {{ t('about.vision') }}
                      </p>
                      <p class="m-0 pt-1 text-[12.5px] font-semibold tracking-[0.03em] ml-about-title">
                        {{ t('about.closing') }}
                      </p>
                    </div>
                  </div>
                </div>

                <!-- 2. Clean 3-Row iOS Grouped List: Author / Open-Source Repo / Legal Disclaimer -->
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <button
                    type="button"
                    class="w-full px-4 py-3 bg-transparent border-0 flex items-center gap-3 text-left am-tap"
                    @click="openAuthorProfile"
                  >
                    <span class="w-8 h-8 rounded-full am-accent-bg text-white text-[11.5px] font-extrabold flex items-center justify-center shrink-0">
                      HX
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-[14px] font-semibold text-[var(--text-primary)] truncate">{{ t('about.authorTitle') }}</span>
                        <span class="text-[11px] text-[var(--text-tertiary)] shrink-0">@{{ APP_AUTHOR }}</span>
                      </div>
                      <p class="text-[11px] text-[var(--text-secondary)] truncate m-0 mt-0.5">
                        {{ t('about.authorShortBio') }}
                      </p>
                    </div>
                    <span class="text-[12px] font-semibold am-accent-text shrink-0">↗</span>
                  </button>

                  <button
                    type="button"
                    class="w-full px-4 py-3 bg-transparent border-0 flex items-center justify-between gap-2.5 text-left am-tap"
                    @click="openGithubRepo"
                  >
                    <div class="flex items-center gap-2.5 min-w-0">
                      <Icon :icon="iconBrandGithub" class="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                      <span class="text-[14px] font-medium text-[var(--text-primary)] truncate">{{ t('about.repoTitle') }}</span>
                    </div>
                    <span class="text-[12px] text-[var(--text-tertiary)] font-mono shrink-0">xhd2005/puretone ↗</span>
                  </button>

                  <button
                    type="button"
                    class="w-full px-4 py-3 bg-transparent border-0 flex items-center justify-between gap-2.5 text-left am-tap"
                    @click="echoSystem.haptic('light'); ui.complianceModalOpen = true"
                  >
                    <div class="flex items-center gap-2.5 min-w-0">
                      <Icon :icon="iconShieldCheck" class="w-4 h-4 am-accent-text shrink-0" />
                      <span class="text-[14px] font-medium text-[var(--text-primary)] truncate">{{ t('about.disclaimerShort') }}</span>
                    </div>
                    <span class="text-[12px] text-[var(--text-tertiary)] shrink-0">{{ t('common.view') }}</span>
                  </button>
                </div>

                <!-- 3. Quiet Editorial Footer -->
                <div class="px-3 pt-1 pb-2 text-center">
                  <p class="text-[11px] text-[var(--text-tertiary)] leading-relaxed m-0">
                    {{ t('about.thanks') }}
                  </p>
                </div>
              </section>
              </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ml-about-hero {
  background: var(--ml-about-bg);
  border: 1px solid var(--ml-about-border);
}
.ml-about-glow {
  background: var(--ml-about-glow);
}
.ml-about-watermark {
  opacity: var(--ml-about-watermark-opacity);
}
.ml-about-title {
  color: var(--ml-about-title);
}
.ml-about-meta-pill {
  background: var(--ml-about-meta-bg);
  color: var(--ml-about-meta-fg);
}
.ml-about-en {
  color: var(--ml-about-en);
}
.ml-about-secondary-btn {
  background: var(--ml-about-btn-bg);
  border: 1px solid var(--ml-about-btn-border);
  color: var(--ml-about-btn-fg);
}
.ml-about-divider {
  border-top: 1px solid var(--ml-about-divider);
}
.ml-about-char {
  background: var(--ml-about-char-bg);
  border: 1px solid var(--ml-about-char-border);
  color: var(--ml-about-char-fg);
}
.ml-about-copy {
  color: var(--ml-about-copy);
}
.ml-about-vision {
  color: var(--ml-about-vision);
}
</style>
