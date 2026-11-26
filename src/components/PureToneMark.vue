<script setup lang="ts">
defineProps<{
  size?: number;
}>();
</script>

<template>
  <svg
    :width="size || 32"
    :height="size || 32"
    viewBox="0 0 108 108"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="shrink-0 rounded-[24%] shadow-md"
    aria-label="PureTone Logo"
  >
    <defs>
      <linearGradient id="pt-bg" x1="12" y1="8" x2="98" y2="102" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FA243C" />
        <stop offset="38%" stop-color="#C91F6B" />
        <stop offset="72%" stop-color="#6B1D5C" />
        <stop offset="100%" stop-color="#1E1030" />
      </linearGradient>
      <radialGradient id="pt-glow" cx="28" cy="24" r="62" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF6B81" stop-opacity="0.55" />
        <stop offset="60%" stop-color="#FF375F" stop-opacity="0.12" />
        <stop offset="100%" stop-color="#FA243C" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="108" height="108" rx="26" fill="url(#pt-bg)" />
    <rect width="108" height="108" rx="26" fill="url(#pt-glow)" />
    <circle cx="54" cy="54" r="31" fill="#FFFFFF" fill-opacity="0.09" />
    <path
      d="M37 74V34H50.5C58.8 34 64.5 39.4 64.5 46.8C64.5 54.2 58.8 59.5 50.5 59.5H42.5"
      stroke="#FFFFFF"
      stroke-width="6.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M67.8 38.5C72.2 43.2 72.2 52.8 67.8 57.8"
      stroke="#FFFFFF"
      stroke-opacity="0.9"
      stroke-width="4.4"
      stroke-linecap="round"
    />
    <path
      d="M74.4 32.5C81.2 40.4 81.2 56.2 74.4 64.2"
      stroke="#FFFFFF"
      stroke-opacity="0.6"
      stroke-width="3.8"
      stroke-linecap="round"
    />
    <circle cx="50.5" cy="73.8" r="3.6" fill="#FFFFFF" fill-opacity="0.9" />
  </svg>
</template>
