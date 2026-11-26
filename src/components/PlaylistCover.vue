<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import iconMusic from '@iconify/icons-tabler/music';
import { getResolvedPlaylistCovers, isValidCoverUrl } from '@/services/playback/playlistCoverResolver';

const props = defineProps<{
  playlistKey: string;
  coverUrl?: string;
  fallbackCovers?: string[];
  alt?: string;
}>();

const resolvedCovers = computed<string[]>(() => {
  const fromResolver = getResolvedPlaylistCovers(props.playlistKey, props.coverUrl);
  if (fromResolver.length > 0) return fromResolver;
  if (Array.isArray(props.fallbackCovers) && props.fallbackCovers.length > 0) {
    return props.fallbackCovers.filter(isValidCoverUrl).slice(0, 4);
  }
  return [];
});
</script>

<template>
  <div class="w-full h-full relative overflow-hidden bg-[var(--bg-subtle)]">
    <!-- Apple Music 2x2 Collage when >= 4 distinct track covers exist -->
    <div v-if="resolvedCovers.length >= 4" class="w-full h-full grid grid-cols-2 grid-rows-2">
      <img
        v-for="(src, idx) in resolvedCovers.slice(0, 4)"
        :key="idx"
        :src="src"
        :alt="alt || ''"
        loading="lazy"
        class="w-full h-full object-cover block"
      />
    </div>

    <!-- Single crisp HD cover -->
    <img
      v-else-if="resolvedCovers.length > 0"
      :src="resolvedCovers[0]"
      :alt="alt || ''"
      loading="lazy"
      class="w-full h-full object-cover block"
    />

    <!-- Minimal fallback icon -->
    <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
      <Icon :icon="iconMusic" class="w-1/3 h-1/3 max-w-12 max-h-12" />
    </div>
  </div>
</template>
