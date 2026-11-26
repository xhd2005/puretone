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
import type { AudioQuality } from '@/types/music';
import type { VipStepKey } from '@/services/vip/vipClaimEngine';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { useSettingsStore, type AppearanceMode } from '@/stores/settings';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { echoSystem } from '@/native/echoSystem';
import { echoPlayer } from '@/native/echoPlayer';
import PureToneMark from './PureToneMark.vue';

const accounts = useAccountsStore();
const vip = useVipStore();
const settings = useSettingsStore();
const player = usePlayerStore();
const ui = useUiStore();

const showAllLogs = ref(false);
const notifGranted = ref(true);
const cacheUsedMb = ref('0.0');
const clearingCache = ref(false);

async function refreshDeviceStats() {
  const [perm, cache] = await Promise.all([
    echoSystem.checkNotificationPermission(),
    echoPlayer.getAudioCacheStats(),
  ]);
  notifGranted.value = perm.granted;
  cacheUsedMb.value = (cache.usedBytes / (1024 * 1024)).toFixed(1);
}

watch(
  () => ui.accountSheetOpen,
  (open) => {
    if (open) {
      echoSystem.haptic('light');
      void refreshDeviceStats();
    }
  },
);

const stepMeta: Array<{ key: VipStepKey; label: string }> = [
  { key: 'baseVip', label: '基础畅听 VIP' },
  { key: 'upgrade', label: '特权升级' },
  { key: 'conceptAd', label: '概念版广告打卡' },
  { key: 'conceptListen', label: '听歌打卡上报' },
];

const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];

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

function stepBadgeText(status: string): string {
  if (status === 'running') return '进行中';
  if (status === 'success') return '已完成';
  if (status === 'already') return '今日已领';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '已跳过';
  return '待执行';
}
</script>

