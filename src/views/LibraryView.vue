<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconClock from '@iconify/icons-tabler/clock';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconPlus from '@iconify/icons-tabler/plus';
import iconDots from '@iconify/icons-tabler/dots';
import iconLock from '@iconify/icons-tabler/lock';
import iconEdit from '@iconify/icons-tabler/edit';
import iconTrash from '@iconify/icons-tabler/trash';
import iconX from '@iconify/icons-tabler/x';
import type { PlaylistSummary } from '@/types/music';
import { getPlaylistCacheKey } from '@/services/playback/playlistCoverResolver';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { usePlaylistsStore } from '@/stores/playlists';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useCollapsingTitle } from '@/composables/useCollapsingTitle';
import { echoSystem } from '@/native/echoSystem';
import AvatarButton from '@/components/AvatarButton.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const playlistsStore = usePlaylistsStore();
const ui = useUiStore();
const { t } = useI18n();
const { largeTitleOpacity, compactTitleOpacity, headerGlassActive, onScroll } = useCollapsingTitle();

const favoritePlaylist = computed(() => playlistsStore.favoritePlaylist);
const createdPlaylists = computed(() => playlistsStore.createdPlaylists);
const collectedPlaylists = computed(() => playlistsStore.collectedPlaylists);

// Create / Edit Playlist modal state
const editorOpen = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editingPlaylist = ref<PlaylistSummary | null>(null);
const editorName = ref('');
const editorIntro = ref('');
const editorPrivate = ref(false);
const editorSubmitting = ref(false);

// Per-playlist manage sheet state
const managingPlaylist = ref<PlaylistSummary | null>(null);
const confirmingDelete = ref(false);
const deleting = ref(false);

function openPlaylist(pl: PlaylistSummary) {
  void router.push({
    path: `/playlist/${encodeURIComponent(pl.globalCollectionId || pl.id)}`,
    query: {
      name: pl.name,
      cover: pl.coverUrl,
      count: String(pl.trackCount),
      listId: pl.listId || '',
      favorite: pl.isFavorite ? '1' : '0',
      owner: pl.isOwner === false ? '0' : '1',
      intro: pl.description || '',
      createUserId: pl.createUserId || '',
      createListId: pl.createListId || '',
    },
  });
}

function openCreateModal() {
  echoSystem.haptic('light');
  editorMode.value = 'create';
  editingPlaylist.value = null;
  editorName.value = '';
  editorIntro.value = '';
  editorPrivate.value = false;
  editorOpen.value = true;
}

function openManageSheet(pl: PlaylistSummary) {
  echoSystem.haptic('light');
  confirmingDelete.value = false;
  managingPlaylist.value = pl;
}

function openEditFromManage() {
  const pl = managingPlaylist.value;
  if (!pl) return;
  managingPlaylist.value = null;
  editorMode.value = 'edit';
  editingPlaylist.value = pl;
  editorName.value = pl.name;
  editorIntro.value = pl.description || '';
  editorPrivate.value = Boolean(pl.isPrivate);
  editorOpen.value = true;
}

