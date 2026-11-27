<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconCheck from '@iconify/icons-tabler/check';
import iconPlus from '@iconify/icons-tabler/plus';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconTrash from '@iconify/icons-tabler/trash';
import iconBell from '@iconify/icons-tabler/bell';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconFlame from '@iconify/icons-tabler/flame';
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
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import {
  useSettingsStore,
  type AccentThemeMode,
  type AppearanceMode,
  type AppLocale,
  type LyricFontSize,
} from '@/stores/settings';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import { echoPlayer } from '@/native/echoPlayer';
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

type ProfileSectionTab = 'profile' | 'vip' | 'settings';

const accounts = useAccountsStore();
const vip = useVipStore();
const settings = useSettingsStore();
const player = usePlayerStore();
const stats = useStatsStore();
const ui = useUiStore();
const { t } = useI18n();

const scrollRef = ref<HTMLElement | null>(null);
const activeTab = ref<ProfileSectionTab>('profile');
const showAccountSwitcher = ref(false);
const showCalendar = ref(false);
const showBackupPanel = ref(false);
const importJsonText = ref('');
const importingBackup = ref(false);
const notifGranted = ref(true);
const cacheUsedMb = ref('0.0');
const clearingCache = ref(false);
const checkingUpdate = ref(false);
const appVersion = ref(FALLBACK_APP_VERSION);

const dragSheet = useDraggableSheet({
  detents: [0.60, 0.92],
  initialDetentIndex: 1,
  scrollElRef: scrollRef,
  onDismiss: () => {
    ui.accountSheetOpen = false;
  },
});

const sectionTabs = computed<Array<{ id: ProfileSectionTab; label: string }>>(() => [
  { id: 'profile', label: t('profile.tab.profile') },
  { id: 'vip', label: t('profile.tab.vip') },
  { id: 'settings', label: t('profile.tab.settings') },
]);

function switchTab(next: ProfileSectionTab) {
  if (activeTab.value === next) return;
  echoSystem.haptic('selection');
  activeTab.value = next;
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
}

async function refreshDeviceStats() {
  const [perm, cache, ver] = await Promise.all([
    echoSystem.checkNotificationPermission(),
    echoPlayer.getAudioCacheStats(),
    getCurrentAppVersion(),
  ]);
  notifGranted.value = perm.granted;
  cacheUsedMb.value = (cache.usedBytes / (1024 * 1024)).toFixed(1);
  appVersion.value = ver;
}

watch(
  () => ui.accountSheetOpen,
  (open) => {
    if (open) {
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

const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];

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
  if (years > 0) return `${years}y ${months}m`;
  return `${months}m ${days}d`;
});

