<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

defineProps<{
  active?: boolean;
}>();

const docVisible = ref(typeof document === 'undefined' ? true : !document.hidden);

function onVisibility() {
  docVisible.value = !document.hidden;
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility));
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibility));
</script>

<template>
  <div class="fluid-bg" :class="{ paused: !active || !docVisible }" aria-hidden="true">
    <div class="fluid-base" />
    <div class="orb orb-1" />
    <div class="orb orb-2" />
    <div class="orb orb-3" />
    <div class="orb orb-4" />
    <div class="fluid-scrim" />
  </div>
</template>

<style scoped>
.fluid-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0d0d10;
  z-index: 0;
  contain: strict;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.fluid-base {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 20% 20%, var(--fluid-1), #0b0b0e 75%);
  transition: background 900ms ease;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(56px);
  opacity: 0.82;
  will-change: transform;
  backface-visibility: hidden;
  transition: background-color 900ms ease;
}

.orb-1 {
  width: 85vw;
  height: 85vw;
  top: -18%;
  left: -20%;
  background-color: var(--fluid-1);
  animation: drift-a 18s ease-in-out infinite alternate;
}

.orb-2 {
  width: 80vw;
  height: 80vw;
  top: 22%;
  right: -25%;
  background-color: var(--fluid-2);
  animation: drift-b 22s ease-in-out infinite alternate;
}

.orb-3 {
  width: 90vw;
  height: 90vw;
  bottom: -22%;
  left: -10%;
  background-color: var(--fluid-3);
  animation: drift-c 25s ease-in-out infinite alternate;
}

.orb-4 {
  width: 72vw;
  height: 72vw;
  bottom: 10%;
  right: -12%;
  background-color: var(--fluid-4);
  animation: drift-d 20s ease-in-out infinite alternate;
}

.fluid-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.24) 0%,
    rgba(0, 0, 0, 0.14) 45%,
    rgba(0, 0, 0, 0.36) 100%
  );
}

.fluid-bg.paused .orb {
  animation-play-state: paused;
}

@keyframes drift-a {
  0% { transform: translate3d(0, 0, 0) scale(1); }
  100% { transform: translate3d(18%, 14%, 0) scale(1.18); }
}
@keyframes drift-b {
  0% { transform: translate3d(0, 0, 0) scale(1.05); }
  100% { transform: translate3d(-20%, -12%, 0) scale(0.92); }
}
@keyframes drift-c {
  0% { transform: translate3d(0, 0, 0) scale(1); }
  100% { transform: translate3d(16%, -16%, 0) scale(1.14); }
}
@keyframes drift-d {
  0% { transform: translate3d(0, 0, 0) scale(0.95); }
  100% { transform: translate3d(-15%, 14%, 0) scale(1.16); }
}
</style>