async function submitEditor() {
  const cleanName = editorName.value.trim();
  if (!cleanName || editorSubmitting.value) return;
  echoSystem.haptic('medium');
  editorSubmitting.value = true;
  try {
    if (editorMode.value === 'create') {
      await playlistsStore.createPlaylist({
        name: cleanName,
        isPrivate: editorPrivate.value,
      });
      echoSystem.haptic('success');
      ui.showToast(t('playlist.createdToast', { name: cleanName }));
      editorOpen.value = false;
    } else if (editingPlaylist.value) {
      const target = editingPlaylist.value;
      await playlistsStore.updatePlaylist({
        listId: target.listId || target.id,
        name: cleanName,
        intro: editorIntro.value.trim(),
        totalVer: target.totalVer,
      });
      echoSystem.haptic('success');
      ui.showToast(t('playlist.updatedToast'));
      editorOpen.value = false;
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    editorSubmitting.value = false;
  }
}

async function confirmDeletePlaylist() {
  const pl = managingPlaylist.value;
  if (!pl || deleting.value) return;
  echoSystem.haptic('medium');
  deleting.value = true;
  try {
    await playlistsStore.deletePlaylist(pl);
    echoSystem.haptic('success');
    const toastKey = pl.isOwner === false ? 'playlist.uncollectedToast' : 'playlist.deletedToast';
    ui.showToast(t(toastKey, { name: pl.name }));
    managingPlaylist.value = null;
    confirmingDelete.value = false;
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    deleting.value = false;
  }
}

onMounted(() => void playlistsStore.fetchPlaylists(true));
watch(() => accounts.activeAccount?.userid, () => void playlistsStore.fetchPlaylists(true));
</script>

<template>
  <div class="h-full flex flex-col relative">
    <!-- Zero-Overlap Collapsing Sticky Header -->
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive }">
      <div class="flex items-center justify-between h-11 px-5">
        <span
          class="text-[17px] font-bold tracking-tight text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: compactTitleOpacity }"
        >
          {{ t('library.title') }}
        </span>
        <AvatarButton />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-48" @scroll.passive="onScroll">
      <div class="px-5 pt-[calc(var(--safe-top)+48px)] pb-3">
        <h1
          class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]"
          :style="{ opacity: largeTitleOpacity }"
        >
          {{ t('library.title') }}
        </h1>
      </div>

      <!-- Apple Music Category List -->
      <div class="px-5 mt-1 divide-y divide-[var(--hairline)] am-hairline-t am-hairline-b">
        <button
          v-if="favoritePlaylist"
          type="button"
          class="lib-cat-row am-tap"
          @click="openPlaylist(favoritePlaylist)"
        >
          <div class="flex items-center gap-3.5">
            <Icon :icon="iconHeartFilled" class="w-6 h-6 am-accent-text" />
            <span class="text-[18px] font-normal text-[var(--text-primary)]">{{ t('library.favorites') }}</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ favoritePlaylist.trackCount }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>

        <!-- Navigates to /recent full list instead of auto-playing! -->
        <button
          type="button"
          class="lib-cat-row am-tap"
          @click="router.push('/recent')"
        >
          <div class="flex items-center gap-3.5">
            <Icon :icon="iconClock" class="w-6 h-6 am-accent-text" />
            <span class="text-[18px] font-normal text-[var(--text-primary)]">{{ t('library.recent') }}</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ player.recentPlays.length }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>
      </div>

      <div v-if="!accounts.isLoggedIn" class="px-5 py-12 text-center">
        <p class="text-[15px] text-[var(--text-secondary)]">{{ t('library.loginPrompt') }}</p>
        <button
          type="button"
          class="mt-4 px-6 h-10 rounded-full am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
          @click="ui.loginModalOpen = true"
        >
          {{ t('home.loginNow') }}
        </button>
      </div>

      <template v-else>
        <!-- Created Playlists Section with + New Playlist Button -->
        <section class="px-5 mt-6">
          <div class="flex items-center justify-between gap-2 mb-3.5">
            <h2 class="text-[21px] font-bold tracking-tight text-[var(--text-primary)] m-0">
              {{ t('playlist.createdSection') }}
            </h2>
            <button
              type="button"
              class="h-8 px-3 rounded-full bg-[var(--bg-subtle)] am-accent-text text-[12.5px] font-semibold border-0 inline-flex items-center gap-1 am-tap shrink-0"
              @click="openCreateModal"
            >
              <Icon :icon="iconPlus" class="w-3.5 h-3.5" />
              <span>{{ t('playlist.newBtn') }}</span>
            </button>
          </div>

          <div v-if="playlistsStore.loading && !playlistsStore.playlists.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <div v-for="i in 4" :key="i">
              <div class="aspect-square rounded-[14px] bg-[var(--bg-subtle)] animate-pulse" />
              <div class="h-3.5 w-24 rounded bg-[var(--bg-subtle)] mt-2 animate-pulse" />
            </div>
          </div>

          <div v-else-if="createdPlaylists.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-5">
            <div
              v-for="pl in createdPlaylists"
              :key="pl.id"
              class="cursor-pointer min-w-0"
              @click="openPlaylist(pl)"
            >
              <div class="relative aspect-square rounded-[14px] overflow-hidden shadow-sm am-tap">
                <PlaylistCover
                  :playlist-key="getPlaylistCacheKey(pl)"
                  :cover-url="pl.coverUrl"
                  :alt="pl.name"
                />
                <span
                  v-if="pl.isPrivate"
                  class="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/52 backdrop-blur-md text-white text-[10px] font-semibold inline-flex items-center gap-0.5"
                >
                  <Icon :icon="iconLock" class="w-3 h-3" />
                  <span>{{ t('playlist.privateBadge') }}</span>
                </span>
                <button
                  type="button"
                  class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/48 backdrop-blur-md text-white border-0 flex items-center justify-center am-tap"
                  :aria-label="t('playlist.renameBtn')"
                  @click.stop="openManageSheet(pl)"
                >
                  <Icon :icon="iconDots" class="w-4 h-4" />
                </button>
              </div>
              <div class="text-[15px] font-medium text-[var(--text-primary)] truncate mt-2 leading-snug">
                {{ pl.name }}
              </div>
              <div class="text-[13px] text-[var(--text-secondary)] truncate tabular-nums">
                {{ t('common.songsCount', { count: pl.trackCount }) }}
              </div>
            </div>
          </div>

          <div
            v-else
            class="rounded-[18px] bg-[var(--bg-card)] px-4 py-6 text-center text-[13.5px] text-[var(--text-secondary)] shadow-xs"
          >
            {{ t('playlist.createTitle') }}
          </div>
        </section>

        <!-- Collected Playlists Section (shown only when non-empty) -->
        <section v-if="collectedPlaylists.length" class="px-5 mt-8">
          <h2 class="text-[21px] font-bold tracking-tight text-[var(--text-primary)] mb-3.5">
            {{ t('playlist.collectedSection') }}
          </h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-5">
            <div
              v-for="pl in collectedPlaylists"
              :key="pl.id"
              class="cursor-pointer min-w-0"
              @click="openPlaylist(pl)"
            >
              <div class="relative aspect-square rounded-[14px] overflow-hidden shadow-sm am-tap">
                <PlaylistCover
                  :playlist-key="getPlaylistCacheKey(pl)"
                  :cover-url="pl.coverUrl"
                  :alt="pl.name"
                />
                <button
                  type="button"
                  class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/48 backdrop-blur-md text-white border-0 flex items-center justify-center am-tap"
                  :aria-label="t('playlist.uncollectBtn')"
                  @click.stop="openManageSheet(pl)"
                >
                  <Icon :icon="iconDots" class="w-4 h-4" />
                </button>
              </div>
              <div class="text-[15px] font-medium text-[var(--text-primary)] truncate mt-2 leading-snug">
                {{ pl.name }}
              </div>
              <div class="text-[13px] text-[var(--text-secondary)] truncate tabular-nums">
                {{ t('common.songsCount', { count: pl.trackCount }) }}
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- Create / Edit Playlist Modal -->
    <Transition name="lg-modal">
      <div
        v-if="editorOpen"
        class="fixed inset-0 z-[95] flex items-center justify-center p-5 lg-scrim"
        @click="!editorSubmitting && (editorOpen = false)"
      >
        <div
          class="w-full max-w-[360px] rounded-[26px] lg-sheet-panel p-5 space-y-4 shadow-2xl"
          @click.stop
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-[17px] font-bold text-[var(--text-primary)] m-0">
              {{ editorMode === 'create' ? t('playlist.newBtn') : t('playlist.editTitle') }}
            </h3>
            <button
              type="button"
              class="w-7.5 h-7.5 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
              :aria-label="t('common.close')"
              @click="!editorSubmitting && (editorOpen = false)"
            >
              <Icon :icon="iconX" class="w-4 h-4" />
            </button>
          </div>

          <form class="space-y-3" @submit.prevent="submitEditor">
            <input
              v-model="editorName"
              type="text"
              maxlength="40"
              :placeholder="t('playlist.namePlaceholder')"
              class="w-full h-11 px-3.5 rounded-2xl bg-[var(--bg-subtle)] text-[14.5px] text-[var(--text-primary)] border-0 outline-none"
            />

            <textarea
              v-if="editorMode === 'edit'"
              v-model="editorIntro"
              rows="3"
              maxlength="200"
              :placeholder="t('playlist.introPlaceholder')"
              class="w-full p-3.5 rounded-2xl bg-[var(--bg-subtle)] text-[13.5px] text-[var(--text-primary)] border-0 outline-none resize-none"
            />

            <label
              v-if="editorMode === 'create'"
              class="flex items-center justify-between rounded-2xl bg-[var(--bg-card)] px-3.5 py-2.5 cursor-pointer select-none"
            >
              <div>
                <div class="text-[14px] font-semibold text-[var(--text-primary)]">{{ t('playlist.privateToggle') }}</div>
                <div class="text-[11.5px] text-[var(--text-secondary)]">{{ t('playlist.privateSub') }}</div>
              </div>
              <input v-model="editorPrivate" type="checkbox" class="accent-[var(--accent)] w-4.5 h-4.5" />
            </label>

            <div class="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                class="h-10.5 rounded-2xl bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
                :disabled="editorSubmitting"
                @click="editorOpen = false"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                class="h-10.5 rounded-2xl am-accent-bg text-white text-[14px] font-semibold border-0 am-tap disabled:opacity-45"
                :disabled="editorSubmitting || !editorName.trim()"
              >
                {{
                  editorSubmitting
                    ? t('common.loading')
                    : editorMode === 'create'
                      ? t('playlist.createConfirm')
                      : t('playlist.saveConfirm')
                }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Per-Playlist Manage Bottom Sheet -->
    <Transition name="lg-modal">
      <div
        v-if="managingPlaylist"
        class="fixed inset-0 z-[94] flex flex-col justify-end lg-scrim"
        @click="!deleting && (managingPlaylist = null)"
      >
        <div class="lg-sheet-slide" @click.stop>
          <div class="lg-sheet-panel rounded-t-[28px] px-4 pt-3 pb-[calc(var(--safe-bottom)+18px)] space-y-3">
            <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />

            <div class="flex items-center gap-3 px-1 pb-2 am-hairline-b">
              <div class="w-12 h-12 rounded-[10px] overflow-hidden shadow-xs shrink-0">
                <PlaylistCover
                  :playlist-key="getPlaylistCacheKey(managingPlaylist)"
                  :cover-url="managingPlaylist.coverUrl"
                  :alt="managingPlaylist.name"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[15.5px] font-bold text-[var(--text-primary)] truncate">
                  {{ managingPlaylist.name }}
                </div>
                <div class="text-[12px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                  {{ t('common.songsCount', { count: managingPlaylist.trackCount }) }}
                </div>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                @click="!deleting && (managingPlaylist = null)"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>

            <div v-if="!confirmingDelete" class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
              <button
                v-if="managingPlaylist.isOwner !== false"
                type="button"
                class="manage-item am-tap"
                @click="openEditFromManage"
              >
                <span>{{ t('playlist.renameBtn') }}</span>
                <Icon :icon="iconEdit" class="w-5 h-5 text-[var(--text-secondary)]" />
              </button>
              <button
                type="button"
                class="manage-item am-tap text-[#ff3b30]"
                @click="echoSystem.haptic('selection'); confirmingDelete = true"
              >
                <span class="font-semibold text-[#ff3b30]">
                  {{ managingPlaylist.isOwner === false ? t('playlist.uncollectBtn') : t('playlist.deleteBtn') }}
                </span>
                <Icon :icon="iconTrash" class="w-5 h-5 text-[#ff3b30]" />
              </button>
            </div>

            <!-- Inline Delete / Uncollect Confirmation -->
            <div v-else class="rounded-[20px] bg-[var(--bg-card)] p-4 space-y-3 shadow-xs">
              <p class="text-[13.5px] text-[var(--text-primary)] leading-relaxed m-0">
                {{
                  managingPlaylist.isOwner === false
                    ? t('playlist.uncollectConfirm', { name: managingPlaylist.name })
                    : t('playlist.deleteConfirm', { name: managingPlaylist.name })
                }}
              </p>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  class="h-10 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
                  :disabled="deleting"
                  @click="confirmingDelete = false"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="h-10 rounded-xl bg-[#ff3b30] text-white text-[14px] font-semibold border-0 am-tap disabled:opacity-50"
                  :disabled="deleting"
                  @click="confirmDeletePlaylist"
                >
                  {{
                    deleting
                      ? t('common.loading')
                      : managingPlaylist.isOwner === false
                        ? t('playlist.uncollectBtn')
                        : t('playlist.deleteBtn')
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.sticky-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  padding-top: var(--safe-top);
  transition: background-color 200ms ease;
}

.lib-cat-row {
  width: 100%;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
}

.manage-item {
  width: 100%;
  height: 50px;
  padding: 0 16px;
  background: transparent;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}
</style>