const kugouListenDurationLabel = computed(() => {
  const mins = activeAcc.value?.listenDurationMin;
  if (!mins || mins <= 0) return '--';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMin = Math.floor(mins % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remMin}m`;
  return `${remMin}m`;
});

function formatTierRelative(endTime?: string, active?: boolean): string {
  if (!active || !endTime) return t('vip.inactive');
  const ts = Date.parse(endTime.replace(/-/g, '/'));
  if (Number.isNaN(ts)) return t('vip.active');
  const diffDays = Math.ceil((ts - Date.now()) / (24 * 3600 * 1000));
  if (diffDays <= 0) return t('vip.expired');
  if (diffDays >= 60) return t('vip.monthsLeft', { months: Math.round(diffDays / 30) });
  return t('vip.daysLeft', { days: diffDays });
}

const vipTierCards = computed(() => {
  const tiers = activeAcc.value?.vipTiers;
  const fallbackListen = activeAcc.value?.tvipEndTime || activeAcc.value?.vipEndTime;
  return [
    {
      label: t('vip.svip'),
      short: 'SVIP',
      active: Boolean(tiers?.svip?.active),
      text: formatTierRelative(tiers?.svip?.endTime, tiers?.svip?.active),
      tone: 'from-[#f59e0b] to-[#b45309]',
      ring: 'ring-[#f59e0b]/25',
    },
    {
      label: t('vip.luxury'),
      short: 'VIP',
      active: Boolean(tiers?.luxuryVip?.active),
      text: formatTierRelative(tiers?.luxuryVip?.endTime, tiers?.luxuryVip?.active),
      tone: 'from-[#fbbf24] to-[#d97706]',
      ring: 'ring-[#fbbf24]/25',
    },
    {
      label: t('vip.concept'),
      short: 'LITE',
      active: Boolean(tiers?.conceptVip?.active),
      text: formatTierRelative(tiers?.conceptVip?.endTime, tiers?.conceptVip?.active),
      tone: 'from-[#818cf8] to-[#6366f1]',
      ring: 'ring-[#6366f1]/25',
    },
    {
      label: t('vip.listen'),
      short: 'PLUS',
      active: Boolean(tiers?.listenVip?.active || fallbackListen),
      text: formatTierRelative(tiers?.listenVip?.endTime || fallbackListen, Boolean(tiers?.listenVip?.active || fallbackListen)),
      tone: 'from-[#38bdf8] to-[#0284c7]',
      ring: 'ring-[#0284c7]/25',
    },
  ];
});

const reminderTimeStr = computed({
  get: () =>
    `${String(settings.dailyReminderHour).padStart(2, '0')}:${String(settings.dailyReminderMinute).padStart(2, '0')}`,
  set: (val: string) => {
    const [h, m] = val.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      void settings.setDailyReminder(settings.dailyReminderEnabled, h, m);
    }
  },
});

async function toggleReminder() {
  echoSystem.haptic('selection');
  const next = !settings.dailyReminderEnabled;
  const ok = await settings.setDailyReminder(next);
  if (next && ok) {
    ui.showToast(`${t('vip.reminder')}: ${reminderTimeStr.value}`);
  } else if (next && !ok) {
    ui.showToast('Notification permission denied');
  }
}

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

async function handleClearAudioCache() {
  if (clearingCache.value) return;
  echoSystem.haptic('medium');
  clearingCache.value = true;
  try {
    await echoPlayer.clearAudioCache();
    await refreshDeviceStats();
    ui.showToast(t('settings.btnClear'));
  } finally {
    clearingCache.value = false;
  }
}

async function handleExportBackup() {
  echoSystem.haptic('light');
  try {
    const json = await exportLocalBackupJson(stats.exportSnapshot(), settings.exportSnapshot());
    await echoSystem.copyToClipboard(json);
    ui.showToast('JSON backup copied (token-free)');
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

function handleClaimNow() {
  echoSystem.haptic('medium');
  void vip.claimAccount(accounts.activeAccount, {
    silent: false,
    mixsongid: player.currentSong?.mixSongId,
  });
}

async function handleCheckUpdate() {
  if (checkingUpdate.value) return;
  echoSystem.haptic('light');
  checkingUpdate.value = true;
  try {
    const res = await checkForAppUpdate({ silent: false, currentVersion: appVersion.value });
    if (res && res.hasUpdate) {
      ui.updateReleaseInfo = res;
    } else {
      ui.showToast(`v${appVersion.value} is up to date`);
    }
  } catch (e: any) {
    ui.showToast(e?.message || 'Update check failed');
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

            <!-- iOS 26 Segmented Navigation Control -->
            <div class="px-4 pb-3 am-hairline-b" @touchstart.stop>
              <div class="grid grid-cols-3 gap-1 p-1 rounded-[15px] bg-[var(--bg-subtle)]">
                <button
                  v-for="tab in sectionTabs"
                  :key="tab.id"
                  type="button"
                  class="h-8 rounded-[11px] text-[13px] font-semibold border-0 transition-all"
                  :class="
                    activeTab === tab.id
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent text-[var(--text-secondary)]'
                  "
                  @click="switchTab(tab.id)"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Scrollable Tab Body -->
          <div
            ref="scrollRef"
            class="flex-1 am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+32px)] space-y-4"
            @touchstart.passive="dragSheet.onBodyTouchStart"
            @touchmove="dragSheet.onBodyTouchMove"
            @touchend.passive="dragSheet.onBodyTouchEnd"
            @touchcancel.passive="dragSheet.onBodyTouchEnd"
          >
            <!-- ==================== TAB 1: 档案统计 ==================== -->
            <template v-if="activeTab === 'profile'">
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
                          v-if="vip.claimedToday"
                          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34c759]/14 text-[#2fb350] shrink-0"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
                          {{ t('profile.claimedToday') }}
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

              <ListeningStatsChart />
            </template>

            <!-- ==================== TAB 2: 会员签到 ==================== -->
            <template v-else-if="activeTab === 'vip'">
              <section v-if="!accounts.isLoggedIn" class="rounded-[22px] bg-[var(--bg-card)] p-6 text-center shadow-xs">
                <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                  <Icon :icon="iconCrown" class="w-7 h-7" />
                </div>
                <div class="text-[16px] font-semibold text-[var(--text-primary)]">{{ t('home.loginCardTitle') }}</div>
                <p class="text-[13px] text-[var(--text-secondary)] mt-1">{{ t('home.loginCardDesc') }}</p>
                <button
                  type="button"
                  class="mt-4 w-full h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                  @click="ui.loginModalOpen = true"
                >
                  {{ t('home.loginNow') }}
                </button>
              </section>

              <template v-else>
                <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-[15px] font-bold text-[var(--text-primary)]">{{ t('vip.overview') }}</span>
                    <span class="text-[12px] text-[var(--text-secondary)]">{{ activeAcc?.nickname }}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-2.5">
                    <div
                      v-for="tier in vipTierCards"
                      :key="tier.label"
                      class="rounded-[16px] p-3 bg-[var(--bg-subtle)]/50 flex items-center gap-2.5"
                      :class="tier.active ? `ring-1 ${tier.ring}` : 'opacity-75'"
                    >
                      <div
                        class="w-9 h-9 rounded-[11px] bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-black shrink-0 shadow-xs"
                        :class="tier.active ? tier.tone : 'from-neutral-400/60 to-neutral-500/60'"
                      >
                        {{ tier.short }}
                      </div>
                      <div class="min-w-0">
                        <div class="text-[13px] font-bold text-[var(--text-primary)] leading-tight">{{ tier.label }}</div>
                        <div
                          class="text-[11px] truncate mt-0.5 tabular-nums"
                          :class="tier.active ? 'am-accent-text font-semibold' : 'text-[var(--text-tertiary)]'"
                        >
                          {{ tier.text }}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-medium text-[var(--text-secondary)]">{{ t('vip.dailyRemaining') }}</div>
                      <div class="flex items-baseline gap-1.5 mt-0.5">
                        <span class="text-[36px] font-bold tracking-tight tabular-nums text-[var(--text-primary)] leading-none">
                          {{ vip.vipRemainingDays ?? '--' }}
                        </span>
                        <span class="text-[14px] font-medium text-[var(--text-secondary)]">{{ t('vip.daysUnit') }}</span>
                      </div>
                      <div class="text-[12px] text-[var(--text-secondary)] mt-1.5 tabular-nums">
                        {{ activeAcc?.tvipEndTime ? t('vip.validUntil', { time: activeAcc.tvipEndTime }) : t('vip.claimHint') }}
                      </div>
                    </div>
                    <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] shrink-0">
                      <Icon :icon="iconFlame" class="w-4 h-4 am-accent-text" />
                      <span>{{ t('vip.streak', { days: vip.currentStreakDays }) }}</span>
                    </div>
                  </div>

                  <div class="grid gap-2.5" :class="accounts.accounts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
                    <button
                      type="button"
                      class="h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap shadow-xs"
                      :disabled="vip.isClaiming || vip.isBatchClaiming"
                      @click="handleClaimNow"
                    >
                      <Icon v-if="vip.isClaiming" :icon="iconRefresh" class="w-4 h-4 animate-spin" />
                      <span>{{ vip.isClaiming ? t('vip.claiming') : vip.claimedToday ? t('vip.claimedSync') : t('vip.claimBtn') }}</span>
                    </button>

                    <button
                      v-if="accounts.accounts.length > 1"
                      type="button"
                      class="h-11 rounded-[14px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
                      :disabled="vip.isClaiming || vip.isBatchClaiming"
                      @click="vip.claimAllAccounts(false)"
                    >
                      <span>{{ vip.isBatchClaiming ? vip.batchProgressText || '…' : t('vip.batchClaim', { count: accounts.accounts.length }) }}</span>
                    </button>
                  </div>

                  <div class="pt-3 am-hairline-t">
                    <button
                      type="button"
                      class="w-full flex items-center justify-between text-[13px] font-medium text-[var(--text-secondary)] bg-transparent border-0 p-0"
                      @click="showCalendar = !showCalendar"
                    >
                      <span>
                        {{
                          t('vip.calendarMeta', {
                            month: vip.currentCalendar.monthLabel,
                            claimed: vip.currentCalendar.claimedInMonth,
                            total: vip.currentCalendar.daysInMonth,
                          })
                        }}
                      </span>
                      <span class="am-accent-text font-semibold">{{ showCalendar ? t('vip.collapse') : t('vip.expand') }}</span>
                    </button>

                    <div v-if="showCalendar" class="mt-3">
                      <div class="grid grid-cols-7 gap-1 text-center text-[11px] text-[var(--text-tertiary)] mb-1.5">
                        <span v-for="w in weekLabels" :key="w">{{ w }}</span>
                      </div>
                      <div class="grid grid-cols-7 gap-1.5">
                        <div
                          v-for="cell in vip.currentCalendar.cells"
                          :key="cell.key"
                          class="aspect-square flex items-center justify-center rounded-full text-[12px] font-medium tabular-nums"
                          :class="
                            cell.empty
                              ? ''
                              : cell.isClaimed
                                ? 'am-accent-bg text-white font-semibold'
                                : cell.isFailed
                                  ? 'bg-[#ff3b30]/15 text-[#ff3b30]'
                                  : cell.isToday
                                    ? 'ring-1.5 ring-[var(--accent)] am-accent-text font-bold'
                                    : cell.isFuture
                                      ? 'text-[var(--text-tertiary)]/50'
                                      : 'text-[var(--text-secondary)]'
                          "
                        >
                          {{ cell.empty ? '' : cell.day }}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <label class="px-4 py-3.5 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">{{ t('vip.autoClaim') }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">{{ t('vip.autoClaimSub') }}</div>
                    </div>
                    <input v-model="settings.autoClaimOnLaunch" type="checkbox" class="ios-switch" />
                  </label>

                  <div class="px-4 py-3.5 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconBell" class="w-4 h-4 am-accent-text" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">{{ t('vip.reminder') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">{{ t('vip.reminderSub') }}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <input
                        v-if="settings.dailyReminderEnabled"
                        v-model="reminderTimeStr"
                        type="time"
                        class="bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[13px] font-medium px-2 py-1 rounded-lg border-0"
                      />
                      <input
                        type="checkbox"
                        :checked="settings.dailyReminderEnabled"
                        class="ios-switch"
                        @change="toggleReminder"
                      />
                    </div>
                  </div>
                </section>
              </template>
            </template>

            <!-- ==================== TAB 3: 偏好设置 ==================== -->
            <template v-else>
              <!-- Group A: Playback, EQ, Language & Appearance -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupPlayback') }}
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <!-- Language Selector (Auto / 简体 / 繁體 / EN) -->
                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                      <Icon :icon="iconLanguage" class="w-4 h-4 am-accent-text shrink-0" />
                      <span>{{ t('settings.language') }}</span>
                    </div>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="lang in langOptions"
                        :key="lang.id"
                        type="button"
                        class="px-2 h-7 rounded-[8px] text-[11.5px] font-semibold border-0 transition-all"
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

                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <span class="text-[15px] text-[var(--text-primary)]">{{ t('settings.quality') }}</span>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="q in [
                          { id: '128', label: t('settings.quality128') },
                          { id: '320', label: t('settings.quality320') },
                          { id: 'flac', label: t('settings.qualityFlac') },
                        ]"
                        :key="q.id"
                        type="button"
                        class="px-2.5 h-7 rounded-[8px] text-[12px] font-semibold border-0 transition-all"
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

                  <div class="px-4 py-3 space-y-2">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                        <Icon :icon="iconAdjustments" class="w-4 h-4 am-accent-text" />
                        <span>{{ t('settings.eqTitle') }}</span>
                      </div>
                      <span class="text-[11px] text-[var(--text-secondary)]">{{ t('settings.eqSub') }}</span>
                    </div>
                    <div class="grid grid-cols-5 gap-1 p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="eq in eqOptions"
                        :key="eq.id"
                        type="button"
                        class="h-7 rounded-[8px] text-[12px] font-semibold border-0 transition-all"
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

                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <span class="text-[15px] text-[var(--text-primary)]">{{ t('settings.appearance') }}</span>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="ap in [
                          { id: 'system', label: t('settings.ap.system') },
                          { id: 'light', label: t('settings.ap.light') },
                          { id: 'dark', label: t('settings.ap.dark') },
                        ]"
                        :key="ap.id"
                        type="button"
                        class="px-2.5 h-7 rounded-[8px] text-[12px] font-semibold border-0 transition-all"
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

                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                      <Icon :icon="iconPalette" class="w-4 h-4 am-accent-text" />
                      <span>{{ t('settings.accent') }}</span>
                    </div>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="ac in [
                          { id: 'dynamic', label: t('settings.ac.dynamic') },
                          { id: 'apple-red', label: t('settings.ac.red') },
                        ]"
                        :key="ac.id"
                        type="button"
                        class="px-2.5 h-7 rounded-[8px] text-[12px] font-semibold border-0 transition-all"
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
                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                      <Icon :icon="iconMessageQuote" class="w-4 h-4 am-accent-text shrink-0" />
                      <span>{{ t('settings.lyricSize') }}</span>
                    </div>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="ls in lyricSizeOptions"
                        :key="ls.id"
                        type="button"
                        class="px-2.5 h-7 rounded-[8px] text-[12px] font-semibold border-0 transition-all"
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

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">{{ t('settings.coverLyrics') }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">{{ t('settings.coverLyricsSub') }}</div>
                    </div>
                    <input v-model="settings.showCoverLyricsPreview" type="checkbox" class="ios-switch" />
                  </label>

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">{{ t('settings.lockLyrics') }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">{{ t('settings.lockLyricsSub') }}</div>
                    </div>
                    <input v-model="settings.showLockScreenLyrics" type="checkbox" class="ios-switch" />
                  </label>

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconSparkles" class="w-4 h-4 am-accent-text shrink-0" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">{{ t('settings.autoUnblock') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">{{ t('settings.autoUnblockSub') }}</div>
                      </div>
                    </div>
                    <input v-model="settings.enableUnblock" type="checkbox" class="ios-switch" />
                  </label>
                </div>
              </section>

              <!-- Group B: Universal Android Media Controls, Cache & JSON Backup/Restore -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  {{ t('settings.groupSystem') }}
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <Icon :icon="iconDeviceMobile" class="w-4 h-4 am-accent-text shrink-0" />
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                          <span>{{ t('settings.mediaControl') }}</span>
                          <span class="w-2 h-2 rounded-full" :class="notifGranted ? 'bg-[#34c759]' : 'bg-[#ff9500]'" />
                        </div>
                        <div class="text-[11px] text-[var(--text-secondary)] leading-snug">
                          {{ notifGranted ? t('settings.mediaControlSubGranted') : t('settings.mediaControlSubDenied') }}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        class="px-2.5 h-7 rounded-full text-[12px] font-semibold border-0 am-tap"
                        :class="notifGranted ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)]' : 'am-accent-bg text-white'"
                        @click="handleMediaControlAction"
                      >
                        {{ notifGranted ? t('settings.btnNotif') : t('common.open') }}
                      </button>
                      <button
                        v-if="notifGranted"
                        type="button"
                        class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[12px] font-medium border-0 am-tap"
                        @click="handleOpenAppBatterySettings"
                      >
                        {{ t('settings.btnKeepAlive') }}
                      </button>
                    </div>
                  </div>

                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconDatabase" class="w-4 h-4 am-accent-text shrink-0" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">{{ t('settings.cacheTitle') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] tabular-nums">
                          {{ t('settings.cacheSub', { mb: cacheUsedMb }) }}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="px-3 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 am-tap shrink-0"
                      :disabled="clearingCache"
                      @click="handleClearAudioCache"
                    >
                      {{ clearingCache ? t('settings.btnClearing') : t('settings.btnClear') }}
                    </button>
                  </div>

                  <div class="px-4 py-3 space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-[15px] text-[var(--text-primary)]">{{ t('settings.backupTitle') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">{{ t('settings.backupSub') }}</div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold am-accent-text border-0 inline-flex items-center gap-1 am-tap"
                          @click="handleExportBackup"
                        >
                          <Icon :icon="iconFileExport" class="w-3.5 h-3.5" />
                          <span>{{ t('settings.btnBackup') }}</span>
                        </button>
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center gap-1 am-tap"
                          @click="showBackupPanel = !showBackupPanel"
                        >
                          <Icon :icon="iconFileImport" class="w-3.5 h-3.5" />
                          <span>{{ t('settings.btnRestore') }}</span>
                        </button>
                      </div>
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

              <!-- Group C: About PureTone, Hayden Xue Author Bio, Repo & Full Compliance -->
              <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <PureToneMark :size="44" />
                    <div class="min-w-0">
                      <div class="text-[16px] font-bold text-[var(--text-primary)] whitespace-nowrap">{{ t('app.fullName') }}</div>
                      <div class="text-[12px] text-[var(--text-secondary)] tabular-nums truncate">
                        v{{ appVersion }} · GPL-3.0
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="px-3 h-8 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold am-accent-text border-0 inline-flex items-center gap-1 am-tap shrink-0"
                    :disabled="checkingUpdate"
                    @click="handleCheckUpdate"
                  >
                    <Icon :icon="checkingUpdate ? iconRefresh : iconDownload" class="w-3.5 h-3.5" :class="{ 'animate-spin': checkingUpdate }" />
                    <span>{{ checkingUpdate ? t('about.checking') : t('about.checkUpdate') }}</span>
                  </button>
                </div>

                <!-- Author Card: Hayden Xue (@xhd2005) -->
                <div
                  class="rounded-2xl bg-[var(--bg-subtle)]/55 p-3 space-y-1.5 cursor-pointer am-tap"
                  @click="openAuthorProfile"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="w-7 h-7 rounded-full am-accent-bg text-white text-[12px] font-extrabold flex items-center justify-center shrink-0">
                        HX
                      </span>
                      <div class="min-w-0">
                        <div class="text-[13px] font-bold text-[var(--text-primary)] truncate">{{ t('about.authorTitle') }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] truncate">@{{ APP_AUTHOR }}</div>
                      </div>
                    </div>
                    <span class="text-[11px] font-semibold am-accent-text shrink-0">GitHub ↗</span>
                  </div>
                  <p class="text-[11.5px] text-[var(--text-secondary)] leading-relaxed m-0">
                    {{ t('about.authorBio') }}
                  </p>
                </div>

                <div class="space-y-2">
                  <button
                    type="button"
                    class="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-subtle)]/75 text-[13px] font-medium text-[var(--text-primary)] border-0 flex items-center justify-between am-tap"
                    @click="openGithubRepo"
                  >
                    <span class="flex items-center gap-2 min-w-0">
                      <Icon :icon="iconBrandGithub" class="w-4 h-4 shrink-0" />
                      <span class="truncate">github.com/xhd2005/puretone</span>
                    </span>
                    <span class="text-[12px] am-accent-text font-semibold shrink-0 ml-2">{{ t('about.repoLink') }}</span>
                  </button>

                  <button
                    type="button"
                    class="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-subtle)]/50 text-[13px] font-medium text-[var(--text-secondary)] border-0 flex items-center justify-between am-tap"
                    @click="echoSystem.haptic('light'); ui.complianceModalOpen = true"
                  >
                    <span class="flex items-center gap-2">
                      <Icon :icon="iconShieldCheck" class="w-4 h-4 am-accent-text shrink-0" />
                      <span>{{ t('about.disclaimerLink') }}</span>
                    </span>
                    <span class="text-[12px] text-[var(--text-tertiary)]">{{ t('common.view') }}</span>
                  </button>
                </div>

                <p class="text-[11px] text-[var(--text-tertiary)] leading-relaxed m-0 px-0.5">
                  {{ t('about.thanks') }}
                </p>
              </section>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ios-switch {
  appearance: none;
  -webkit-appearance: none;
  width: 48px;
  height: 28px;
  border-radius: 999px;
  background: var(--bg-subtle);
  position: relative;
  cursor: pointer;
  transition: background-color 220ms ease;
  flex-shrink: 0;
}
.ios-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  transition: transform 240ms var(--spring-ease);
}
.ios-switch:checked {
  background: #34c759;
}
.ios-switch:checked::after {
  transform: translateX(20px);
}
</style>
