<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconUser from '@iconify/icons-tabler/user';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import type { SongArtistRef } from '@/types/music';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { navigateToArtistRef } from '@/services/playback/artistNavigation';

const router = useRouter();
const ui = useUiStore();
const { t } = useI18n();

async function pickArtist(item: SongArtistRef) {
  echoSystem.haptic('selection');
  await navigateToArtistRef(item, router, ui, {
    resolving: t('artist.resolving'),
    notFound: t('artist.notFound'),
  });
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.artistPickerCandidates && ui.artistPickerCandidates.length"
      class="fixed inset-0 z-[102] flex flex-col justify-end lg-scrim"
      @click="ui.artistPickerCandidates = null"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div class="lg-sheet-panel rounded-t-[26px] px-4 pt-2.5 pb-[calc(var(--safe-bottom)+18px)] space-y-3">
          <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />
          <div class="px-1 text-[16px] font-bold text-[var(--text-primary)]">
            {{ t('artist.pickerTitle') }}
          </div>
          <div class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
            <button
              v-for="(art, idx) in ui.artistPickerCandidates"
              :key="`${art.id || art.name}-${idx}`"
              type="button"
              class="w-full h-13 px-4 bg-transparent border-0 flex items-center justify-between gap-3 text-left am-tap"
              @click="pickArtist(art)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text shrink-0">
                  <Icon :icon="iconUser" class="w-4 h-4" />
                </span>
                <span class="text-[15px] font-semibold text-[var(--text-primary)] truncate">{{ art.name }}</span>
              </div>
              <Icon :icon="iconChevronRight" class="w-4.5 h-4.5 text-[var(--text-tertiary)] shrink-0" />
            </button>
          </div>
          <button
            type="button"
            class="w-full h-11 rounded-[16px] bg-[var(--bg-card)] text-[15px] font-semibold text-[var(--text-secondary)] border-0 am-tap"
            @click="ui.artistPickerCandidates = null"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
