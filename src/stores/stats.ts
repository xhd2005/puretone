import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import { formatLocalDate } from '@/utils/date';

const STATS_KEY_V1 = 'stats.listening.v1';
const STATS_KEY_V2 = 'stats.listening.v2';

export interface SongPlayStat {
  key: string;
  title: string;
  artist: string;
  coverUrl: string;
  count: number;
  lastPlayedAt: number;
}

export interface StatBucket {
  seconds: number;
  plays: number;
}

export interface PersistedListeningStatsV2 {
  version: 2;
  todayDate: string;
  todaySeconds: number;
  todayPlays: number;
  totalSeconds: number;
  totalPlays: number;
  daily: Record<string, StatBucket>;
  hourlyDate: string;
  hourly: StatBucket[];
  songs: Record<string, SongPlayStat>;
  artists: Record<string, number>;
}

export interface DayChartPoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  minutes: number;
  seconds: number;
  plays: number;
  isToday: boolean;
}

export interface Last7DaysSeries {
  days: DayChartPoint[];
  totalMinutes: number;
  totalPlays: number;
  avgMinutes: number;
  maxMinutes: number;
}

export interface HourChartPoint {
  hour: number;
  label: string;
  minutes: number;
  seconds: number;
  plays: number;
}

export interface Today24HourSeries {
  hours: HourChartPoint[];
  totalMinutes: number;
  totalPlays: number;
  maxMinutes: number;
  peakHour: number;
}

const WEEKDAY_LABELS: Record<'zh-CN' | 'zh-TW' | 'en', string[]> = {
  'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  'zh-TW': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createEmptyHourlyBuckets(): StatBucket[] {
  return Array.from({ length: 24 }, () => ({ seconds: 0, plays: 0 }));
}

function normalizeHourly(raw: unknown): StatBucket[] {
  const out = createEmptyHourlyBuckets();
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < 24; i += 1) {
    const item = raw[i] as Partial<StatBucket> | undefined;
    if (item && typeof item === 'object') {
      out[i] = {
        seconds: Math.max(0, Number(item.seconds) || 0),
        plays: Math.max(0, Number(item.plays) || 0),
      };
    }
  }
  return out;
}

function pruneDailyBuckets(daily: Record<string, StatBucket>, maxDays = 35): Record<string, StatBucket> {
  const keys = Object.keys(daily).sort();
  if (keys.length <= maxDays) return daily;
  const kept: Record<string, StatBucket> = {};
  for (const k of keys.slice(-maxDays)) {
    kept[k] = daily[k];
  }
  return kept;
}

/**
 * Pure builder for the iOS Screen Time style 7-day bar chart.
 * Always produces 7 consecutive calendar days ending at `referenceDate`.
 */
