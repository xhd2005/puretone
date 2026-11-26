import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { SafeAreaInsets } from '@/native/echoSystem';
import type { Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';

export const useUiStore = defineStore('ui', () => {
  const nowPlayingOpen = ref(false);
  const nowPlayingMode = ref<'cover' | 'lyrics' | 'queue'>('cover');
  const accountSheetOpen = ref(false);
  const loginModalOpen = ref(false);
  const actionSheetSong = ref<Song | null>(null);
  const unblockModalSong = ref<Song | null>(null);

  const toastMessage = ref('');
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const insets = ref<SafeAreaInsets>({ top: 0, bottom: 0, left: 0, right: 0, imeBottom: 0 });

  // Used by AppShell for iOS-style backdrop scale-back recession animation
  const hasModalOverlay = computed(() =>
    Boolean(
      nowPlayingOpen.value ||
        accountSheetOpen.value ||
        loginModalOpen.value ||
        actionSheetSong.value ||
        unblockModalSong.value,
    ),
  );

  function applyInsetsToCss(val: SafeAreaInsets) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--safe-top', `${Math.max(0, val.top)}px`);
    root.style.setProperty('--safe-bottom', `${Math.max(0, val.bottom)}px`);
    root.style.setProperty('--ime-height', `${Math.max(0, val.imeBottom)}px`);
  }

  async function initSystemInsets() {
    const initial = await echoSystem.getInsets();
    insets.value = initial;
    applyInsetsToCss(initial);
    await echoSystem.onInsetsChange((next) => {
      insets.value = next;
      applyInsetsToCss(next);
    });
  }

  function showToast(msg: string, durationMs = 2400) {
    toastMessage.value = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage.value = '';
    }, durationMs);
  }

  function openNowPlaying(mode: 'cover' | 'lyrics' | 'queue' = 'cover') {
    echoSystem.haptic('light');
    nowPlayingMode.value = mode;
    nowPlayingOpen.value = true;
  }

  function closeTopOverlay(): boolean {
    if (unblockModalSong.value) {
      unblockModalSong.value = null;
      return true;
    }
    if (actionSheetSong.value) {
      actionSheetSong.value = null;
      return true;
    }
    if (loginModalOpen.value) {
      loginModalOpen.value = false;
      return true;
    }
    if (accountSheetOpen.value) {
      accountSheetOpen.value = false;
      return true;
    }
    if (nowPlayingOpen.value) {
      nowPlayingOpen.value = false;
      return true;
    }
    return false;
  }

  return {
    nowPlayingOpen,
    nowPlayingMode,
    accountSheetOpen,
    loginModalOpen,
    actionSheetSong,
    unblockModalSong,
    hasModalOverlay,
    toastMessage,
    insets,
    initSystemInsets,
    showToast,
    openNowPlaying,
    closeTopOverlay,
  };
});
