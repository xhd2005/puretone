<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  size?: number;
}>();

const boxSize = computed(() => props.size || 32);
</script>

<template>
  <!--
    MELUNE Pure-Vector Crescent-Moon Musical Note on Moonlit Indigo Liquid Glass.
    Uses pure CSS gradients + a single self-contained closed SVG path (zero url(#id) refs)
    so multiple instances coexist cleanly in Chromium/Android WebView.
  -->
  <span
    class="ml-mark"
    :style="{
      width: `${boxSize}px`,
      height: `${boxSize}px`,
      borderRadius: `${Math.round(boxSize * 0.235)}px`,
    }"
    role="img"
    aria-label="MELUNE Logo"
  >
    <svg
      viewBox="0 0 108 108"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="ml-glyph"
    >
      <path
        d="M53.16,56.21 L53.16,31.96 C53.16,28.38 56.11,25.85 59.70,26.59 C67.93,28.27 75.31,32.81 79.32,39.24 C81.00,41.98 80.05,45.57 77.21,46.94 C74.78,48.10 71.93,47.26 70.35,45.15 C67.61,41.46 64.34,39.24 61.17,38.29 L61.17,69.72 A15.40,15.40 0 1,1 30.39,69.16 A11.18,11.18 0 1,0 44.55,54.37 A15.40,15.40 0 0,1 53.16,56.21 Z"
        fill="#040922"
        fill-opacity="0.34"
      />
      <path
        d="M53.16,54.41 L53.16,30.16 C53.16,26.58 56.11,24.05 59.70,24.79 C67.93,26.47 75.31,31.01 79.32,37.44 C81.00,40.18 80.05,43.77 77.21,45.14 C74.78,46.30 71.93,45.46 70.35,43.35 C67.61,39.66 64.34,37.44 61.17,36.49 L61.17,67.92 A15.40,15.40 0 1,1 30.39,67.36 A11.18,11.18 0 1,0 44.55,52.57 A15.40,15.40 0 0,1 53.16,54.41 Z"
        fill="#FFFFFF"
      />
    </svg>
  </span>
</template>

<style scoped>
.ml-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 34% 14%, rgba(166, 204, 255, 0.36) 0%, rgba(106, 149, 247, 0.08) 48%, rgba(106, 149, 247, 0) 70%),
    radial-gradient(circle at 84% 86%, rgba(123, 107, 255, 0.25) 0%, rgba(123, 107, 255, 0) 56%),
    linear-gradient(155deg, #3456be 0%, #1a2d70 50%, #0b1336 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    0 4px 14px rgba(14, 23, 64, 0.32);
}

.ml-glyph {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