export function buildLast7DaysSeries(
  daily: Record<string, StatBucket>,
  referenceDate: Date = new Date(),
  locale: 'zh-CN' | 'zh-TW' | 'en' = 'zh-CN',
): Last7DaysSeries {
  const days: DayChartPoint[] = [];
  const base = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const weekdays = WEEKDAY_LABELS[locale] || WEEKDAY_LABELS['zh-CN'];
  const todayWord = locale === 'en' ? 'Today' : '今日';
  let totalSec = 0;
  let totalPlays = 0;
  let maxMin = 0;

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(base);
    d.setDate(base.getDate() - offset);
    const dateKey = formatLocalDate(d);
    const bucket = daily[dateKey] || { seconds: 0, plays: 0 };
    const seconds = Math.max(0, Number(bucket.seconds) || 0);
    const plays = Math.max(0, Number(bucket.plays) || 0);
    const minutes = Math.round(seconds / 60);
    totalSec += seconds;
    totalPlays += plays;
    if (minutes > maxMin) maxMin = minutes;

    const fullLabel =
      locale === 'en'
        ? `${MONTH_SHORT_EN[d.getMonth()]} ${d.getDate()} · ${weekdays[d.getDay()]}`
        : `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;

    days.push({
      dateKey,
      shortLabel: offset === 0 ? todayWord : weekdays[d.getDay()],
      fullLabel,
      minutes,
      seconds,
      plays,
      isToday: offset === 0,
    });
  }

  const totalMinutes = Math.round(totalSec / 60);
  const avgMinutes = Math.round(totalSec / 60 / 7);
  return {
    days,
    totalMinutes,
    totalPlays,
    avgMinutes,
    maxMinutes: Math.max(maxMin, avgMinutes, 10),
  };
}

/**
 * Pure builder for the iOS Screen Time style 24-hour activity chart.
 */
export function build24HourSeries(hourly: StatBucket[]): Today24HourSeries {
  const normalized = normalizeHourly(hourly);
  let totalSec = 0;
  let totalPlays = 0;
  let maxMin = 0;
  let peakHour = -1;
  let peakSec = 0;

  const hours: HourChartPoint[] = normalized.map((bucket, h) => {
    const minutes = Math.round(bucket.seconds / 60);
    totalSec += bucket.seconds;
    totalPlays += bucket.plays;
    if (minutes > maxMin) maxMin = minutes;
    if (bucket.seconds > peakSec) {
      peakSec = bucket.seconds;
      peakHour = h;
    }
    return {
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      minutes,
      seconds: bucket.seconds,
      plays: bucket.plays,
    };
  });

  return {
    hours,
    totalMinutes: Math.round(totalSec / 60),
    totalPlays,
    maxMinutes: Math.max(maxMin, 10),
    peakHour,
  };
}

export const useStatsStore = defineStore('stats', () => {
  const todayDate = ref(formatLocalDate());
  const todaySeconds = ref(0);
  const todayPlays = ref(0);
  const totalSeconds = ref(0);
  const totalPlays = ref(0);
  const daily = ref<Record<string, StatBucket>>({});
  const hourlyDate = ref(formatLocalDate());
  const hourly = ref<StatBucket[]>(createEmptyHourlyBuckets());
  const songs = ref<Record<string, SongPlayStat>>({});
  const artists = ref<Record<string, number>>({});

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureTodayFresh() {
    const today = formatLocalDate();
    if (todayDate.value !== today) {
      todayDate.value = today;
      todaySeconds.value = daily.value[today]?.seconds ?? 0;
      todayPlays.value = daily.value[today]?.plays ?? 0;
    }
    if (hourlyDate.value !== today) {
      hourlyDate.value = today;
      hourly.value = createEmptyHourlyBuckets();
    }
  }

  function exportSnapshot(): PersistedListeningStatsV2 {
    const trimmedSongs: Record<string, SongPlayStat> = {};
    Object.values(songs.value)
      .sort((a, b) => b.count - a.count || b.lastPlayedAt - a.lastPlayedAt)
      .slice(0, 120)
      .forEach((s) => {
        trimmedSongs[s.key] = s;
      });

    return {
      version: 2,
      todayDate: todayDate.value,
      todaySeconds: todaySeconds.value,
      todayPlays: todayPlays.value,
      totalSeconds: totalSeconds.value,
      totalPlays: totalPlays.value,
      daily: pruneDailyBuckets({ ...daily.value }, 35),
      hourlyDate: hourlyDate.value,
      hourly: normalizeHourly(hourly.value),
      songs: trimmedSongs,
      artists: { ...artists.value },
    };
  }

  function schedulePersist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void echoSystem.kvSetJson(STATS_KEY_V2, exportSnapshot());
    }, 1400);
  }

  async function importSnapshot(raw: Partial<PersistedListeningStatsV2>) {
    const today = formatLocalDate();
    const rawDaily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
    const cleanDaily: Record<string, StatBucket> = {};
    for (const [k, v] of Object.entries(rawDaily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
      cleanDaily[k] = {
        seconds: Math.max(0, Number(v.seconds) || 0),
        plays: Math.max(0, Number(v.plays) || 0),
      };
    }

    if (raw.todayDate === today && !cleanDaily[today] && ((raw.todaySeconds ?? 0) > 0 || (raw.todayPlays ?? 0) > 0)) {
      cleanDaily[today] = {
        seconds: Math.max(0, Number(raw.todaySeconds) || 0),
        plays: Math.max(0, Number(raw.todayPlays) || 0),
      };
    }

    daily.value = pruneDailyBuckets(cleanDaily, 35);
    todayDate.value = today;
    todaySeconds.value = daily.value[today]?.seconds ?? 0;
    todayPlays.value = daily.value[today]?.plays ?? 0;
    hourlyDate.value = today;
    hourly.value = raw.hourlyDate === today ? normalizeHourly(raw.hourly) : createEmptyHourlyBuckets();
    totalSeconds.value = Math.max(todaySeconds.value, Number(raw.totalSeconds) || 0);
    totalPlays.value = Math.max(todayPlays.value, Number(raw.totalPlays) || 0);
    songs.value = raw.songs && typeof raw.songs === 'object' ? { ...raw.songs } : {};
    artists.value = raw.artists && typeof raw.artists === 'object' ? { ...raw.artists } : {};
    await echoSystem.kvSetJson(STATS_KEY_V2, exportSnapshot());
  }

  async function hydrate() {
    const savedV2 = await echoSystem.kvGetJson<Partial<PersistedListeningStatsV2> | null>(STATS_KEY_V2, null);
    if (savedV2 && typeof savedV2 === 'object') {
      await importSnapshot(savedV2);
      return;
    }
    // Smoothly migrate v1 listening stats into v2 daily buckets
    const savedV1 = await echoSystem.kvGetJson<Partial<PersistedListeningStatsV2> | null>(STATS_KEY_V1, null);
    if (savedV1 && typeof savedV1 === 'object') {
      const migratedDaily: Record<string, StatBucket> = {};
      if (savedV1.todayDate && ((savedV1.todaySeconds ?? 0) > 0 || (savedV1.todayPlays ?? 0) > 0)) {
        migratedDaily[savedV1.todayDate] = {
          seconds: Number(savedV1.todaySeconds || 0),
          plays: Number(savedV1.todayPlays || 0),
        };
      }
      await importSnapshot({ ...savedV1, daily: migratedDaily });
    }
  }

  function recordSongPlay(song: Song) {
    ensureTodayFresh();
    const today = todayDate.value;
    const h = new Date().getHours();

    todayPlays.value += 1;
    totalPlays.value += 1;

    const prevDay = daily.value[today] || { seconds: 0, plays: 0 };
    daily.value = {
      ...daily.value,
      [today]: { seconds: prevDay.seconds, plays: prevDay.plays + 1 },
    };

    const nextHours = hourly.value.slice();
    nextHours[h] = { seconds: nextHours[h].seconds, plays: nextHours[h].plays + 1 };
    hourly.value = nextHours;

    const key = song.hash ? song.hash.toLowerCase() : song.id;
    const prev = songs.value[key];
    songs.value[key] = {
      key,
      title: song.title,
      artist: song.artist,
      coverUrl: song.coverUrl || prev?.coverUrl || '',
      count: (prev?.count || 0) + 1,
      lastPlayedAt: Date.now(),
    };

    const primaryArtist = song.artist.split(/[/、&,，]/)[0]?.trim();
    if (primaryArtist && primaryArtist !== '未知歌手') {
      artists.value[primaryArtist] = (artists.value[primaryArtist] || 0) + 1;
    }
    schedulePersist();
  }

  function addListeningDeltaSec(deltaSec: number) {
    if (!Number.isFinite(deltaSec) || deltaSec <= 0 || deltaSec > 15) return;
    ensureTodayFresh();
    const today = todayDate.value;
    const h = new Date().getHours();

    todaySeconds.value += deltaSec;
    totalSeconds.value += deltaSec;

    const prevDay = daily.value[today] || { seconds: 0, plays: 0 };
    daily.value = {
      ...daily.value,
      [today]: { seconds: prevDay.seconds + deltaSec, plays: prevDay.plays },
    };

    const nextHours = hourly.value.slice();
    nextHours[h] = { seconds: nextHours[h].seconds + deltaSec, plays: nextHours[h].plays };
    hourly.value = nextHours;

    schedulePersist();
  }

  const todayMinutes = computed(() => Math.round(todaySeconds.value / 60));

  const last7DaysSeries = computed(() => buildLast7DaysSeries(daily.value));
  const today24HourSeries = computed(() => build24HourSeries(hourly.value));

  const totalDurationLabel = computed(() => {
    const mins = Math.floor(totalSeconds.value / 60);
    if (mins < 60) return `${mins} 分钟`;
    const hours = Math.floor(mins / 60);
    const remMin = mins % 60;
    if (hours < 24) return remMin > 0 ? `${hours} 小时 ${remMin} 分` : `${hours} 小时`;
    const days = Math.floor(hours / 24);
    const remHr = hours % 24;
    return `${days} 天 ${remHr} 小时`;
  });

  const topSongs = computed<SongPlayStat[]>(() =>
    Object.values(songs.value)
      .sort((a, b) => b.count - a.count || b.lastPlayedAt - a.lastPlayedAt)
      .slice(0, 5),
  );

  const topArtist = computed<{ name: string; count: number } | null>(() => {
    let bestName = '';
    let bestCount = 0;
    for (const [name, count] of Object.entries(artists.value)) {
      if (count > bestCount) {
        bestName = name;
        bestCount = count;
      }
    }
    return bestName ? { name: bestName, count: bestCount } : null;
  });

  return {
    todaySeconds,
    todayPlays,
    todayMinutes,
    totalSeconds,
    totalPlays,
    totalDurationLabel,
    daily,
    hourly,
    last7DaysSeries,
    today24HourSeries,
    topSongs,
    topArtist,
    hydrate,
    recordSongPlay,
    addListeningDeltaSec,
    exportSnapshot,
    importSnapshot,
  };
});
