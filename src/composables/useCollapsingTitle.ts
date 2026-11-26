import { computed, ref } from 'vue';

export interface TitleCrossfadeState {
  largeTitleOpacity: number;
  compactTitleOpacity: number;
  headerGlassActive: boolean;
}

/**
 * Pure crossfade math guaranteeing a 12px zero-overlap dead zone:
 * - Large 34px title fades out completely across 0..24px (opacity = 0 at 24px).
 * - Compact 17px header title only begins fading in at 36px..54px.
 * Therefore largeTitleOpacity and compactTitleOpacity can NEVER both be > 0!
 */
export function computeTitleCrossfade(scrollTop: number): TitleCrossfadeState {
  const y = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const largeTitleOpacity = Math.max(0, Math.min(1, 1 - y / 24));
  const compactTitleOpacity = Math.max(0, Math.min(1, (y - 36) / 18));
  const headerGlassActive = y > 26;
  return {
    largeTitleOpacity: Number(largeTitleOpacity.toFixed(3)),
    compactTitleOpacity: Number(compactTitleOpacity.toFixed(3)),
    headerGlassActive,
  };
}

export function useCollapsingTitle() {
  const scrollTop = ref(0);

  const state = computed(() => computeTitleCrossfade(scrollTop.value));
  const largeTitleOpacity = computed(() => state.value.largeTitleOpacity);
  const compactTitleOpacity = computed(() => state.value.compactTitleOpacity);
  const headerGlassActive = computed(() => state.value.headerGlassActive);

  function onScroll(e: Event) {
    scrollTop.value = (e.target as HTMLElement)?.scrollTop ?? 0;
  }

  return {
    scrollTop,
    largeTitleOpacity,
    compactTitleOpacity,
    headerGlassActive,
    onScroll,
  };
}
