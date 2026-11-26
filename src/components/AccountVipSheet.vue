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
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { useSettingsStore, type AccentThemeMode, type AppearanceMode } from '@/stores/settings';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { useUiStore } from '@/stores/ui';
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

const sectionTabs: Array<{ id: ProfileSectionTab; label: string }> = [
  { id: 'profile', label: '档案统计' },
  { id: 'vip', label: '会员签到' },
  { id: 'settings', label: '偏好设置' },
];

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

const eqOptions: Array<{ id: EqPresetId; label: string }> = [
  { id: 'flat', label: '原声' },
  { id: 'vocal', label: '人声' },
  { id: 'bass', label: '低音' },
  { id: 'night', label: '深夜' },
  { id: 'live', label: '现场' },
];

const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];

const activeAcc = computed(() => accounts.activeAccount);

const genderLabel = computed(() => {
  const g = activeAcc.value?.gender;
  if (g === 1) return '男';
  if (g === 0 || g === 2) return '女';
  return '保密';
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
  if (years > 0) return `${years}年${months}个月`;
  return `${months}个月${days}天`;
});

const kugouListenDurationLabel = computed(() => {
  const mins = activeAcc.value?.listenDurationMin;
  if (!mins || mins <= 0) return '--';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMin = Math.floor(mins % 60);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${remMin}分`;
  return `${remMin}分钟`;
});

function formatTierRelative(endTime?: string, active?: boolean): string {
  if (!active || !endTime) return '未开通';
  const ts = Date.parse(endTime.replace(/-/g, '/'));
  if (Number.isNaN(ts)) return '已开通';
  const diffDays = Math.ceil((ts - Date.now()) / (24 * 3600 * 1000));
  if (diffDays <= 0) return '已到期';
  if (diffDays >= 60) return `${Math.round(diffDays / 30)} 个月后到期`;
  return `${diffDays} 天后到期`;
}

const vipTierCards = computed(() => {
  const tiers = activeAcc.value?.vipTiers;
  const fallbackListen = activeAcc.value?.tvipEndTime || activeAcc.value?.vipEndTime;
  return [
    {
      label: '超级 VIP',
      short: 'SVIP',
      active: Boolean(tiers?.svip?.active),
      text: formatTierRelative(tiers?.svip?.endTime, tiers?.svip?.active),
      tone: 'from-[#f59e0b] to-[#b45309]',
      ring: 'ring-[#f59e0b]/25',
    },
    {
      label: '豪华 VIP',
      short: 'VIP',
      active: Boolean(tiers?.luxuryVip?.active),
      text: formatTierRelative(tiers?.luxuryVip?.endTime, tiers?.luxuryVip?.active),
      tone: 'from-[#fbbf24] to-[#d97706]',
      ring: 'ring-[#fbbf24]/25',
    },
    {
      label: '概念会员',
      short: '概念',
      active: Boolean(tiers?.conceptVip?.active),
      text: formatTierRelative(tiers?.conceptVip?.endTime, tiers?.conceptVip?.active),
      tone: 'from-[#818cf8] to-[#6366f1]',
      ring: 'ring-[#6366f1]/25',
    },
    {
      label: '畅听会员',
      short: '畅听',
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
    ui.showToast(`已设每日 ${reminderTimeStr.value} 签到提醒`);
  } else if (next && !ok) {
    ui.showToast('未获得系统通知权限');
  } else {
    ui.showToast('已关闭每日签到提醒');
  }
}

async function handleVivoLockScreenAction() {
  echoSystem.haptic('light');
  if (!notifGranted.value) {
    const ok = await echoSystem.requestNotificationPermission();
    notifGranted.value = ok;
    if (ok) {
      ui.showToast('已开启锁屏与原子岛通知权限');
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
    ui.showToast('已清理本地音频缓存');
  } finally {
    clearingCache.value = false;
  }
}

async function handleExportBackup() {
  echoSystem.haptic('light');
  try {
    const json = await exportLocalBackupJson(stats.exportSnapshot(), settings.exportSnapshot());
    await echoSystem.copyToClipboard(json);
    ui.showToast('已复制纯音备份 JSON（不含账号令牌），可粘贴保存至备忘录');
  } catch {
    ui.showToast('导出备份失败');
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
    ui.showToast(`恢复成功：已同步 ${summary.totalPlays} 条听歌记录与 ${summary.pinnedCount} 条音源偏好`);
  } catch (e: any) {
    ui.showToast(e?.message || '恢复失败，请检查 JSON 完整性', 3000);
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
      ui.showToast(`当前已是最新版本 v${appVersion.value}`);
    }
  } catch (e: any) {
    ui.showToast(e?.message || '检查更新失败，请检查网络');
  } finally {
    checkingUpdate.value = false;
  }
}

async function openGithubRepo() {
  echoSystem.haptic('light');
  await echoSystem.openExternalUrl(APP_REPO_URL);
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
              <span class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">个人中心</span>
              <button
                type="button"
                class="text-[16px] font-semibold am-accent-text bg-transparent border-0 px-1 py-1 am-tap"
                @click="ui.accountSheetOpen = false"
              >
                完成
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

          <!-- Scrollable Tab Body (top-pull smoothly chains into GPU sheet drag!) -->
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
              <!-- Refined Personal Identity Card (Zero awkward wrapping!) -->
              <section class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
                <div v-if="!accounts.isLoggedIn" class="p-5 text-center">
                  <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                    <Icon :icon="iconCrown" class="w-7 h-7" />
                  </div>
                  <div class="text-[17px] font-semibold text-[var(--text-primary)]">登录酷狗概念版账号</div>
                  <p class="text-[13px] text-[var(--text-secondary)] mt-1">
                    同步歌单与乐龄档案，解锁每日畅听 VIP 无损音质
                  </p>
                  <button
                    type="button"
                    class="mt-4 w-full h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                    @click="ui.loginModalOpen = true"
                  >
                    立即登录
                  </button>
                </div>

                <div v-else-if="activeAcc" class="p-4 space-y-3.5">
                  <!-- Top Row: Avatar + Single-Line Name/Badges + Switcher -->
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

                      <!-- Strictly Single-Line UID + Claim Status -->
                      <div class="mt-1 flex items-center gap-2 whitespace-nowrap overflow-hidden">
                        <span class="text-[12px] text-[var(--text-secondary)] tabular-nums truncate">
                          UID {{ activeAcc.userid }}
                        </span>
                        <span
                          v-if="vip.claimedToday"
                          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34c759]/14 text-[#2fb350] shrink-0"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
                          今日已签
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="px-2.5 h-8 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-secondary)] border-0 inline-flex items-center gap-0.5 am-tap shrink-0"
                      @click="showAccountSwitcher = !showAccountSwitcher"
                    >
                      <span>切换</span>
                      <Icon
                        :icon="iconChevronDown"
                        class="w-3.5 h-3.5 transition-transform"
                        :class="{ 'rotate-180': showAccountSwitcher }"
                      />
                    </button>
                  </div>

                  <!-- Collapsible Multi-Account Switcher -->
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
                          {{ acc.tvipEndTime ? `VIP 至 ${acc.tvipEndTime.slice(0, 10)}` : `UID ${acc.userid}` }}
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
                      <span>添加酷狗账号（多号轮签）</span>
                    </button>
                  </div>

                  <!-- Balanced 5-Column Social Strip -->
                  <div class="grid grid-cols-5 divide-x divide-[var(--hairline)] py-2.5 rounded-2xl bg-[var(--bg-subtle)]/55 text-center">
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">Lv.{{ activeAcc.pGrade ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">等级</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.friends ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">好友</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.follows ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">关注</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.fans ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">粉丝</div>
                    </div>
                    <div>
                      <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">{{ activeAcc.visitors ?? '--' }}</div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">访客</div>
                    </div>
                  </div>

                  <!-- Symmetric 3-Column Account Archive Strip -->
                  <div class="grid grid-cols-3 gap-2 text-center">
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] truncate">
                        {{ genderLabel }} · {{ regionLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">档案地区</div>
                    </div>
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] tabular-nums truncate">
                        {{ musicAgeLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">酷狗乐龄</div>
                    </div>
                    <div class="rounded-xl bg-[var(--bg-subtle)]/40 py-2 px-1.5">
                      <div class="text-[12.5px] font-bold text-[var(--text-primary)] tabular-nums truncate">
                        {{ kugouListenDurationLabel }}
                      </div>
                      <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">账号听歌</div>
                    </div>
                  </div>
                </div>
              </section>

              <!-- iOS Screen Time Interactive Bar Chart & Top Songs -->
              <ListeningStatsChart />
            </template>

            <!-- ==================== TAB 2: 会员签到 ==================== -->
            <template v-else-if="activeTab === 'vip'">
              <section v-if="!accounts.isLoggedIn" class="rounded-[22px] bg-[var(--bg-card)] p-6 text-center shadow-xs">
                <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                  <Icon :icon="iconCrown" class="w-7 h-7" />
                </div>
                <div class="text-[16px] font-semibold text-[var(--text-primary)]">登录后管理每日畅听 VIP</div>
                <p class="text-[13px] text-[var(--text-secondary)] mt-1">支持多账号轮签、启动静默签到与月度打卡日历</p>
                <button
                  type="button"
                  class="mt-4 w-full h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                  @click="ui.loginModalOpen = true"
                >
                  立即登录酷狗账号
                </button>
              </section>

              <template v-else>
                <!-- 2x2 Sleek 4-Tier VIP Overview -->
                <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-[15px] font-bold text-[var(--text-primary)]">会员权益总览</span>
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

                <!-- Daily VIP Claim Hero & Calendar -->
                <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-medium text-[var(--text-secondary)]">每日畅听 VIP 剩余</div>
                      <div class="flex items-baseline gap-1.5 mt-0.5">
                        <span class="text-[36px] font-bold tracking-tight tabular-nums text-[var(--text-primary)] leading-none">
                          {{ vip.vipRemainingDays ?? '--' }}
                        </span>
                        <span class="text-[14px] font-medium text-[var(--text-secondary)]">天</span>
                      </div>
                      <div class="text-[12px] text-[var(--text-secondary)] mt-1.5 tabular-nums">
                        {{ activeAcc?.tvipEndTime ? `有效期至 ${activeAcc.tvipEndTime}` : '点击一键签到同步最新有效期' }}
                      </div>
                    </div>
                    <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] shrink-0">
                      <Icon :icon="iconFlame" class="w-4 h-4 am-accent-text" />
                      <span>连签 {{ vip.currentStreakDays }} 天</span>
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
                      <span>{{ vip.isClaiming ? '签到中…' : vip.claimedToday ? '今日已领 · 补同步' : '一键领取今日 VIP' }}</span>
                    </button>

                    <button
                      v-if="accounts.accounts.length > 1"
                      type="button"
                      class="h-11 rounded-[14px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
                      :disabled="vip.isClaiming || vip.isBatchClaiming"
                      @click="vip.claimAllAccounts(false)"
                    >
                      <span>{{ vip.isBatchClaiming ? vip.batchProgressText || '轮签中…' : `全号轮签 (${accounts.accounts.length})` }}</span>
                    </button>
                  </div>

                  <!-- Collapsible Monthly Calendar -->
                  <div class="pt-3 am-hairline-t">
                    <button
                      type="button"
                      class="w-full flex items-center justify-between text-[13px] font-medium text-[var(--text-secondary)] bg-transparent border-0 p-0"
                      @click="showCalendar = !showCalendar"
                    >
                      <span>{{ vip.currentCalendar.monthLabel }} 打卡日历 · 本月 {{ vip.currentCalendar.claimedInMonth }}/{{ vip.currentCalendar.daysInMonth }} 天</span>
                      <span class="am-accent-text font-semibold">{{ showCalendar ? '收起' : '展开' }}</span>
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

                <!-- Auto-Claim & Daily Reminder Switches -->
                <section class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <label class="px-4 py-3.5 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">打开 App 自动静默签到</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">自动完成每日畅听 VIP 续期</div>
                    </div>
                    <input v-model="settings.autoClaimOnLaunch" type="checkbox" class="ios-switch" />
                  </label>

                  <div class="px-4 py-3.5 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconBell" class="w-4 h-4 am-accent-text" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">每日签到提醒</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">到点推送，轻点自动签</div>
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
              <!-- Group A: Playback, EQ & Appearance -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  播放、音效与外观
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <span class="text-[15px] text-[var(--text-primary)]">优先音质</span>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="q in [
                          { id: '128', label: '标准' },
                          { id: '320', label: '高品' },
                          { id: 'flac', label: '无损' },
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
                        <span>听感均衡器（EQ）</span>
                      </div>
                      <span class="text-[11px] text-[var(--text-secondary)]">原生无损调音</span>
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
                    <span class="text-[15px] text-[var(--text-primary)]">外观模式</span>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="ap in [
                          { id: 'system', label: '跟随系统' },
                          { id: 'light', label: '浅色' },
                          { id: 'dark', label: '深色' },
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
                      <span>主题强调色</span>
                    </div>
                    <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
                      <button
                        v-for="ac in [
                          { id: 'dynamic', label: '随封面取色' },
                          { id: 'apple-red', label: '经典苹果红' },
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

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">封面页 2 行小歌词预览</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">轻点小歌词直达全屏逐字歌词</div>
                    </div>
                    <input v-model="settings.showCoverLyricsPreview" type="checkbox" class="ios-switch" />
                  </label>

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div>
                      <div class="text-[15px] text-[var(--text-primary)]">锁屏与通知实时歌词</div>
                      <div class="text-[11px] text-[var(--text-secondary)]">在通知中心与锁屏实时同步歌词</div>
                    </div>
                    <input v-model="settings.showLockScreenLyrics" type="checkbox" class="ios-switch" />
                  </label>

                  <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconSparkles" class="w-4 h-4 am-accent-text shrink-0" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">灰歌自动解灰</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">内置四通道并行匹配原唱 320k 音源</div>
                      </div>
                    </div>
                    <input v-model="settings.enableUnblock" type="checkbox" class="ios-switch" />
                  </label>
                </div>
              </section>

              <!-- Group B: Vivo System, Cache & JSON Backup/Restore -->
              <section class="space-y-2">
                <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                  系统适配与数据备份
                </div>
                <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <Icon :icon="iconDeviceMobile" class="w-4 h-4 am-accent-text shrink-0" />
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                          <span>Vivo 锁屏与原子岛</span>
                          <span class="w-2 h-2 rounded-full" :class="notifGranted ? 'bg-[#34c759]' : 'bg-[#ff9500]'" />
                        </div>
                        <div class="text-[11px] text-[var(--text-secondary)] leading-snug">
                          {{ notifGranted ? '可在系统「通知与状态栏 → 原子通知」确认已开启纯音' : '需开启通知权限以激活锁屏播控与原子岛' }}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        class="px-2.5 h-7 rounded-full text-[12px] font-semibold border-0 am-tap"
                        :class="notifGranted ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)]' : 'am-accent-bg text-white'"
                        @click="handleVivoLockScreenAction"
                      >
                        {{ notifGranted ? '通知' : '开启' }}
                      </button>
                      <button
                        v-if="notifGranted"
                        type="button"
                        class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[12px] font-medium border-0 am-tap"
                        @click="handleOpenAppBatterySettings"
                      >
                        保活
                      </button>
                    </div>
                  </div>

                  <div class="px-4 py-3 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <Icon :icon="iconDatabase" class="w-4 h-4 am-accent-text shrink-0" />
                      <div>
                        <div class="text-[15px] text-[var(--text-primary)]">本地音频智能缓存</div>
                        <div class="text-[11px] text-[var(--text-secondary)] tabular-nums">
                          已用 {{ cacheUsedMb }} MB / 300 MB · 重复听零等待
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="px-3 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 am-tap shrink-0"
                      :disabled="clearingCache"
                      @click="handleClearAudioCache"
                    >
                      {{ clearingCache ? '清理中…' : '清理' }}
                    </button>
                  </div>

                  <!-- JSON Backup & Restore -->
                  <div class="px-4 py-3 space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-[15px] text-[var(--text-primary)]">统计与偏好 JSON 备份</div>
                        <div class="text-[11px] text-[var(--text-secondary)]">换机保留听歌柱状图与 EQ（绝不含登录令牌）</div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold am-accent-text border-0 inline-flex items-center gap-1 am-tap"
                          @click="handleExportBackup"
                        >
                          <Icon :icon="iconFileExport" class="w-3.5 h-3.5" />
                          <span>备份</span>
                        </button>
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center gap-1 am-tap"
                          @click="showBackupPanel = !showBackupPanel"
                        >
                          <Icon :icon="iconFileImport" class="w-3.5 h-3.5" />
                          <span>恢复</span>
                        </button>
                      </div>
                    </div>

                    <div v-if="showBackupPanel" class="space-y-2 pt-1">
                      <textarea
                        v-model="importJsonText"
                        rows="3"
                        placeholder="粘贴之前导出的 PureTone JSON 备份内容…"
                        class="w-full rounded-xl bg-[var(--bg-subtle)] p-2.5 text-[12px] text-[var(--text-primary)] border-0 outline-none resize-none"
                      />
                      <button
                        type="button"
                        class="w-full h-9 rounded-xl am-accent-bg text-white text-[13px] font-semibold border-0 am-tap"
                        :disabled="importingBackup"
                        @click="handleRestoreBackup"
                      >
                        {{ importingBackup ? '恢复中…' : '确认导入恢复' }}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Group C: About PureTone, Repaired Logo, Author & Compliance -->
              <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <PureToneMark :size="44" />
                    <div class="min-w-0">
                      <div class="text-[16px] font-bold text-[var(--text-primary)] whitespace-nowrap">纯音 · PureTone</div>
                      <div class="text-[12px] text-[var(--text-secondary)] tabular-nums truncate">
                        v{{ appVersion }} · 作者 {{ APP_AUTHOR }} · GPL-3.0
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
                    <span>{{ checkingUpdate ? '检查中…' : '检查更新' }}</span>
                  </button>
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
                    <span class="text-[12px] am-accent-text font-semibold shrink-0 ml-2">开源主页</span>
                  </button>

                  <button
                    type="button"
                    class="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-subtle)]/50 text-[13px] font-medium text-[var(--text-secondary)] border-0 flex items-center justify-between am-tap"
                    @click="echoSystem.haptic('light'); ui.complianceModalOpen = true"
                  >
                    <span class="flex items-center gap-2">
                      <Icon :icon="iconShieldCheck" class="w-4 h-4 am-accent-text shrink-0" />
                      <span>开源合规与免责声明</span>
                    </span>
                    <span class="text-[12px] text-[var(--text-tertiary)]">查看</span>
                  </button>
                </div>

                <p class="text-[11px] text-[var(--text-tertiary)] leading-relaxed m-0 px-0.5">
                  极简无广告 · 本地直连。感谢 KuGouMusicApi、Jetpack Media3、Capacitor 与 Vue 开源社区。
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
