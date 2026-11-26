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
import iconChartBar from '@iconify/icons-tabler/chart-bar';
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import iconPalette from '@iconify/icons-tabler/palette';
import iconChevronDown from '@iconify/icons-tabler/chevron-down';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
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
import {
  APP_AUTHOR,
  APP_REPO_URL,
  checkForAppUpdate,
  FALLBACK_APP_VERSION,
  getCurrentAppVersion,
} from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';

const accounts = useAccountsStore();
const vip = useVipStore();
const settings = useSettingsStore();
const player = usePlayerStore();
const stats = useStatsStore();
const ui = useUiStore();

const scrollRef = ref<HTMLElement | null>(null);
const showAccountSwitcher = ref(false);
const showCalendar = ref(false);
const notifGranted = ref(true);
const cacheUsedMb = ref('0.0');
const clearingCache = ref(false);
const checkingUpdate = ref(false);
const appVersion = ref(FALLBACK_APP_VERSION);

const dragSheet = useDraggableSheet({
  detents: [0.58, 0.92],
  initialDetentIndex: 1,
  scrollElRef: scrollRef,
  onDismiss: () => {
    ui.accountSheetOpen = false;
  },
});

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
  if (p && c && p !== c) return `${p} - ${c}`;
  return p || c || '--';
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
  return `${years} 年 ${months} 个月 ${days} 天`;
});

