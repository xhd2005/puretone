<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconChartBar from '@iconify/icons-tabler/chart-bar';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconMusic from '@iconify/icons-tabler/music';
import { buildLast7DaysSeries, useStatsStore } from '@/stores/stats';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';

const stats = useStatsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t, effectiveLocale } = useI18n();

const mode = ref<'7d' | '24h'>('7d');
const selectedDayIdx = ref<number>(6);
const selectedHourIdx = ref<number>(-1);

const weekSeries = computed(() => buildLast7DaysSeries(stats.daily, new Date(), effectiveLocale.value));
const hourSeries = computed(() => stats.today24HourSeries);

watch(mode, (next) => {
  echoSystem.haptic('selection');
  if (next === '7d') {
    selectedDayIdx.value = 6;
  } else {
    selectedHourIdx.value = hourSeries.value.peakHour >= 0 ? hourSeries.value.peakHour : new Date().getHours();
  }
});

const activeDay = computed(() => weekSeries.value.days[selectedDayIdx.value] || weekSeries.value.days[6]);
const activeHour = computed(() => {
  const idx = selectedHourIdx.value >= 0 ? selectedHourIdx.value : hourSeries.value.peakHour;
  return idx >= 0 ? hourSeries.value.hours[idx] : null;
});

function formatMinutesPretty(mins: number): string {
  if (mins < 60) return t('stats.durMin', { m: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? t('stats.durHourMin', { h, m }) : t('stats.durHour', { h });
}

const totalDurationLocalized = computed(() => {
  const mins = Math.floor(stats.totalSeconds / 60);
  if (mins < 60) return t('profile.durM', { m: mins });
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) return t('profile.durHM', { h: hours, m: remMin });
  const days = Math.floor(hours / 24);
  const remHr = hours % 24;
  return t('profile.durDH', { d: days, h: remHr });
});

const avgLineBottomPct = computed(() => {
  const s = weekSeries.value;
  if (s.avgMinutes <= 0 || s.maxMinutes <= 0) return 0;
  return Math.min(92, Math.max(8, Math.round((s.avgMinutes / s.maxMinutes) * 100)));
});

function selectDay(idx: number) {
  echoSystem.haptic('selection');
  selectedDayIdx.value = idx;
}

function selectHour(hour: number) {
  echoSystem.haptic('selection');
  selectedHourIdx.value = hour;
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
  <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-4">
    <!-- Top Header + Segmented Toggle (iOS Screen Time Style) -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]">
        <Icon :icon="iconChartBar" class="w-4.5 h-4.5 am-accent-text" />
        <span>{{ t('stats.title') }}</span>
      </div>
      <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)]">
        <button
          type="button"
          class="px-2.5 h-7 rounded-[9px] text-[12px] font-semibold border-0 transition-all"
          :class="
            mode === '7d'
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
              : 'bg-transparent text-[var(--text-secondary)]'
          "
          @click="mode = '7d'"
        >
          {{ t('stats.mode7d') }}
        </button>
        <button
          type="button"
          class="px-2.5 h-7 rounded-[9px] text-[12px] font-semibold border-0 transition-all"
          :class="
            mode === '24h'
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
              : 'bg-transparent text-[var(--text-secondary)]'
          "
          @click="mode = '24h'"
        >
          {{ t('stats.mode24h') }}
        </button>
      </div>
    </div>

    <!-- Primary Metric & Selected Bar Callout -->
    <div class="flex items-end justify-between gap-2">
      <div v-if="mode === '7d'">
        <div class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t('stats.avg7dLabel') }}</div>
        <div class="text-[26px] font-bold tracking-tight text-[var(--text-primary)] tabular-nums leading-tight mt-0.5">
          {{ formatMinutesPretty(weekSeries.avgMinutes) }}
        </div>
      </div>
      <div v-else>
        <div class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t('stats.todayTotalLabel') }}</div>
        <div class="text-[26px] font-bold tracking-tight text-[var(--text-primary)] tabular-nums leading-tight mt-0.5">
          {{ formatMinutesPretty(hourSeries.totalMinutes) }}
        </div>
      </div>

      <!-- Tap-selected bar pill -->
      <div
        v-if="mode === '7d' && activeDay"
        class="px-2.5 py-1.5 rounded-xl bg-[var(--bg-subtle)]/75 text-right"
      >
        <div class="text-[10px] text-[var(--text-secondary)] font-medium">{{ activeDay.fullLabel }}</div>
        <div class="text-[12px] font-bold am-accent-text tabular-nums">
          {{ activeDay.minutes }}{{ t('stats.minShort') }} · {{ activeDay.plays }}{{ t('stats.songUnit') }}
        </div>
      </div>
      <div
        v-else-if="mode === '24h' && activeHour"
        class="px-2.5 py-1.5 rounded-xl bg-[var(--bg-subtle)]/75 text-right"
      >
        <div class="text-[10px] text-[var(--text-secondary)] font-medium">
          {{ activeHour.label }} – {{ String((activeHour.hour + 1) % 24).padStart(2, '0') }}:00
        </div>
        <div class="text-[12px] font-bold am-accent-text tabular-nums">
          {{ activeHour.minutes }}{{ t('stats.minShort') }} · {{ activeHour.plays }}{{ t('stats.songUnit') }}
        </div>
      </div>
    </div>

    <!-- MODE 1: 7-Day Vertical Bar Chart with Dashed Daily Average Reference Line -->
    <div v-if="mode === '7d'" class="pt-2">
      <div class="relative h-[132px] pr-11">
        <!-- Dashed Y-axis gridlines -->
        <div class="absolute inset-x-0 top-0 border-t border-dashed border-[var(--hairline)] flex justify-end">
          <span class="text-[10px] text-[var(--text-tertiary)] tabular-nums -mt-2 pl-1 whitespace-nowrap">{{ weekSeries.maxMinutes }}{{ t('stats.minShort') }}</span>
        </div>
        <div class="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--hairline)] flex justify-end">
          <span class="text-[10px] text-[var(--text-tertiary)] tabular-nums -mt-2 pl-1 whitespace-nowrap">{{ Math.round(weekSeries.maxMinutes / 2) }}{{ t('stats.minShort') }}</span>
        </div>
        <div class="absolute inset-x-0 bottom-0 border-t border-[var(--hairline)]" />

        <!-- iOS Screen Time Dashed Average Line -->
        <div
          v-if="weekSeries.avgMinutes > 0"
          class="absolute inset-x-0 z-10 pointer-events-none flex justify-end items-center"
          :style="{ bottom: `${avgLineBottomPct}%` }"
        >
          <div class="flex-1 border-t border-dashed border-[#34c759]/80" />
          <span class="text-[10px] font-semibold text-[#2fb350] pl-1 shrink-0 whitespace-nowrap">{{ t('stats.avgLine') }}</span>
        </div>

        <!-- 7 Interactive Bars -->
        <div class="relative z-20 h-full grid grid-cols-7 gap-2 items-end pt-1">
          <button
            v-for="(day, idx) in weekSeries.days"
            :key="day.dateKey"
            type="button"
            class="h-full flex flex-col justify-end items-center bg-transparent border-0 p-0 cursor-pointer group"
            :aria-label="`${day.fullLabel} ${day.minutes}${t('stats.minShort')}`"
            @click="selectDay(idx)"
          >
            <div class="w-full max-w-[26px] h-full flex items-end justify-center">
              <div
                class="w-full rounded-t-[8px] rounded-b-[4px] transition-all duration-300"
                :class="
                  selectedDayIdx === idx
                    ? 'bar-active shadow-sm'
                    : day.isToday
                      ? 'bar-today'
                      : 'bar-muted'
                "
                :style="{
                  height: day.minutes > 0 ? `${Math.max(8, Math.round((day.minutes / weekSeries.maxMinutes) * 100))}%` : '4px',
                }"
              />
            </div>
          </button>
        </div>
      </div>

      <!-- X-Axis Weekday Labels -->
      <div class="grid grid-cols-7 gap-2 pr-11 mt-1.5 text-center">
        <button
          v-for="(day, idx) in weekSeries.days"
          :key="day.dateKey"
          type="button"
          class="text-[10.5px] bg-transparent border-0 p-0 tabular-nums truncate"
          :class="selectedDayIdx === idx ? 'am-accent-text font-bold' : 'text-[var(--text-secondary)] font-medium'"
          @click="selectDay(idx)"
        >
          {{ day.shortLabel }}
        </button>
      </div>
    </div>

    <!-- MODE 2: Today 24-Hour Activity Bar Chart -->
    <div v-else class="pt-2">
      <div class="relative h-[132px] pr-11">
        <div class="absolute inset-x-0 top-0 border-t border-dashed border-[var(--hairline)] flex justify-end">
          <span class="text-[10px] text-[var(--text-tertiary)] tabular-nums -mt-2 pl-1 whitespace-nowrap">{{ hourSeries.maxMinutes }}{{ t('stats.minShort') }}</span>
        </div>
        <div class="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--hairline)] flex justify-end">
          <span class="text-[10px] text-[var(--text-tertiary)] tabular-nums -mt-2 pl-1 whitespace-nowrap">{{ Math.round(hourSeries.maxMinutes / 2) }}{{ t('stats.minShort') }}</span>
        </div>
        <div class="absolute inset-x-0 bottom-0 border-t border-[var(--hairline)]" />

        <div class="relative z-20 h-full grid grid-cols-24 gap-[3px] items-end pt-1">
          <button
            v-for="item in hourSeries.hours"
            :key="item.hour"
            type="button"
            class="h-full flex items-end justify-center bg-transparent border-0 p-0 cursor-pointer"
            :aria-label="`${item.label} ${item.minutes}${t('stats.minShort')}`"
            @click="selectHour(item.hour)"
          >
            <div
              class="w-full rounded-t-[4px] rounded-b-[2px] transition-all duration-200"
              :class="selectedHourIdx === item.hour ? 'bar-active' : item.minutes > 0 ? 'bar-today' : 'bar-empty'"
              :style="{
                height: item.minutes > 0 ? `${Math.max(8, Math.round((item.minutes / hourSeries.maxMinutes) * 100))}%` : '3px',
              }"
            />
          </button>
        </div>
      </div>

      <!-- 24h Time Axis Ticks -->
      <div class="flex items-center justify-between pr-11 mt-1.5 text-[10px] text-[var(--text-tertiary)] tabular-nums">
        <span>0{{ t('stats.hourShort') }}</span>
        <span>6{{ t('stats.hourShort') }}</span>
        <span>12{{ t('stats.hourShort') }}</span>
        <span>18{{ t('stats.hourShort') }}</span>
        <span>23{{ t('stats.hourShort') }}</span>
      </div>
    </div>

    <!-- Compact Summary Strip -->
    <div class="grid grid-cols-3 gap-2 pt-1 text-center">
      <div class="rounded-2xl bg-[var(--bg-subtle)]/55 py-2.5 px-1.5 min-w-0">
        <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums truncate">{{ stats.todayPlays }} {{ t('stats.songUnit') }}</div>
        <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5 truncate">{{ t('stats.todayPlays') }}</div>
      </div>
      <div class="rounded-2xl bg-[var(--bg-subtle)]/55 py-2.5 px-1.5 min-w-0">
        <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums truncate">
          {{ totalDurationLocalized }}
        </div>
        <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5 truncate">{{ t('stats.totalPlaysSub', { count: stats.totalPlays }) }}</div>
      </div>
      <div class="rounded-2xl bg-[var(--bg-subtle)]/55 py-2.5 px-1.5 min-w-0">
        <div class="text-[14px] font-bold text-[var(--text-primary)] truncate">
          {{ stats.topArtist?.name || '--' }}
        </div>
        <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5 truncate">{{ t('stats.topArtist') }}</div>
      </div>
    </div>

    <!-- Top Played Songs -->
    <div v-if="stats.topSongs.length" class="pt-3 am-hairline-t space-y-1.5">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[12px] font-semibold text-[var(--text-secondary)]">{{ t('stats.topSongs', { count: Math.min(5, stats.topSongs.length) }) }}</span>
        <span class="text-[11px] text-[var(--text-tertiary)]">{{ t('stats.tapToPlay') }}</span>
      </div>
      <div
        v-for="(item, idx) in stats.topSongs.slice(0, 5)"
        :key="item.key"
        class="flex items-center gap-2.5 py-1.5 cursor-pointer am-tap"
        @click="playTopStatSong(item.key)"
      >
        <span class="w-4 text-[12px] font-bold tabular-nums am-accent-text text-center">{{ idx + 1 }}</span>
        <div class="w-9 h-9 rounded-[8px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 flex items-center justify-center">
          <img v-if="item.coverUrl" :src="item.coverUrl" class="w-full h-full object-cover" alt="" />
          <Icon v-else :icon="iconMusic" class="w-4 h-4 text-[var(--text-tertiary)]" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-[var(--text-primary)] truncate">{{ item.title }}</div>
          <div class="text-[11px] text-[var(--text-secondary)] truncate">{{ item.artist }}</div>
        </div>
        <span class="text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums shrink-0">
          {{ t('stats.playCount', { count: item.count }) }}
        </span>
        <Icon :icon="iconPlayerPlayFilled" class="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid-cols-24 {
  grid-template-columns: repeat(24, minmax(0, 1fr));
}

.bar-active {
  background: var(--accent);
  background: linear-gradient(180deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 72%, #ff9500) 100%);
}

.bar-today {
  background: rgba(52, 86, 190, 0.55);
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}

.bar-muted {
  background: rgba(52, 86, 190, 0.30);
  background: color-mix(in srgb, var(--accent) 34%, var(--bg-subtle));
}

.bar-empty {
  background: var(--bg-subtle);
}
</style>
