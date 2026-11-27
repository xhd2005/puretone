<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

type FluidQuad = [string, string, string, string];

const DEFAULT_QUAD: FluidQuad = ['#233b86', '#192458', '#0e1638', '#241948'];

const props = defineProps<{
  active?: boolean;
  colors?: FluidQuad;
}>();

const docVisible = ref(typeof document === 'undefined' ? true : !document.hidden);

// Dual-buffer crossfading palette layers (A / B) so track changes NEVER hard-snap
// CSS variables inside radial-gradient() — works smoothly even on Android 8-11 Chrome 80+!
const layerAColors = ref<FluidQuad>([...(props.colors || DEFAULT_QUAD)] as FluidQuad);
const layerBColors = ref<FluidQuad>([...(props.colors || DEFAULT_QUAD)] as FluidQuad);
const activeSlot = ref<'a' | 'b'>('a');
let swapRaf = 0;

function quadKey(q?: FluidQuad): string {
  return (q || DEFAULT_QUAD).join('|');
}

watch(
  () => props.colors,
  (next) => {
    const incoming: FluidQuad =
      Array.isArray(next) && next.length === 4 ? ([...next] as FluidQuad) : [...DEFAULT_QUAD];
    const currentVisible = activeSlot.value === 'a' ? layerAColors.value : layerBColors.value;
    if (quadKey(incoming) === quadKey(currentVisible)) return;

    if (swapRaf) cancelAnimationFrame(swapRaf);

    if (activeSlot.value === 'a') {
      layerBColors.value = incoming;
      swapRaf = requestAnimationFrame(() => {
        swapRaf = 0;
        activeSlot.value = 'b';
      });
    } else {
      layerAColors.value = incoming;
      swapRaf = requestAnimationFrame(() => {
        swapRaf = 0;
        activeSlot.value = 'a';
      });
    }
  },
  { deep: true },
);

function onVisibility() {
  docVisible.value = !document.hidden;
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility));
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  if (swapRaf) cancelAnimationFrame(swapRaf);
});
</script>

<template>
  <div class="fluid-bg" :class="{ paused: !active || !docVisible }" aria-hidden="true">
    <!-- Buffer Layer A -->
    <div class="fluid-layer" :class="{ 'is-front': activeSlot === 'a' }">
      <div
        class="fluid-base"
        :style="{ background: `radial-gradient(circle at 20% 20%, ${layerAColors[0]}, #0b0b0e 78%)` }"
      />
      <div
        class="orb orb-1"
        :style="{ background: `radial-gradient(circle at center, ${layerAColors[0]} 0%, transparent 66%)` }"
      />
      <div
        class="orb orb-2"
        :style="{ background: `radial-gradient(circle at center, ${layerAColors[1]} 0%, transparent 66%)` }"
      />
      <div
        class="orb orb-3"
        :style="{ background: `radial-gradient(circle at center, ${layerAColors[2]} 0%, transparent 68%)` }"
      />
      <div
        class="orb orb-4"
        :style="{ background: `radial-gradient(circle at center, ${layerAColors[3]} 0%, transparent 66%)` }"
      />
    </div>

    <!-- Buffer Layer B -->
    <div class="fluid-layer" :class="{ 'is-front': activeSlot === 'b' }">
      <div
        class="fluid-base"
        :style="{ background: `radial-gradient(circle at 20% 20%, ${layerBColors[0]}, #0b0b0e 78%)` }"
      />
      <div
        class="orb orb-1"
        :style="{ background: `radial-gradient(circle at center, ${layerBColors[0]} 0%, transparent 66%)` }"
      />
      <div
        class="orb orb-2"
        :style="{ background: `radial-gradient(circle at center, ${layerBColors[1]} 0%, transparent 66%)` }"
      />
      <div
        class="orb orb-3"
        :style="{ background: `radial-gradient(circle at center, ${layerBColors[2]} 0%, transparent 68%)` }"
      />
      <div
        class="orb orb-4"
        :style="{ background: `radial-gradient(circle at center, ${layerBColors[3]} 0%, transparent 66%)` }"
      />
    </div>

    <div class="fluid-scrim" />
  </div>
</template>

<style scoped>
.fluid-bg {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: #0d0d10;
  z-index: 0;
  contain: strict;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.fluid-layer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0;
  z-index: 1;
  transition: opacity 780ms ease;
  will-change: opacity;
}

.fluid-layer.is-front {
  opacity: 1;
  z-index: 2;
}

.fluid-base {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

/* Soft GPU-only radial glow orbs: ZERO live filter:blur(56px) stalls while maintaining dreamy depth! */
.orb {
  position: absolute;
  border-radius: 50%;
  opacity: 0.78;
  will-change: transform;
  backface-visibility: hidden;
}

.orb-1 {
  width: 118vw;
  height: 118vw;
  top: -32%;
  left: -34%;
  animation: drift-a 20s ease-in-out infinite alternate;
}

.orb-2 {
  width: 112vw;
  height: 112vw;
  top: 12%;
  right: -40%;
  animation: drift-b 24s ease-in-out infinite alternate;
}

.orb-3 {
  width: 124vw;
  height: 124vw;
  bottom: -36%;
  left: -26%;
  animation: drift-c 27s ease-in-out infinite alternate;
}

.orb-4 {
  width: 102vw;
  height: 102vw;
  bottom: -6%;
  right: -28%;
  animation: drift-d 22s ease-in-out infinite alternate;
}

.fluid-scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.24) 0%,
    rgba(0, 0, 0, 0.14) 45%,
    rgba(0, 0, 0, 0.38) 100%
  );
}

.fluid-bg.paused .orb {
  animation-play-state: paused;
}

@keyframes drift-a {
  0% { transform: translate3d(0, 0, 0) scale(1); }
  100% { transform: translate3d(14%, 11%, 0) scale(1.14); }
}
@keyframes drift-b {
  0% { transform: translate3d(0, 0, 0) scale(1.04); }
  100% { transform: translate3d(-15%, -10%, 0) scale(0.94); }
}
@keyframes drift-c {
  0% { transform: translate3d(0, 0, 0) scale(1); }
  100% { transform: translate3d(12%, -12%, 0) scale(1.12); }
}
@keyframes drift-d {
  0% { transform: translate3d(0, 0, 0) scale(0.96); }
  100% { transform: translate3d(-12%, 11%, 0) scale(1.12); }
}
</style>
