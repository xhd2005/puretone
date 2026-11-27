<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconPlus from '@iconify/icons-tabler/plus';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconLock from '@iconify/icons-tabler/lock';
import iconCheck from '@iconify/icons-tabler/check';
import iconMusic from '@iconify/icons-tabler/music';
import type { PlaylistSummary } from '@/types/music';
import { getPlaylistCacheKey } from '@/services/playback/playlistCoverResolver';
import { useAccountsStore } from '@/stores/accounts';
import { usePlaylistsStore } from '@/stores/playlists';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import PlaylistCover from './PlaylistCover.vue';

const accounts = useAccountsStore();
const playlistsStore = usePlaylistsStore();
const ui = useUiStore();
const { t } = useI18n();

const scrollRef = ref<HTMLElement | null>(null);
const creatingOpen = ref(false);
const newName = ref('');
const newPrivate = ref(false);
const submittingId = ref<string | null>(null);
const creatingAndAdding = ref(false);

const songs = computed(() => ui.addToPlaylistSongs || []);
const isOpen = computed(() => songs.value.length > 0);
const primarySong = computed(() => songs.value[0] || null);

const dragSheet = useDraggableSheet({
  detents: [0.68, 0.90],
  initialDetentIndex: 0,
  scrollElRef: scrollRef,
  onDismiss: close,
});

watch(isOpen, (open) => {
  if (open) {
    dragSheet.reset();
    creatingOpen.value = false;
    newName.value = '';
    newPrivate.value = false;
    submittingId.value = null;
    if (accounts.isLoggedIn) {
      void playlistsStore.fetchPlaylists(false);
    }
  }
});

function close() {
  if (submittingId.value || creatingAndAdding.value) return;
  ui.addToPlaylistSongs = null;
}

