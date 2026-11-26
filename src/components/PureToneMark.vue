<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  size?: number;
}>();

const boxSize = computed(() => props.size || 32);
</script>

<template>
  <!--
    Pure CSS crimson gradient container + inline white vector note.
    Deliberately avoids SVG <linearGradient id="..."> url(#id) references, which break
    in Chromium/Android WebView when multiple PureToneMark instances coexist in the DOM.
  -->
  <span
    class="pt-mark"
    :style="{
      width: `${boxSize}px`,
      height: `${boxSize}px`,
      borderRadius: `${Math.round(boxSize * 0.235)}px`,
    }"
    role="img"
    aria-label="PureTone Logo"
  >
    <svg
      viewBox="0 0 108 108"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="pt-note"
    >
      <path
        d="M52.4 32.5C52.4 29.4 54.9 27.2 58.0 27.8C65.0 29.2 71.2 33.0 74.6 38.4C76.0 40.7 75.2 43.7 72.8 44.8C70.8 45.8 68.5 45.1 67.2 43.3C64.9 40.2 62.2 38.3 58.8 37.5V65.2C58.8 72.9 52.1 78.7 43.9 78.7C36.5 78.7 31.4 74.1 31.4 68.1C31.4 61.3 37.5 56.3 45.4 56.3C48.0 56.3 50.4 56.9 52.4 57.9Z"
        fill="#8B0018"
        fill-opacity="0.16"
      />
      <path
        d="M51.2 30.8C51.2 27.7 53.7 25.5 56.8 26.1C63.8 27.5 70.0 31.3 73.4 36.7C74.8 39.0 74.0 42.0 71.6 43.1C69.6 44.1 67.3 43.4 66.0 41.6C63.7 38.5 61.0 36.6 57.6 35.8V63.5C57.6 71.2 50.9 77.0 42.7 77.0C35.3 77.0 30.2 72.4 30.2 66.4C30.2 59.6 36.3 54.6 44.2 54.6C46.8 54.6 49.2 55.2 51.2 56.2Z"
        fill="#FFFFFF"
      />
    </svg>
  </span>
</template>

<style scoped>
.pt-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 8%, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0) 62%),
    linear-gradient(180deg, #ff526e 0%, #fa233b 52%, #dc122e 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.34),
    0 4px 12px rgba(220, 18, 46, 0.26);
}

.pt-note {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
