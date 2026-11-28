<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconHome from '@iconify/icons-tabler/home';
import iconPlaylist from '@iconify/icons-tabler/books';
import iconSearch from '@iconify/icons-tabler/search';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import MiniPlayerPill from '@/components/MiniPlayerPill.vue';
import AvatarButton from '@/components/AvatarButton.vue';
import PureToneMark from '@/components/PureToneMark.vue';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const { t } = useI18n();

const activeTab = computed(() => String(route.meta?.tab || 'home'));
const transitionName = ref<'ios-push' | 'ios-pop' | 'ios-tab'>('ios-tab');

const removeBeforeEach = router.beforeEach((to, from) => {
  if (to.fullPath !== from.fullPath && ui.batchDockActive) {
    ui.setBatchDock(false);
  }
  const toDepth = Number(to.meta?.depth ?? 0);
  const fromDepth = Number(from.meta?.depth ?? 0);
  if (toDepth > fromDepth) {
    transitionName.value = 'ios-push';
  } else if (toDepth < fromDepth) {
    transitionName.value = 'ios-pop';
  } else {
    transitionName.value = 'ios-tab';
  }
});

onUnmounted(() => {
  removeBeforeEach();
});

const tabs = computed(() => [
  { id: 'home', path: '/home', label: t('nav.home'), icon: iconHome },
  { id: 'library', path: '/library', label: t('nav.library'), icon: iconPlaylist },
  { id: 'search', path: '/search', label: t('nav.search'), icon: iconSearch },
]);

const activeTabIndex = computed(() => {
  const idx = tabs.value.findIndex((tItem) => tItem.id === activeTab.value);
  return idx >= 0 ? idx : 0;
});

function goTab(path: string) {
  echoSystem.haptic('selection');
  if (route.path !== path) void router.push(path);
}
</script>

<template>
  <div class="shell-stage">
    <div class="shell-root">
      <!-- Tablet / Landscape iPadOS-style Liquid Glass Sidebar (>= 768px) -->
      <aside class="tablet-sidebar am-glass hidden md:flex flex-col">
        <div class="pt-[calc(var(--safe-top)+18px)] px-4 pb-4 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <PureToneMark :size="30" />
            <span class="text-[19px] font-bold tracking-tight text-[var(--text-primary)]">{{ t('app.name') }}</span>
          </div>
          <AvatarButton />
        </div>

        <nav class="px-3 space-y-1 flex-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="w-full h-11 px-3 rounded-2xl flex items-center gap-3 border-0 text-[15px] font-semibold transition-all am-tap"
            :class="
              activeTab === tab.id
                ? 'bg-[var(--bg-subtle)] am-accent-text'
                : 'bg-transparent text-[var(--text-primary)]'
            "
            @click="goTab(tab.path)"
          >
            <Icon :icon="tab.icon" class="w-5 h-5" />
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </aside>

      <!-- Main Viewport with Directional iOS 26 Transitions -->
      <main class="flex-1 min-w-0 h-full relative overflow-hidden bg-[var(--bg-canvas)]">
        <router-view v-slot="{ Component, route: currentRoute }">
          <Transition :name="transitionName">
            <KeepAlive include="HomeView,LibraryView,SearchView">
              <component :is="Component" :key="currentRoute.meta?.depth ? currentRoute.fullPath : String(currentRoute.name)" class="page-layer" />
            </KeepAlive>
          </Transition>
        </router-view>

        <!-- Bottom subtle fade mask so scrolled content melts smoothly behind Liquid Glass capsules -->
        <div class="bottom-veil md:hidden pointer-events-none" :class="{ 'is-dock-hidden': ui.batchDockActive }" />

        <!-- Floating iOS 26 Liquid Glass MiniPlayer Pill -->
        <div class="mini-holder" :class="{ 'is-dock-hidden': ui.batchDockActive }">
          <Transition name="am-dock-slide">
            <MiniPlayerPill />
          </Transition>
        </div>

        <!-- Floating iOS 26 Liquid Glass Capsule Tab Bar (< 768px) -->
        <div class="tabbar-holder md:hidden" :class="{ 'is-dock-hidden': ui.batchDockActive }">
          <nav class="lg-tabbar lg-capsule" aria-label="Main Navigation">
            <!-- Animated Sliding Liquid Glass Lens Indicator -->
            <div
              class="lg-tab-indicator"
              :style="{ transform: `translate3d(${activeTabIndex * 100}%, 0, 0)` }"
            >
              <div class="lg-tab-indicator-inner" />
            </div>

            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="tab-btn"
              :class="activeTab === tab.id ? 'am-accent-text is-active' : 'text-[var(--text-secondary)]'"
              @click="goTab(tab.path)"
            >
              <Icon :icon="tab.icon" class="w-[22px] h-[22px] transition-transform duration-200" />
              <span class="text-[10px] font-semibold mt-0.5 tracking-tight">{{ tab.label }}</span>
            </button>
          </nav>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell-stage {
  width: 100%;
  height: 100%;
  background: var(--bg-grouped);
  overflow: hidden;
}

.dark .shell-stage {
  background: #000000;
}

.shell-root {
  width: 100%;
  height: 100%;
  display: flex;
  background-color: var(--bg-canvas);
}

.page-layer {
  width: 100%;
  height: 100%;
  background-color: var(--bg-canvas);
}

.tablet-sidebar {
  width: 240px;
  height: 100%;
  flex-shrink: 0;
  border-right: 0.5px solid var(--hairline);
}

.bottom-veil {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--tabbar-height) + var(--safe-bottom) + 92px);
  z-index: 24;
  background: linear-gradient(
    to top,
    var(--bg-canvas) 0%,
    transparent 100%
  );
  transition: opacity 260ms ease;
}

.bottom-veil.is-dock-hidden {
  opacity: 0;
}

.mini-holder {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + 20px);
  z-index: 35;
  transition:
    transform 380ms var(--spring-ease),
    opacity 220ms ease;
  will-change: transform, opacity;
}

.mini-holder.is-dock-hidden {
  transform: translate3d(0, calc(100% + 120px), 0) scale(0.94);
  opacity: 0;
  pointer-events: none;
}

@media (min-width: 768px) {
  .mini-holder {
    left: 20px;
    right: 20px;
    bottom: calc(var(--safe-bottom) + 16px);
    max-width: 680px;
    margin: 0 auto;
  }
}

.tabbar-holder {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: calc(var(--safe-bottom) + 10px);
  z-index: 32;
  display: flex;
  justify-content: center;
  transition:
    transform 380ms var(--spring-ease),
    opacity 220ms ease;
  will-change: transform, opacity;
}

.tabbar-holder.is-dock-hidden {
  transform: translate3d(0, calc(100% + 48px), 0) scale(0.95);
  opacity: 0;
  pointer-events: none;
}

.lg-tabbar {
  position: relative;
  width: 100%;
  max-width: 380px;
  height: var(--tabbar-height);
  border-radius: 999px;
  padding: 4px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

.lg-tab-indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / 3);
  padding: 1px;
  pointer-events: none;
  transition: transform 380ms var(--spring-ease);
}

.lg-tab-indicator-inner {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--lg-active-pill);
  box-shadow: var(--lg-active-pill-shadow);
}

.tab-btn {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  padding: 2px 0;
  transition: color 220ms ease, transform 180ms var(--spring-ease);
}

.tab-btn:active {
  transform: scale(0.93);
}

.tab-btn.is-active svg {
  transform: scale(1.06);
}
</style>
