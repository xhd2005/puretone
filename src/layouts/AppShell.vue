<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconHome from '@iconify/icons-tabler/home';
import iconPlaylist from '@iconify/icons-tabler/books';
import iconSearch from '@iconify/icons-tabler/search';
import MiniPlayerPill from '@/components/MiniPlayerPill.vue';
import AvatarButton from '@/components/AvatarButton.vue';

const route = useRoute();
const router = useRouter();

const activeTab = computed(() => String(route.meta?.tab || 'home'));

const tabs = [
  { id: 'home', path: '/home', label: '主页', icon: iconHome, activeIcon: iconHome },
  { id: 'library', path: '/library', label: '资料库', icon: iconPlaylist, activeIcon: iconPlaylist },
  { id: 'search', path: '/search', label: '搜索', icon: iconSearch, activeIcon: iconSearch },
];

function goTab(path: string) {
  if (route.path !== path) void router.push(path);
}
</script>

<template>
  <div class="shell-root">
    <!-- Tablet / Landscape iPadOS-style Sidebar (>= 768px) -->
    <aside class="tablet-sidebar am-glass am-hairline-b hidden md:flex flex-col">
      <div class="pt-[calc(var(--safe-top)+18px)] px-4 pb-4 flex items-center justify-between">
        <span class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">EchoMusic</span>
        <AvatarButton />
      </div>

      <nav class="px-3 space-y-1 flex-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="w-full h-11 px-3 rounded-xl flex items-center gap-3 border-0 text-[15px] font-semibold transition-colors am-tap"
          :class="
            activeTab === tab.id
              ? 'bg-[var(--bg-subtle)] am-accent-text'
              : 'bg-transparent text-[var(--text-primary)]'
          "
          @click="goTab(tab.path)"
        >
          <Icon :icon="activeTab === tab.id ? tab.activeIcon : tab.icon" class="w-5 h-5" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </aside>

    <!-- Main Viewport -->
    <main class="flex-1 min-w-0 h-full relative overflow-hidden">
      <router-view v-slot="{ Component }">
        <KeepAlive include="HomeView,LibraryView,SearchView">
          <component :is="Component" />
        </KeepAlive>
      </router-view>

      <!-- Floating Apple Music MiniPlayer Pill -->
      <div class="mini-holder">
        <MiniPlayerPill />
      </div>

      <!-- Mobile 3-Tab Frosted Glass Bottom Bar (< 768px) -->
      <nav class="mobile-tabbar am-glass md:hidden" aria-label="主导航">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab-btn am-tap"
          :class="activeTab === tab.id ? 'am-accent-text' : 'text-[var(--text-secondary)]'"
          @click="goTab(tab.path)"
        >
          <Icon :icon="activeTab === tab.id ? tab.activeIcon : tab.icon" class="w-[24px] h-[24px]" />
          <span class="text-[10px] font-semibold mt-0.5 tracking-tight">{{ tab.label }}</span>
        </button>
      </nav>
    </main>
  </div>
</template>

<style scoped>
.shell-root {
  width: 100%;
  height: 100%;
  display: flex;
  background-color: var(--bg-canvas);
}

.tablet-sidebar {
  width: 240px;
  height: 100%;
  flex-shrink: 0;
  border-right: 0.5px solid var(--hairline);
}

.mini-holder {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + 10px);
  z-index: 35;
}

@media (min-width: 768px) {
  .mini-holder {
    left: 20px;
    right: 20px;
    bottom: calc(var(--safe-bottom) + 14px);
    max-width: 680px;
    margin: 0 auto;
  }
}

.mobile-tabbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  height: calc(var(--tabbar-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 0.5px solid var(--hairline);
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
}

.tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 4px 0;
}
</style>