<template>
  <!-- Decoupled Airy Scrim (opacity only) + Independent Liquid Glass Sheet Slide-Up -->
  <Transition name="lg-modal">
    <div
      v-if="ui.accountSheetOpen"
      class="fixed inset-0 z-[75] flex flex-col justify-end lg-scrim"
      @click="ui.accountSheetOpen = false"
    >
      <div
        class="lg-sheet-panel rounded-t-[28px] h-[90vh] flex flex-col overflow-hidden"
        @click.stop
      >
        <div class="w-10 h-1 rounded-full bg-[var(--text-tertiary)]/50 mx-auto mt-2.5 shrink-0" />

        <!-- iOS Sheet Nav Header -->
        <div class="flex items-center justify-between px-5 pt-2.5 pb-3 am-hairline-b shrink-0">
          <span class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">账号与每日 VIP</span>
          <button
            type="button"
            class="text-[16px] font-semibold am-accent-text bg-transparent border-0 px-1 py-1 am-tap"
            @click="ui.accountSheetOpen = false"
          >
            完成
          </button>
        </div>

        <!-- Scrollable Sheet Content -->
        <div class="flex-1 am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+28px)] space-y-5">
          <!-- 1. Multi-Account Switcher Card -->
          <section class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
            <div v-if="!accounts.isLoggedIn" class="p-5 text-center">
              <div class="w-14 h-14 rounded-full bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text mb-3">
                <Icon :icon="iconCrown" class="w-7 h-7" />
              </div>
              <div class="text-[17px] font-semibold text-[var(--text-primary)]">登录酷狗概念版账号</div>
              <p class="text-[13px] text-[var(--text-secondary)] mt-1">
                登录后即可同步歌单、每日自动领畅听 VIP 并解锁无损音质
              </p>
              <button
                type="button"
                class="mt-4 w-full h-11 rounded-[13px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
                @click="ui.loginModalOpen = true"
              >
                立即登录
              </button>
            </div>

            <div v-else class="divide-y divide-[var(--hairline)]">
              <div
                v-for="acc in accounts.accounts"
                :key="acc.userid"
                class="flex items-center gap-3 px-4 py-3 cursor-pointer"
                @click="echoSystem.haptic('selection'); accounts.switchAccount(acc.userid)"
              >
                <div class="relative w-11 h-11 rounded-full overflow-hidden bg-[var(--bg-subtle)] shrink-0">
                  <img v-if="acc.avatar" :src="acc.avatar" class="w-full h-full object-cover" alt="" />
                  <div v-else class="w-full h-full flex items-center justify-center text-[15px] font-bold text-[var(--text-secondary)]">
                    {{ acc.nickname.slice(0, 1) }}
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-[16px] font-semibold truncate text-[var(--text-primary)]">{{ acc.nickname }}</span>
                    <span
                      v-if="vip.isAccountClaimedToday(acc.userid)"
                      class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#34c759]/15 text-[#30b955] shrink-0"
                    >
                      今日已签
                    </span>
                  </div>
                  <div class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                    {{ acc.tvipEndTime ? `VIP 至 ${acc.tvipEndTime.slice(0, 10)}` : `UID ${acc.userid}` }}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <Icon
                    v-if="acc.userid === accounts.activeAccount?.userid"
                    :icon="iconCheck"
                    class="w-5 h-5 am-accent-text"
                  />
                  <button
                    v-if="accounts.accounts.length > 1 || acc.userid === accounts.activeAccount?.userid"
                    type="button"
                    class="w-8 h-8 rounded-full bg-transparent border-0 flex items-center justify-center text-[var(--text-tertiary)] am-tap"
                    aria-label="移除账号"
                    @click.stop="accounts.removeAccount(acc.userid)"
                  >
                    <Icon :icon="iconTrash" class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                class="w-full h-11 px-4 flex items-center gap-2 bg-transparent border-0 text-[15px] font-medium am-accent-text am-tap"
                @click="ui.loginModalOpen = true"
              >
                <Icon :icon="iconPlus" class="w-4 h-4" />
                <span>添加酷狗账号（支持多号轮签）</span>
              </button>
            </div>
          </section>

          <!-- 2. Daily VIP Claim Card -->
          <section v-if="accounts.isLoggedIn" class="space-y-3">
            <div class="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
              每日畅听 VIP 签到
            </div>

            <div class="rounded-[20px] bg-[var(--bg-card)] p-4 shadow-xs">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[12px] font-medium text-[var(--text-secondary)]">当前畅听 VIP 剩余</div>
                  <div class="flex items-baseline gap-1.5 mt-0.5">
                    <span class="text-[34px] font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
                      {{ vip.vipRemainingDays ?? '--' }}
                    </span>
                    <span class="text-[15px] font-medium text-[var(--text-secondary)]">天</span>
                  </div>
                  <div class="text-[12px] text-[var(--text-secondary)] mt-0.5">
                    {{ accounts.activeAccount?.tvipEndTime || '点击下方签到同步最新到期时间' }}
                  </div>
                </div>
                <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)]">
                  <Icon :icon="iconFlame" class="w-4 h-4 am-accent-text" />
                  <span>连签 {{ vip.currentStreakDays }} 天</span>
                </div>
              </div>

              <div class="grid gap-2.5 mt-4" :class="accounts.accounts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
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

              <!-- 4-Step Visual Progress -->
              <div class="mt-4 pt-3.5 am-hairline-t space-y-2.5">
                <div
                  v-for="item in stepMeta"
                  :key="item.key"
                  class="flex items-center justify-between gap-2 text-[14px]"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="{
                          'bg-[#34c759]': vip.currentSteps[item.key] === 'success' || vip.currentSteps[item.key] === 'already',
                          'bg-[#ff3b30]': vip.currentSteps[item.key] === 'failed',
                          'am-accent-bg animate-pulse': vip.currentSteps[item.key] === 'running',
                          'bg-[var(--text-tertiary)]': vip.currentSteps[item.key] === 'idle' || vip.currentSteps[item.key] === 'skipped',
                        }"
                      />
                      <span class="font-medium text-[var(--text-primary)]">{{ item.label }}</span>
                    </div>
                    <p
                      v-if="vip.currentDetails[item.key]"
                      class="text-[12px] text-[var(--text-secondary)] pl-4 mt-0.5 truncate"
                    >
                      {{ vip.currentDetails[item.key] }}
                    </p>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      class="text-[12px] font-medium"
                      :class="
                        vip.currentSteps[item.key] === 'failed'
                          ? 'text-[#ff3b30]'
                          : vip.currentSteps[item.key] === 'success' || vip.currentSteps[item.key] === 'already'
                            ? 'text-[#30b955]'
                            : 'text-[var(--text-secondary)]'
                      "
                    >
                      {{ stepBadgeText(vip.currentSteps[item.key]) }}
                    </span>
                    <button
                      v-if="vip.currentSteps[item.key] === 'failed'"
                      type="button"
                      class="px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[11px] font-semibold am-accent-text border-0 am-tap"
                      @click="vip.retrySingleStep(item.key, player.currentSong?.mixSongId)"
                    >
                      重试
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Monthly Calendar Grid -->
            <div class="rounded-[20px] bg-[var(--bg-card)] p-4 shadow-xs">
              <div class="flex items-center justify-between mb-3">
                <span class="text-[15px] font-semibold text-[var(--text-primary)]">{{ vip.currentCalendar.monthLabel }} 打卡日历</span>
                <span class="text-[12px] font-medium text-[var(--text-secondary)] tabular-nums">
                  本月已领 {{ vip.currentCalendar.claimedInMonth }}/{{ vip.currentCalendar.daysInMonth }} 天
                </span>
              </div>

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

              <div v-if="vip.currentLogs.length" class="mt-3 pt-2.5 am-hairline-t">
                <button
                  type="button"
                  class="w-full flex items-center justify-between text-[13px] font-medium text-[var(--text-secondary)] bg-transparent border-0 p-0"
                  @click="showAllLogs = !showAllLogs"
                >
                  <span>最近打卡记录 ({{ vip.currentLogs.length }})</span>
                  <span class="am-accent-text">{{ showAllLogs ? '收起' : '展开' }}</span>
                </button>
                <div v-if="showAllLogs" class="mt-2 space-y-1.5 max-h-40 am-scroll">
                  <div
                    v-for="log in vip.currentLogs.slice(0, 12)"
                    :key="log.id"
                    class="flex items-center justify-between text-[12px] py-1"
                  >
                    <span class="tabular-nums text-[var(--text-secondary)]">{{ log.claimDate }}</span>
                    <span
                      class="truncate max-w-[65%] text-right"
                      :class="log.status === 'success' ? 'text-[var(--text-primary)]' : 'text-[#ff3b30]'"
                    >
                      {{ log.message }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 3. Minimalist Grouped Settings -->
          <section class="space-y-3">
            <div class="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
              播放与偏好设置
            </div>

            <div class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
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

              <!-- Auto Unblock (4-Channel Zero Config) -->
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

              <!-- Vivo Lock Screen & Atomic Island Status -->
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
                    <div class="text-[11px] text-[var(--text-secondary)] truncate">
                      {{ notifGranted ? '通知通道已就绪 · 可按需配置后台保活' : '需开启通知权限以激活锁屏播控与原子岛' }}
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
                    {{ notifGranted ? '通知设置' : '一键开启' }}
                  </button>
                  <button
                    v-if="notifGranted"
                    type="button"
                    class="px-2.5 h-7 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[12px] font-medium border-0 am-tap"
                    @click="handleOpenAppBatterySettings"
                  >
                    后台保活
                  </button>
                </div>
              </div>

              <!-- 300MB Smart Audio Cache -->
              <div class="px-4 py-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <Icon :icon="iconDatabase" class="w-4 h-4 am-accent-text shrink-0" />
                  <div>
                    <div class="text-[15px] text-[var(--text-primary)]">本地音频智能缓存</div>
                    <div class="text-[11px] text-[var(--text-secondary)] tabular-nums">
                      已缓存 {{ cacheUsedMb }} MB / 300 MB · 重复听零等待
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

              <!-- Auto Claim on Launch -->
              <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                <span class="text-[15px] text-[var(--text-primary)]">打开 App 自动静默签到</span>
                <input v-model="settings.autoClaimOnLaunch" type="checkbox" class="ios-switch" />
              </label>

              <!-- Concept Tasks -->
              <label class="px-4 py-3 flex items-center justify-between cursor-pointer">
                <span class="text-[15px] text-[var(--text-primary)]">启用概念版附加打卡任务</span>
                <input v-model="settings.enableConceptTasks" type="checkbox" class="ios-switch" />
              </label>

              <!-- Daily Local Reminder -->
              <div class="px-4 py-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <Icon :icon="iconBell" class="w-4 h-4 am-accent-text" />
                  <div>
                    <div class="text-[15px] text-[var(--text-primary)]">每日签到通知提醒</div>
                    <div class="text-[11px] text-[var(--text-secondary)]">到点推送提醒，点击即自动签</div>
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

            <div class="text-center text-[12px] text-[var(--text-tertiary)] pt-2 flex items-center justify-center gap-2">
              <PureToneMark :size="18" />
              <span>PureTone（纯音）v2.0.0 · 极简无广告 · 本地直连</span>
            </div>
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
