<script setup lang="ts">
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import iconVolume from '@iconify/icons-tabler/volume';
import iconWaveSine from '@iconify/icons-tabler/wave-sine';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconX from '@iconify/icons-tabler/x';
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import type { TrackTransitionFadeMs } from '@/stores/settings';
import { useSettingsStore } from '@/stores/settings';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import SegmentedControl from './SegmentedControl.vue';

const settings = useSettingsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const qualityOptions = computed<Array<{ id: AudioQuality; label: string }>>(() => [
  { id: '128', label: t('settings.quality128') },
  { id: '320', label: t('settings.quality320') },
  { id: 'flac', label: t('settings.qualityFlac') },
  { id: 'high', label: t('settings.qualityHigh') },
]);

const eqOptions = computed<Array<{ id: EqPresetId; label: string }>>(() => [
  { id: 'flat', label: t('settings.eq.flat') },
  { id: 'vocal', label: t('settings.eq.vocal') },
  { id: 'bass', label: t('settings.eq.bass') },
  { id: 'night', label: t('settings.eq.night') },
  { id: 'live', label: t('settings.eq.live') },
]);

const transitionOptions = computed<Array<{ id: TrackTransitionFadeMs; label: string }>>(() => [
  { id: 0, label: t('settings.transitionOff') },
  { id: 1500, label: t('settings.transition15') },
  { id: 3000, label: t('settings.transition30') },
  { id: 5000, label: t('settings.transition50') },
]);

function close() {
  ui.audioEffectSheetOpen = false;
}

const dragSheet = useDraggableSheet({
  onDismiss: close,
});

watch(
  () => ui.audioEffectSheetOpen,
  (open) => {
    if (open) dragSheet.reset();
  },
);
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.audioEffectSheetOpen"
      class="fixed top-0 right-0 bottom-0 left-0 z-[96] flex flex-col justify-end lg-scrim"
      @click="close"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel w-full rounded-t-[28px] px-4 pt-2.5 pb-[calc(var(--safe-bottom)+18px)] shadow-2xl space-y-3.5"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- GPU-Draggable Handle & Title -->
          <div
            class="flex flex-col items-center touch-none select-none cursor-grab active:cursor-grabbing"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mb-2.5" />
            <div class="w-full flex items-center justify-between gap-2 px-1">
              <div class="flex items-center gap-2 min-w-0">
                <Icon :icon="iconAdjustments" class="w-5 h-5 am-accent-text shrink-0" />
                <div class="min-w-0">
                  <h3 class="text-[16px] font-bold text-[var(--text-primary)] leading-tight truncate">
                    {{ t('audio.sheetTitle') }}
                  </h3>
                  <p class="text-[11px] text-[var(--text-secondary)] truncate mt-0.5 m-0">
                    {{ t('audio.sheetSub') }}
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] flex items-center justify-center border-0 am-tap shrink-0"
                :aria-label="t('common.close')"
                @touchstart.stop
                @click="close"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Grouped Settings Surface -->
          <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
            <!-- 1. Audio Quality 4-Tier Selector -->
            <div class="px-4 py-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 text-[14px] font-medium text-[var(--text-primary)]">
                  <Icon :icon="iconSparkles" class="w-4 h-4 am-accent-text shrink-0" />
                  <span>{{ t('settings.quality') }}</span>
                </div>
                <span
                  v-if="player.sourceTag"
                  class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[10.5px] font-semibold am-accent-text truncate max-w-[48%]"
                >
                  {{ player.sourceTag }}
                </span>
              </div>
              <SegmentedControl v-model="settings.quality" :options="qualityOptions" />
            </div>

            <!-- 2. 32-bit Float Zero-Pop 5-Band EQ -->
            <div class="px-4 py-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[14px] font-medium text-[var(--text-primary)]">{{ t('settings.eqTitle') }}</span>
                <span class="text-[11px] text-[var(--text-secondary)] truncate">{{ t('settings.eqSub') }}</span>
              </div>
              <SegmentedControl v-model="settings.eqPreset" :options="eqOptions" />
            </div>

            <!-- 3. Volume Leveling / Loudness Enhancement -->
            <label class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
              <div class="flex items-center gap-2 min-w-0">
                <Icon :icon="iconVolume" class="w-4 h-4 am-accent-text shrink-0" />
                <div class="min-w-0">
                  <div class="text-[14px] font-medium text-[var(--text-primary)] leading-snug">
                    {{ t('settings.volumeLeveling') }}
                  </div>
                  <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">
                    {{ t('settings.volumeLevelingSub') }}
                  </div>
                </div>
              </div>
              <input v-model="settings.volumeLeveling" type="checkbox" class="ios-switch" />
            </label>

            <!-- 4. Track Transition Fade -->
            <div class="px-4 py-3 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 text-[14px] font-medium text-[var(--text-primary)]">
                  <Icon :icon="iconWaveSine" class="w-4 h-4 am-accent-text shrink-0" />
                  <span>{{ t('settings.transitionTitle') }}</span>
                </div>
                <span class="text-[11px] text-[var(--text-secondary)] truncate">{{ t('settings.transitionSub') }}</span>
              </div>
              <SegmentedControl v-model="settings.transitionFadeMs" :options="transitionOptions" tabular-nums />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