const kugouListenDurationLabel = computed(() => {
  const mins = activeAcc.value?.listenDurationMin;
  if (!mins || mins <= 0) return '--';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remMin = Math.floor(mins % 60);
  if (days > 0) return `${days} 天 ${hours} 小时 ${remMin} 分钟`;
  if (hours > 0) return `${hours} 小时 ${remMin} 分钟`;
  return `${remMin} 分钟`;
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
      label: '超级VIP',
      active: Boolean(tiers?.svip?.active),
      text: formatTierRelative(tiers?.svip?.endTime, tiers?.svip?.active),
      tone: 'from-[#f59e0b] to-[#b45309]',
    },
    {
      label: '豪华VIP',
      active: Boolean(tiers?.luxuryVip?.active),
      text: formatTierRelative(tiers?.luxuryVip?.endTime, tiers?.luxuryVip?.active),
      tone: 'from-[#fbbf24] to-[#d97706]',
    },
    {
      label: '概念会员',
      active: Boolean(tiers?.conceptVip?.active),
      text: formatTierRelative(tiers?.conceptVip?.endTime, tiers?.conceptVip?.active),
      tone: 'from-[#818cf8] to-[#6366f1]',
    },
    {
      label: '畅听会员',
      active: Boolean(tiers?.listenVip?.active || fallbackListen),
      text: formatTierRelative(tiers?.listenVip?.endTime || fallbackListen, Boolean(tiers?.listenVip?.active || fallbackListen)),
      tone: 'from-[#38bdf8] to-[#0284c7]',
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

function playTopStatSong(key: string) {
  const matched = player.recentPlays.find((s) => (s.hash ? s.hash.toLowerCase() : s.id) === key);
  if (matched) {
    ui.accountSheetOpen = false;
    void player.playSong(matched);
  }
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.accountSheetOpen"
      class="fixed inset-0 z-[75] flex flex-col justify-end lg-scrim"
      @click="ui.accountSheetOpen = false"
    >
      <div
        class="lg-sheet-panel rounded-t-[28px] flex flex-col overflow-hidden"
        :style="dragSheet.sheetStyle.value"
        @click.stop
      >
        <!-- Draggable iOS Handle & Sheet Nav Header (freely draggable half <-> full <-> dismiss!) -->
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
          <div class="flex items-center justify-between px-5 pt-1 pb-3 am-hairline-b">
            <span class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">个人主页与设置</span>
            <button
              type="button"
              class="text-[16px] font-semibold am-accent-text bg-transparent border-0 px-1 py-1 am-tap"
              @click="ui.accountSheetOpen = false"
            >
              完成
            </button>
          </div>
        </div>

        <!-- Scrollable Sheet Content (seamless top-pull drag chaining!) -->
        <div
          ref="scrollRef"
          class="flex-1 am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+30px)] space-y-4"
          @touchstart.passive="dragSheet.onBodyTouchStart"
          @touchmove="dragSheet.onBodyTouchMove"
          @touchend.passive="dragSheet.onBodyTouchEnd"
          @touchcancel.passive="dragSheet.onBodyTouchEnd"
        >
          <!-- 1. EchoMusic-Inspired Personal Profile & 4-Tier VIP Overview Card -->
          <section class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
            <div v-if="!accounts.isLoggedIn" class="p-5 text-center">
              <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                <Icon :icon="iconCrown" class="w-7 h-7" />
              </div>
              <div class="text-[17px] font-semibold text-[var(--text-primary)]">登录酷狗概念版账号</div>
              <p class="text-[13px] text-[var(--text-secondary)] mt-1">
                同步歌单、乐龄听歌档案，每日自动领畅听 VIP 解锁无损音质
              </p>
              <button
                type="button"
                class="mt-4 w-full h-11 rounded-[13px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                @click="ui.loginModalOpen = true"
              >
                立即登录
              </button>
            </div>

            <div v-else-if="activeAcc" class="p-4 space-y-4">
              <!-- Top Profile Identity Row -->
              <div class="flex items-center gap-3.5">
                <div class="w-14 h-14 rounded-full overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-sm">
                  <img v-if="activeAcc.avatar" :src="activeAcc.avatar" class="w-full h-full object-cover" alt="" />
                  <div v-else class="w-full h-full flex items-center justify-center text-[18px] font-bold text-[var(--text-secondary)]">
                    {{ activeAcc.nickname.slice(0, 1) }}
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[19px] font-bold text-[var(--text-primary)] truncate">{{ activeAcc.nickname }}</span>
                    <span
                      v-if="activeAcc.isVip || activeAcc.tvipEndTime"
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-[#6366f1] to-[#38bdf8] text-white shrink-0"
                    >
                      VIP
                    </span>
                    <span
                      v-if="shortRegionTag"
                      class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--bg-subtle)] text-[var(--text-secondary)] shrink-0"
                    >
                      {{ shortRegionTag }}
                    </span>
                  </div>
                  <div class="text-[12px] text-[var(--text-secondary)] mt-0.5 flex items-center gap-2">
                    <span class="tabular-nums">UID {{ activeAcc.userid }}</span>
                    <span
                      v-if="vip.claimedToday"
                      class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#34c759]/14 text-[#2fb350]"
                    >
                      今日已签
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  class="px-2.5 h-8 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-secondary)] border-0 flex items-center gap-1 am-tap shrink-0"
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

              <!-- Social & Level Strip (Lv.X / 好友 / 关注 / 粉丝 / 访客) -->
              <div class="grid grid-cols-5 gap-1 py-2.5 rounded-2xl bg-[var(--bg-subtle)]/65 text-center">
                <div>
                  <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                    Lv.{{ activeAcc.pGrade ?? '--' }}
                  </div>
                  <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">等级</div>
                </div>
                <div>
                  <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                    {{ activeAcc.friends ?? '--' }}
                  </div>
                  <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">好友</div>
                </div>
                <div>
                  <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                    {{ activeAcc.follows ?? '--' }}
                  </div>
                  <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">关注</div>
                </div>
                <div>
                  <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                    {{ activeAcc.fans ?? '--' }}
                  </div>
                  <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">粉丝</div>
                </div>
                <div>
                  <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                    {{ activeAcc.visitors ?? '--' }}
                  </div>
                  <div class="text-[10px] text-[var(--text-secondary)] mt-0.5">访客</div>
                </div>
              </div>

              <!-- Profile Details Grid (用户ID / 性别 / 地区 / 乐龄 / 官方累计听歌) -->
              <div class="grid grid-cols-2 gap-x-4 gap-y-2.5 px-1 text-[13px]">
                <div>
                  <div class="text-[11px] text-[var(--text-secondary)]">性别 · 地区</div>
                  <div class="font-semibold text-[var(--text-primary)] mt-0.5 truncate">
                    {{ genderLabel }} · {{ regionLabel }}
                  </div>
                </div>
                <div>
                  <div class="text-[11px] text-[var(--text-secondary)]">乐龄</div>
                  <div class="font-semibold text-[var(--text-primary)] mt-0.5 tabular-nums truncate">
                    {{ musicAgeLabel }}
                  </div>
                </div>
                <div class="col-span-2">
                  <div class="text-[11px] text-[var(--text-secondary)]">账号累计听歌时长</div>
                  <div class="font-semibold text-[var(--text-primary)] mt-0.5 tabular-nums">
                    {{ kugouListenDurationLabel }}
                  </div>
                </div>
              </div>

              <!-- 4-Tier VIP Badges Row -->
              <div class="grid grid-cols-2 gap-2 pt-2.5 am-hairline-t">
                <div
                  v-for="tier in vipTierCards"
                  :key="tier.label"
                  class="rounded-xl px-3 py-2 bg-[var(--bg-subtle)]/55 flex items-center gap-2.5"
                >
                  <div
                    class="w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-black shrink-0"
                    :class="tier.active ? tier.tone : 'from-neutral-400/60 to-neutral-500/60 opacity-50'"
                  >
                    VIP
                  </div>
                  <div class="min-w-0">
                    <div class="text-[12px] font-semibold text-[var(--text-primary)] leading-tight">{{ tier.label }}</div>
                    <div
                      class="text-[11px] truncate mt-0.5 tabular-nums"
                      :class="tier.active ? 'am-accent-text font-medium' : 'text-[var(--text-tertiary)]'"
                    >
                      {{ tier.text }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 2. Minimalist Daily VIP Claim Card (No cluttered 4-step list!) -->
          <section v-if="accounts.isLoggedIn" class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3.5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[12px] font-medium text-[var(--text-secondary)]">每日畅听 VIP 剩余</div>
                <div class="flex items-baseline gap-1.5 mt-0.5">
                  <span class="text-[32px] font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
                    {{ vip.vipRemainingDays ?? '--' }}
                  </span>
                  <span class="text-[14px] font-medium text-[var(--text-secondary)]">天</span>
                </div>
                <div class="text-[12px] text-[var(--text-secondary)] mt-0.5">
                  {{ activeAcc?.tvipEndTime ? `有效期至 ${activeAcc.tvipEndTime}` : '点击一键签到同步最新有效期' }}
                </div>
              </div>
              <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)]">
                <Icon :icon="iconFlame" class="w-4 h-4 am-accent-text" />
                <span>连签 {{ vip.currentStreakDays }} 天</span>
              </div>
            </div>

            <div class="grid gap-2.5" :class="accounts.accounts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
              <button
                type="button"
                class="h-11 rounded-[13px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
                :disabled="vip.isClaiming || vip.isBatchClaiming"
                @click="handleClaimNow"
              >
                <Icon v-if="vip.isClaiming" :icon="iconRefresh" class="w-4 h-4 animate-spin" />
                <span>{{ vip.isClaiming ? '签到中…' : vip.claimedToday ? '今日已领 · 补同步' : '一键领取今日 VIP' }}</span>
              </button>

              <button
                v-if="accounts.accounts.length > 1"
                type="button"
                class="h-11 rounded-[13px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
                :disabled="vip.isClaiming || vip.isBatchClaiming"
                @click="vip.claimAllAccounts(false)"
              >
                <span>{{ vip.isBatchClaiming ? vip.batchProgressText || '轮签中…' : `全号轮签 (${accounts.accounts.length})` }}</span>
              </button>
            </div>

            <!-- Collapsible Monthly Calendar -->
            <div class="pt-2.5 am-hairline-t">
              <button
                type="button"
                class="w-full flex items-center justify-between text-[13px] font-medium text-[var(--text-secondary)] bg-transparent border-0 p-0"
                @click="showCalendar = !showCalendar"
              >
                <span>{{ vip.currentCalendar.monthLabel }} 打卡日历 · 本月 {{ vip.currentCalendar.claimedInMonth }}/{{ vip.currentCalendar.daysInMonth }} 天</span>
                <span class="am-accent-text">{{ showCalendar ? '收起' : '展开' }}</span>
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

          <!-- 3. Local PureTone Listening Statistics Card -->
          <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]">
                <Icon :icon="iconChartBar" class="w-4.5 h-4.5 am-accent-text" />
                <span>纯音听歌统计</span>
              </div>
              <span class="text-[12px] text-[var(--text-secondary)] tabular-nums">共播 {{ stats.totalPlays }} 次</span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="rounded-2xl bg-[var(--bg-subtle)]/60 py-2.5 px-2">
                <div class="text-[16px] font-bold text-[var(--text-primary)] tabular-nums">{{ stats.todayMinutes }} 分</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">今日 · {{ stats.todayPlays }} 首</div>
              </div>
              <div class="rounded-2xl bg-[var(--bg-subtle)]/60 py-2.5 px-2">
                <div class="text-[16px] font-bold text-[var(--text-primary)] tabular-nums truncate">
                  {{ stats.totalDurationLabel }}
                </div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">纯音累计</div>
              </div>
              <div class="rounded-2xl bg-[var(--bg-subtle)]/60 py-2.5 px-2">
                <div class="text-[15px] font-bold text-[var(--text-primary)] truncate">
                  {{ stats.topArtist?.name || '--' }}
                </div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">最爱歌手</div>
              </div>
            </div>

            <div v-if="stats.topSongs.length" class="pt-2 am-hairline-t space-y-1.5">
              <div class="text-[11px] font-semibold text-[var(--text-secondary)]">常听单曲</div>
              <div
                v-for="(item, idx) in stats.topSongs.slice(0, 3)"
                :key="item.key"
                class="flex items-center gap-2.5 py-1 cursor-pointer am-tap"
                @click="playTopStatSong(item.key)"
              >
                <span class="w-4 text-[12px] font-bold tabular-nums am-accent-text text-center">{{ idx + 1 }}</span>
                <div class="w-8 h-8 rounded-[7px] overflow-hidden bg-[var(--bg-subtle)] shrink-0">
                  <img v-if="item.coverUrl" :src="item.coverUrl" class="w-full h-full object-cover" alt="" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-[13px] font-semibold text-[var(--text-primary)] truncate">{{ item.title }}</div>
                  <div class="text-[11px] text-[var(--text-secondary)] truncate">{{ item.artist }}</div>
                </div>
                <span class="text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums shrink-0">
                  {{ item.count }} 次
                </span>
                <Icon :icon="iconPlayerPlayFilled" class="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
              </div>
            </div>
          </section>

          <!-- 4. Minimalist Grouped Settings -->
          <section class="space-y-2.5">
            <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
              播放、音效与外观
            </div>

            <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
              <!-- Audio Quality -->
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
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent text-[var(--text-secondary)]'
                    "
                    @click="echoSystem.haptic('selection'); settings.quality = q.id as AudioQuality"
                  >
                    {{ q.label }}
                  </button>
                </div>
              </div>

              <!-- Native 5-Preset Audio EQ -->
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
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent text-[var(--text-secondary)]'
                    "
                    @click="echoSystem.haptic('selection'); settings.eqPreset = eq.id"
                  >
                    {{ eq.label }}
                  </button>
                </div>
              </div>

              <!-- Theme Appearance -->
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
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent text-[var(--text-secondary)]'
                    "
                    @click="echoSystem.haptic('selection'); settings.appearance = ap.id as AppearanceMode"
                  >
                    {{ ap.label }}
                  </button>
                </div>
              </div>

              <!-- Accent Theme Mode -->
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
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent text-[var(--text-secondary)]'
                    "
                    @click="echoSystem.haptic('selection'); settings.accentMode = ac.id as AccentThemeMode"
                  >
                    {{ ac.label }}
                  </button>
                </div>
              </div>

              <!-- Cover Page 2-Line Lyrics Preview -->
              <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                <div>
                  <div class="text-[15px] text-[var(--text-primary)]">封面页 2 行小歌词预览</div>
                  <div class="text-[11px] text-[var(--text-secondary)]">轻点小歌词即可进入全屏沉浸歌词</div>
                </div>
                <input v-model="settings.showCoverLyricsPreview" type="checkbox" class="ios-switch" />
              </label>

              <!-- Lock Screen & Notification Live Lyrics -->
              <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                <div>
                  <div class="text-[15px] text-[var(--text-primary)]">锁屏与通知实时歌词</div>
                  <div class="text-[11px] text-[var(--text-secondary)]">在通知中心与锁屏实时显示当前歌词</div>
                </div>
                <input v-model="settings.showLockScreenLyrics" type="checkbox" class="ios-switch" />
              </label>

              <!-- Auto Unblock -->
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

              <!-- Vivo Lock Screen & Atomic Island -->
              <div class="px-4 py-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <Icon :icon="iconDeviceMobile" class="w-4 h-4 am-accent-text shrink-0" />
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 text-[15px] text-[var(--text-primary)]">
                      <span>锁屏与原子岛</span>
                      <span
                        class="w-2 h-2 rounded-full"
                        :class="notifGranted ? 'bg-[#34c759]' : 'bg-[#ff9500]'"
                      />
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] leading-snug">
                      {{ notifGranted ? '可在系统「设置 → 通知与状态栏 → 原子岛」确认已勾选纯音' : '需开启通知权限以激活锁屏播控与原子岛' }}
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

              <!-- 300MB Audio Cache -->
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

              <!-- Auto Claim & Daily Reminder -->
              <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                <span class="text-[15px] text-[var(--text-primary)]">打开 App 自动静默签到</span>
                <input v-model="settings.autoClaimOnLaunch" type="checkbox" class="ios-switch" />
              </label>

              <div class="px-4 py-3 flex items-center justify-between gap-2">
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
            </div>
          </section>

          <!-- 5. About PureTone, Author, Open-Source Repo & Check Update Card -->
          <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <PureToneMark :size="42" />
                <div class="min-w-0">
                  <div class="text-[16px] font-bold text-[var(--text-primary)]">纯音 · PureTone</div>
                  <div class="text-[12px] text-[var(--text-secondary)] tabular-nums">
                    v{{ appVersion }} · 作者 {{ APP_AUTHOR }} · GPL-3.0 开源
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

            <button
              type="button"
              class="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-subtle)]/75 text-[13px] font-medium text-[var(--text-primary)] border-0 flex items-center justify-between am-tap"
              @click="openGithubRepo"
            >
              <span class="flex items-center gap-2 truncate">
                <Icon :icon="iconBrandGithub" class="w-4 h-4 shrink-0" />
                <span class="truncate">github.com/xhd2005/puretone</span>
              </span>
              <span class="text-[12px] am-accent-text font-semibold shrink-0 ml-2">开源主页</span>
            </button>

            <p class="text-[11px] text-[var(--text-tertiary)] leading-relaxed m-0 px-0.5">
              极简无广告 · 本地直连。感谢 KuGouMusicApi、Jetpack Media3、Capacitor 与 Vue 开源社区。
            </p>
          </section>
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
