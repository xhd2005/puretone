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

.fluid-base {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: radial-gradient(circle at 20% 20%, var(--fluid-1), #0b0b0e 78%);
  transition: background 900ms ease;
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
  background: radial-gradient(circle at center, var(--fluid-1) 0%, transparent 66%);
  animation: drift-a 20s ease-in-out infinite alternate;
}

.orb-2 {
  width: 112vw;
  height: 112vw;
  top: 12%;
  right: -40%;
  background: radial-gradient(circle at center, var(--fluid-2) 0%, transparent 66%);
  animation: drift-b 24s ease-in-out infinite alternate;
}

.orb-3 {
  width: 124vw;
  height: 124vw;
  bottom: -36%;
  left: -26%;
  background: radial-gradient(circle at center, var(--fluid-3) 0%, transparent 68%);
  animation: drift-c 27s ease-in-out infinite alternate;
}

.orb-4 {
  width: 102vw;
  height: 102vw;
  bottom: -6%;
  right: -28%;
  background: radial-gradient(circle at center, var(--fluid-4) 0%, transparent 66%);
  animation: drift-d 22s ease-in-out infinite alternate;
}

.fluid-scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
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
