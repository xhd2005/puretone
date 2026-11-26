import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import { formatLocalDate } from '@/services/vip/vipClaimEngine';

const STATS_KEY = 'stats.listening.v1';

export interface SongPlayStat {
  key: string;
  title: string;
  artist: string;
  coverUrl: string;
  count: number;
  lastPlayedAt: number;
}

interface PersistedListeningStats {
  todayDate: string;
  todaySeconds: number;
  todayPlays: number;
  totalSeconds: number;
  totalPlays: number;
  songs: Record<string, SongPlayStat>;
  artists: Record<string, number>;
}

export const useStatsStore = defineStore('stats', () => {
  const todayDate = ref(formatLocalDate());
  const todaySeconds = ref(0);
  const todayPlays = ref(0);
  const totalSeconds = ref(0);
  const totalPlays = ref(0);
  const songs = ref<Record<string, SongPlayStat>>({});
  const artists = ref<Record<string, number>>({});

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureTodayFresh() {
    const today = formatLocalDate();
    if (todayDate.value !== today) {
      todayDate.value = today;
      todaySeconds.value = 0;
      todayPlays.value = 0;
    }
  }

  function schedulePersist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const trimmedSongs: Record<string, SongPlayStat> = {};
      Object.values(songs.value)
        .sort((a, b) => b.count - a.count || b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, 120)
        .forEach((s) => {
          trimmedSongs[s.key] = s;
        });

      const payload: PersistedListeningStats = {
        todayDate: todayDate.value,
        todaySeconds: todaySeconds.value,
        todayPlays: todayPlays.value,
        totalSeconds: totalSeconds.value,
        totalPlays: totalPlays.value,
        songs: trimmedSongs,
        artists: artists.value,
      };
      void echoSystem.kvSetJson(STATS_KEY, payload);
    }, 1500);
  }

  async function hydrate() {
    const saved = await echoSystem.kvGetJson<Partial<PersistedListeningStats>>(STATS_KEY, {});
    const today = formatLocalDate();
    if (saved.todayDate === today) {
      todayDate.value = today;
      todaySeconds.value = Number(saved.todaySeconds || 0);
      todayPlays.value = Number(saved.todayPlays || 0);
    } else {
      todayDate.value = today;
      todaySeconds.value = 0;
      todayPlays.value = 0;
    }
    totalSeconds.value = Number(saved.totalSeconds || 0);
    totalPlays.value = Number(saved.totalPlays || 0);
    songs.value = saved.songs && typeof saved.songs === 'object' ? saved.songs : {};
    artists.value = saved.artists && typeof saved.artists === 'object' ? saved.artists : {};
  }

  function recordSongPlay(song: Song) {
    ensureTodayFresh();
    todayPlays.value += 1;
    totalPlays.value += 1;

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
    todaySeconds.value += deltaSec;
    totalSeconds.value += deltaSec;
    schedulePersist();
  }

  const todayMinutes = computed(() => Math.round(todaySeconds.value / 60));

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
    topSongs,
    topArtist,
    hydrate,
    recordSongPlay,
    addListeningDeltaSec,
  };
});
