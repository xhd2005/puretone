<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import PureToneMark from './PureToneMark.vue';

const emit = defineEmits<{
  done: [];
}>();

const ui = useUiStore();
const { t, effectiveLocale } = useI18n();
const visible = ref(true);
const revealed = ref(false);
let revealTimer: ReturnType<typeof setTimeout> | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let finishTimer: ReturnType<typeof setTimeout> | null = null;
let finished = false;
let isInitialBoot = true;

function clearTimers() {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
}

function dismiss() {
  if (finished) return;
  finished = true;
  clearTimers();
  visible.value = false;
  if (isInitialBoot) {
    isInitialBoot = false;
    finishTimer = setTimeout(() => emit('done'), 320);
  }
}

function playSequence(durationMs = 1820) {
  clearTimers();
  finished = false;
  revealed.value = false;
  visible.value = true;
  revealTimer = setTimeout(() => {
    revealed.value = true;
  }, 45);
  dismissTimer = setTimeout(() => {
    dismiss();
  }, durationMs);
}

watch(
  () => ui.splashReplaySeq,
  (seq, prev) => {
    if (seq > 0 && seq !== prev) {
      isInitialBoot = false;
      playSequence(2400);
    }
  },
);

onMounted(() => {
  playSequence(1820);
});

onUnmounted(() => {
  clearTimers();
});
</script>

<template>
  <Transition name="ml-splash">
    <div
      v-if="visible"
      class="ml-splash-root fixed inset-0 z-[120] flex flex-col items-center justify-between px-8 select-none"
      @click="dismiss"
    >
      <!-- Ambient Moonlit Aurora Halos -->
      <div class="ml-halo-top pointer-events-none" :class="{ 'is-on': revealed }" />
      <div class="ml-halo-bottom pointer-events-none" :class="{ 'is-on': revealed }" />

      <!-- Top Safe Spacer + Skip Hint -->
      <div class="w-full pt-[calc(var(--safe-top)+14px)] flex justify-end relative z-10">
        <button
          type="button"
          class="px-3 py-1 rounded-full bg-white/10 text-white/65 text-[11px] font-medium border-0"
          @click.stop="dismiss"
        >
          {{ t('common.skip') }}
        </button>
      </div>

      <!-- Center Moonlit Emblem & Brand Typography -->
      <div class="flex flex-col items-center text-center relative z-10 -mt-6 max-w-[320px]">
        <div class="ml-emblem-wrap" :class="{ 'is-on': revealed }">
          <PureToneMark :size="84" />
        </div>

        <div class="ml-brand-copy mt-6" :class="{ 'is-on': revealed }">
          <div class="text-[24px] font-bold tracking-[0.14em] text-white">
            {{ t('app.fullName') }}
          </div>

          <p class="mt-4 text-[15.5px] font-semibold tracking-[0.10em] text-white/95 leading-relaxed m-0">
            {{ t('splash.headline') }}
          </p>

          <div class="ml-brand-sub mt-3 space-y-1" :class="{ 'is-on': revealed }">
            <p class="text-[12.5px] font-normal tracking-[0.09em] text-[#dceaff]/72 leading-relaxed m-0">
              {{ t('splash.line1') }}
            </p>
            <p class="text-[12.5px] font-normal tracking-[0.09em] text-[#cbdcf8]/68 leading-relaxed m-0">
              {{ t('splash.line2') }}
            </p>
          </div>

          <p
            v-if="effectiveLocale !== 'en'"
            class="mt-3.5 text-[10px] font-medium tracking-[0.2em] uppercase text-[#a6c2f5]/46 m-0"
          >
            {{ t('app.sloganEn') }}
          </p>
        </div>
      </div>

      <!-- Bottom Subtle Signature -->
      <div class="pb-[calc(var(--safe-bottom)+26px)] text-[11px] tracking-[0.18em] uppercase text-white/35 relative z-10">
        MELUNE · AUDIO SANCTUARY
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ml-splash-root {
  background: radial-gradient(circle at 50% 24%, #1a2d70 0%, #0f1a46 42%, #0b1336 100%);
  overflow: hidden;
}

.ml-halo-top {
  position: absolute;
  top: -120px;
  left: 50%;
  width: 440px;
  height: 440px;
  transform: translateX(-50%) scale(0.84);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(145, 192, 255, 0.30) 0%, rgba(92, 134, 248, 0.08) 46%, transparent 72%);
  opacity: 0;
  transition: opacity 720ms ease, transform 900ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ml-halo-top.is-on {
  opacity: 1;
  transform: translateX(-50%) scale(1.06);
}

.ml-halo-bottom {
  position: absolute;
  bottom: -140px;
  right: -80px;
  width: 380px;
  height: 380px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(123, 107, 255, 0.24) 0%, transparent 66%);
  opacity: 0;
  transition: opacity 820ms ease;
}
.ml-halo-bottom.is-on {
  opacity: 1;
}

.ml-emblem-wrap {
  transform: scale(0.94);
  opacity: 0.92;
  transition: transform 620ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease;
  filter: drop-shadow(0 18px 40px rgba(4, 10, 36, 0.55));
}
.ml-emblem-wrap.is-on {
  transform: scale(1);
  opacity: 1;
}

.ml-brand-copy {
  opacity: 0;
  transform: translate3d(0, 12px, 0);
  transition: opacity 540ms ease 100ms, transform 640ms cubic-bezier(0.22, 1, 0.36, 1) 100ms;
}
.ml-brand-copy.is-on {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

.ml-brand-sub {
  opacity: 0;
  transform: translate3d(0, 8px, 0);
  transition: opacity 560ms ease 240ms, transform 640ms cubic-bezier(0.22, 1, 0.36, 1) 240ms;
}
.ml-brand-sub.is-on {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

.ml-splash-leave-active {
  transition: opacity 340ms ease, transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ml-splash-leave-to {
  opacity: 0;
  transform: scale(1.03);
}
</style>