async function handlePickPlaylist(pl: PlaylistSummary) {
  if (submittingId.value || creatingAndAdding.value || !songs.value.length) return;
  echoSystem.haptic('medium');
  submittingId.value = pl.id;
  try {
    const added = await playlistsStore.addSongsToPlaylist(pl, songs.value);
    if (added > 0) {
      echoSystem.haptic('success');
      ui.showToast(t('playlist.addedToast', { name: pl.name, count: added }));
      ui.addToPlaylistSongs = null;
    } else {
      ui.showToast(t('playlist.actionFailed'));
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    submittingId.value = null;
  }
}

async function handleCreateAndAdd() {
  const cleanName = newName.value.trim();
  if (!cleanName || creatingAndAdding.value || !songs.value.length) return;
  echoSystem.haptic('medium');
  creatingAndAdding.value = true;
  try {
    const created = await playlistsStore.createPlaylist({
      name: cleanName,
      isPrivate: newPrivate.value,
    });
    if (created) {
      await playlistsStore.addSongsToPlaylist(created, songs.value);
      echoSystem.haptic('success');
      ui.showToast(t('playlist.addedToast', { name: created.name, count: songs.value.length }));
      ui.addToPlaylistSongs = null;
    } else {
      ui.showToast(t('playlist.createdToast', { name: cleanName }));
      creatingOpen.value = false;
      newName.value = '';
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    creatingAndAdding.value = false;
  }
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[96] flex flex-col justify-end lg-scrim"
      @click="close"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- Draggable Header -->
          <div
            class="shrink-0 touch-none select-none"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="pt-2.5 pb-1 flex justify-center">
              <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55" />
            </div>

            <div class="px-5 pt-1 pb-3 flex items-center justify-between gap-3 am-hairline-b">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-11 h-11 rounded-[10px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-sm flex items-center justify-center">
                  <img v-if="primarySong?.coverUrl" :src="primarySong.coverUrl" class="w-full h-full object-cover" alt="" />
                  <Icon v-else :icon="iconMusic" class="w-5 h-5 text-[var(--text-tertiary)]" />
                </div>
                <div class="min-w-0">
                  <div class="text-[16.5px] font-bold text-[var(--text-primary)] truncate">
                    {{
                      songs.length > 1
                        ? t('playlist.addTitleBatch', { count: songs.length })
                        : t('playlist.addTitle')
                    }}
                  </div>
                  <div v-if="primarySong" class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                    {{ songs.length > 1 ? `${primarySong.title}…` : `${primarySong.title} · ${primarySong.artist}` }}
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                :aria-label="t('common.close')"
                @click="close"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div
            ref="scrollRef"
            class="flex-1 am-scroll px-4 pt-3.5 pb-[calc(max(var(--safe-bottom),var(--ime-height))+22px)] space-y-3"
            @touchstart.passive="dragSheet.onBodyTouchStart"
            @touchmove="dragSheet.onBodyTouchMove"
            @touchend.passive="dragSheet.onBodyTouchEnd"
            @touchcancel.passive="dragSheet.onBodyTouchEnd"
          >
            <!-- Not Logged In State -->
            <div v-if="!accounts.isLoggedIn" class="rounded-[20px] bg-[var(--bg-card)] p-6 text-center space-y-3">
              <p class="text-[14px] text-[var(--text-secondary)] m-0">{{ t('playlist.needLogin') }}</p>
              <button
                type="button"
                class="px-6 h-10 rounded-full am-accent-bg text-white text-[14px] font-semibold border-0 am-tap"
                @click="ui.addToPlaylistSongs = null; ui.loginModalOpen = true"
              >
                {{ t('home.loginNow') }}
              </button>
            </div>

            <template v-else>
              <!-- Inline Quick Create & Add Card -->
              <div class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
                <button
                  type="button"
                  class="w-full px-4 py-3.5 bg-transparent border-0 flex items-center gap-3 text-left am-tap"
                  @click="echoSystem.haptic('selection'); creatingOpen = !creatingOpen"
                >
                  <div class="w-11 h-11 rounded-[11px] am-accent-bg/14 am-accent-text flex items-center justify-center shrink-0">
                    <Icon :icon="iconPlus" class="w-5.5 h-5.5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[15px] font-semibold am-accent-text">{{ t('playlist.createAndAdd') }}</div>
                    <div class="text-[11.5px] text-[var(--text-secondary)] mt-0.5">{{ t('playlist.createTitle') }}</div>
                  </div>
                </button>

                <form
                  v-if="creatingOpen"
                  class="px-4 pb-4 pt-1 space-y-3 am-hairline-t"
                  @submit.prevent="handleCreateAndAdd"
                >
                  <input
                    v-model="newName"
                    type="text"
                    maxlength="40"
                    :placeholder="t('playlist.namePlaceholder')"
                    class="w-full h-10 px-3.5 rounded-xl bg-[var(--bg-subtle)] text-[14px] text-[var(--text-primary)] border-0 outline-none"
                  />
                  <div class="flex items-center justify-between gap-2">
                    <label class="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer select-none">
                      <input v-model="newPrivate" type="checkbox" class="accent-[var(--accent)] w-4 h-4" />
                      <span>{{ t('playlist.privateToggle') }}</span>
                    </label>
                    <button
                      type="submit"
                      class="px-4 h-9 rounded-full am-accent-bg text-white text-[13px] font-semibold border-0 inline-flex items-center gap-1 am-tap disabled:opacity-45"
                      :disabled="creatingAndAdding || !newName.trim()"
                    >
                      <Icon :icon="iconCheck" class="w-4 h-4" />
                      <span>{{ creatingAndAdding ? t('common.loading') : t('playlist.createConfirm') }}</span>
                    </button>
                  </div>
                </form>
              </div>

              <!-- Loading State -->
              <div
                v-if="playlistsStore.loading && !playlistsStore.editablePlaylists.length"
                class="py-10 text-center text-[13.5px] text-[var(--text-secondary)]"
              >
                {{ t('common.loading') }}
              </div>

              <!-- User's Editable Playlists List -->
              <div
                v-else
                class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs"
              >
                <button
                  v-for="pl in playlistsStore.editablePlaylists"
                  :key="pl.id"
                  type="button"
                  class="w-full px-4 py-3 bg-transparent border-0 flex items-center gap-3 text-left am-tap disabled:opacity-55"
                  :disabled="Boolean(submittingId) || creatingAndAdding"
                  @click="handlePickPlaylist(pl)"
                >
                  <div class="w-12 h-12 rounded-[10px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-xs flex items-center justify-center">
                    <div
                      v-if="pl.isFavorite && !pl.coverUrl"
                      class="w-full h-full am-accent-bg text-white flex items-center justify-center"
                    >
                      <Icon :icon="iconHeartFilled" class="w-5 h-5" />
                    </div>
                    <PlaylistCover
                      v-else
                      :playlist-key="getPlaylistCacheKey(pl)"
                      :cover-url="pl.coverUrl"
                      :alt="pl.name"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="text-[15px] font-semibold text-[var(--text-primary)] truncate">
                        {{ pl.isFavorite ? t('library.favorites') : pl.name }}
                      </span>
                      <Icon v-if="pl.isPrivate" :icon="iconLock" class="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
                    </div>
                    <div class="text-[12px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                      {{ t('common.songsCount', { count: pl.trackCount }) }}
                    </div>
                  </div>
                  <span
                    v-if="submittingId === pl.id"
                    class="text-[12px] font-semibold am-accent-text shrink-0"
                  >
                    {{ t('common.loading') }}
                  </span>
                  <Icon
                    v-else
                    :icon="iconPlus"
                    class="w-4.5 h-4.5 text-[var(--text-tertiary)] shrink-0"
                  />
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
