<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconTrash from '@iconify/icons-tabler/trash';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconShare from '@iconify/icons-tabler/share-2';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconAlertTriangle from '@iconify/icons-tabler/alert-triangle';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconDownload from '@iconify/icons-tabler/download';
import iconSettings from '@iconify/icons-tabler/settings';
import iconX from '@iconify/icons-tabler/x';
import iconCode from '@iconify/icons-tabler/code';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import { usePluginsStore } from '@/stores/plugins';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { parseMeluneExtensionDeepLink } from '@/services/plugins/deepLink';
import { PLUGIN_CATEGORIES, resolvePluginVisual } from '@/services/plugins/pluginUiMeta';
import {
  DEFAULT_PLUGIN_REGISTRY_REPO,
  type MelunePanelBadge,
  type MelunePluginCategory,
  type MelunePluginManifest,
} from '@/services/plugins/types';

const props = withDefaults(
  defineProps<{
    visible?: boolean;
  }>(),
  { visible: true },
);

const plugins = usePluginsStore();
const ui = useUiStore();
const { t } = useI18n();

type HubSubTab = 'installed' | 'store';
const activeSubTab = ref<HubSubTab>('installed');
const selectedCategory = ref<'all' | MelunePluginCategory>('all');
const showMenuPanel = ref(false);
const sourceInput = ref('');
const adding = ref(false);
const checkingAll = ref(false);

interface StoreItem {
  manifest: MelunePluginManifest;
  registryUrl: string;
  registryName: string;
}

const allStoreItems = computed<StoreItem[]>(() => {
  const seen = new Map<string, StoreItem>();
  for (const reg of plugins.registries) {
    for (const plg of reg.plugins) {
      if (!seen.has(plg.id)) {
        seen.set(plg.id, { manifest: plg, registryUrl: reg.url, registryName: reg.name });
      }
    }
  }
  return Array.from(seen.values());
});

const featuredCatalog = computed<StoreItem[]>(() => {
  const explicit = allStoreItems.value.filter((item) => item.manifest.featured);
  return explicit.length ? explicit : allStoreItems.value.slice(0, 3);
});

const storeCatalog = computed<StoreItem[]>(() => {
  if (selectedCategory.value === 'all') return allStoreItems.value;
  return allStoreItems.value.filter((item) => (item.manifest.category || 'utility') === selectedCategory.value);
});

function syncInitialTab() {
  if (!plugins.installed.length && activeSubTab.value === 'installed') {
    activeSubTab.value = 'store';
  }
}

watch(
  () => props.visible,
  (isVis) => {
    if (isVis) {
      syncInitialTab();
      void plugins.syncRegistriesIfStale();
    }
  },
);

onMounted(() => {
  if (props.visible) {
    syncInitialTab();
    void plugins.syncRegistriesIfStale();
  }
});

function switchSubTab(next: HubSubTab) {
  if (activeSubTab.value === next) return;
  echoSystem.haptic('selection');
  activeSubTab.value = next;
  if (next === 'store') {
    void plugins.syncRegistriesIfStale();
  }
}

async function handleCheckAllUpdates() {
  if (checkingAll.value) return;
  echoSystem.haptic('light');
  checkingAll.value = true;
  try {
    const res = await plugins.refreshAllRegistries();
    if (res.updatesCount > 0) {
      ui.showToast(`发现 ${res.updatesCount} 款插件可独立热更新`);
    } else if (res.syncedCount > 0) {
      ui.showToast('全部插件已是最新版本');
    } else {
      ui.showToast('暂无可同步的扩展源');
    }
  } finally {
    checkingAll.value = false;
  }
}

async function handleUpdateAll() {
  echoSystem.haptic('light');
  await plugins.updateAllAvailablePlugins();
}

async function handleImportSource() {
  const raw = sourceInput.value.trim();
  if (!raw || adding.value) return;
  echoSystem.haptic('light');
  adding.value = true;
  try {
    if (parseMeluneExtensionDeepLink(raw)) {
      const ok = await plugins.handleDeepLinkUri(raw);
      if (ok) {
        sourceInput.value = '';
        showMenuPanel.value = false;
      }
      return;
    }
    const saved = await plugins.addOrRefreshRegistry(raw);
    sourceInput.value = '';
    echoSystem.haptic('success');
    ui.showToast(`已导入源「${saved.name}」（${saved.plugins.length} 款）`);
    activeSubTab.value = 'store';
  } catch (err: any) {
    ui.showToast(err?.message || '导入插件源失败', 3200);
  } finally {
    adding.value = false;
  }
}

async function handleRestoreDefault() {
  echoSystem.haptic('light');
  try {
    const saved = await plugins.restoreDefaultRegistry();
    echoSystem.haptic('success');
    ui.showToast(`已恢复官方精选源（${saved.plugins.length} 款）`);
    activeSubTab.value = 'store';
  } catch (err: any) {
    ui.showToast(err?.message || '恢复官方源失败', 3000);
  }
}

async function handleRefreshRegistry(url: string) {
  echoSystem.haptic('light');
  try {
    const saved = await plugins.addOrRefreshRegistry(url);
    ui.showToast(`已同步「${saved.name}」`);
  } catch (err: any) {
    ui.showToast(err?.message || '同步失败', 3000);
  }
}

function handleStoreAction(item: StoreItem) {
  echoSystem.haptic('light');
  const local = plugins.getInstalledPlugin(item.manifest.id);
  const update = plugins.getAvailableUpdate(item.manifest.id);
  if (local && !update) {
    plugins.openPluginDetail(local.manifest.id);
    return;
  }
  plugins.requestInstallReview(item.manifest, item.registryUrl, item.registryName);
}

function handleQuickUpdate(pluginId: string) {
  echoSystem.haptic('light');
  const up = plugins.getAvailableUpdate(pluginId);
  if (up) {
    plugins.requestInstallReview(up.manifest, up.registryUrl, up.registryName);
  }
}

function badgeClass(tone?: MelunePanelBadge['tone']): string {
  if (tone === 'success') return 'bg-[#34c759]/14 text-[#239941]';
  if (tone === 'warning') return 'bg-[#ff9500]/14 text-[#c97200]';
  if (tone === 'accent') return 'bg-[var(--bg-subtle)] am-accent-text';
  return 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]';
}

function fallbackSubtitle(id: string, enabled: boolean): string {
  if (plugins.safeMode) return t('plugins.pausedSafeMode');
  if (!enabled) return t('plugins.disabledState');
  const st = plugins.getStatus(id);
  if (st.lastError) return st.lastError;
  if (st.hasPanel) return t('plugins.tapToOpenPanel');
  return t('plugins.activeBackground');
}
</script>

<template>
  <div class="space-y-4" data-plugin-hub>
    <!-- Ultra-Clean App Store Top Bar -->
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0 rounded-full bg-[var(--bg-card)] p-1 grid grid-cols-2 shadow-xs">
        <button
          type="button"
          class="h-8.5 rounded-full text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 transition-colors"
          :class="
            activeSubTab === 'installed'
              ? 'am-accent-bg text-white shadow-xs'
              : 'bg-transparent text-[var(--text-secondary)]'
          "
          @click="switchSubTab('installed')"
        >
          <span>{{ t('plugins.tabInstalled') }}</span>
          <span v-if="plugins.installed.length" class="text-[11px] tabular-nums opacity-85">
            {{ plugins.installed.length }}
          </span>
          <span
            v-if="plugins.availableUpdatesCount > 0"
            class="w-1.5 h-1.5 rounded-full bg-[#ff3b30] shrink-0"
          />
        </button>

        <button
          type="button"
          class="h-8.5 rounded-full text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 transition-colors"
          :class="
            activeSubTab === 'store'
              ? 'am-accent-bg text-white shadow-xs'
              : 'bg-transparent text-[var(--text-secondary)]'
          "
          @click="switchSubTab('store')"
        >
          <span>{{ t('plugins.tabStore') }}</span>
        </button>
      </div>

      <button
        type="button"
        class="w-10 h-10 rounded-full bg-[var(--bg-card)] shadow-xs border-0 flex items-center justify-center text-[var(--text-primary)] relative shrink-0 am-tap"
        :disabled="checkingAll || plugins.defaultLoading"
        :aria-label="t('plugins.checkUpdates')"
        @click="handleCheckAllUpdates"
      >
        <Icon
          :icon="iconRefresh"
          class="w-4.5 h-4.5"
          :class="{ 'animate-spin': checkingAll || plugins.defaultLoading }"
        />
        <span
          v-if="plugins.availableUpdatesCount > 0"
          class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#ff3b30]"
        />
      </button>

      <button
        type="button"
        class="w-10 h-10 rounded-full shadow-xs border-0 flex items-center justify-center shrink-0 am-tap"
        :class="
          showMenuPanel
            ? 'am-accent-bg text-white'
            : 'bg-[var(--bg-card)] text-[var(--text-primary)]'
        "
        :aria-label="t('plugins.hubSettings')"
        @click="echoSystem.haptic('selection'); showMenuPanel = !showMenuPanel"
      >
        <Icon :icon="showMenuPanel ? iconX : iconSettings" class="w-4.5 h-4.5" />
      </button>
    </div>

    <!-- Safe Mode Warning Banner (only when active) -->
    <div
      v-if="plugins.safeMode"
      class="rounded-[18px] bg-[#ff9500]/12 px-3.5 py-2.5 flex items-center justify-between gap-2.5"
    >
      <div class="flex items-center gap-2 min-w-0 text-[12.5px] font-medium text-[#c97200]">
        <Icon :icon="iconShieldCheck" class="w-4 h-4 shrink-0" />
        <span class="truncate">{{ t('plugins.safeModeActiveBanner') }}</span>
      </div>
      <button
        type="button"
        class="h-7 px-3 rounded-full bg-[#ff9500] text-white text-[11.5px] font-semibold border-0 shrink-0 am-tap"
        @click="echoSystem.haptic('selection'); plugins.setSafeMode(false)"
      >
        {{ t('plugins.exitSafeMode') }}
      </button>
    </div>

    <!-- Top Settings Drawer Card: Consumer Mode shows ONLY Developer Mode + Check Updates; Dev Mode unlocks Sources & Safe Mode -->
    <section
      v-if="showMenuPanel"
      class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3.5"
      data-plugin-sources-panel
    >
      <label class="flex items-center justify-between gap-3 cursor-pointer" data-dev-mode-toggle>
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text shrink-0">
            <Icon :icon="iconCode" class="w-4.5 h-4.5" />
          </div>
          <div class="min-w-0">
            <div class="text-[14px] font-semibold text-[var(--text-primary)]">{{ t('plugins.devMode') }}</div>
            <div class="text-[11.5px] text-[var(--text-secondary)] leading-snug">{{ t('plugins.devModeSub') }}</div>
          </div>
        </div>
        <input
          :checked="plugins.developerMode"
          type="checkbox"
          class="ios-switch shrink-0"
          @change="echoSystem.haptic('selection'); plugins.setDeveloperMode(!plugins.developerMode)"
        />
      </label>

      <!-- Developer-Only Source Manager & Safe Mode -->
      <template v-if="plugins.developerMode">
        <div class="pt-3 am-hairline-t space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-[12.5px] font-semibold text-[var(--text-secondary)]">{{ t('plugins.manageSources') }}</span>
            <span class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[10px] font-semibold text-[var(--text-secondary)]">
              melune-ext/v1
            </span>
          </div>

          <div class="flex items-center gap-2">
            <input
              v-model="sourceInput"
              type="text"
              :placeholder="t('plugins.sourcePlaceholder')"
              class="flex-1 min-w-0 h-9.5 rounded-full bg-[var(--bg-subtle)] px-3.5 text-[12.5px] text-[var(--text-primary)] border-0 outline-none"
              @keydown.enter="handleImportSource"
            />
            <button
              type="button"
              class="h-9.5 px-3.5 rounded-full am-accent-bg text-white text-[12.5px] font-semibold border-0 shrink-0 am-tap"
              :disabled="adding || !sourceInput.trim()"
              @click="handleImportSource"
            >
              {{ adding ? '…' : t('plugins.addSource') }}
            </button>
          </div>

          <div
            v-if="plugins.registries.length"
            class="rounded-2xl bg-[var(--bg-subtle)]/50 divide-y divide-[var(--hairline)] overflow-hidden"
          >
            <div
              v-for="reg in plugins.registries"
              :key="reg.url"
              class="px-3.5 py-2.5 flex items-center justify-between gap-2"
            >
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-semibold text-[var(--text-primary)] truncate">{{ reg.name }}</div>
                <div class="text-[11px] text-[var(--text-tertiary)] truncate">
                  {{ reg.plugins.length }} 款 · {{ reg.id }}
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  class="w-8 h-8 rounded-full bg-[var(--bg-card)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
                  :disabled="plugins.syncingRegistryUrl === reg.url"
                  @click="handleRefreshRegistry(reg.url)"
                >
                  <Icon
                    :icon="iconRefresh"
                    class="w-3.5 h-3.5"
                    :class="{ 'animate-spin': plugins.syncingRegistryUrl === reg.url }"
                  />
                </button>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full bg-[var(--bg-card)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
                  @click="plugins.copyShareLink(reg.url)"
                >
                  <Icon :icon="iconShare" class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full bg-[var(--bg-card)] border-0 flex items-center justify-center text-[#ff3b30] am-tap"
                  @click="echoSystem.haptic('light'); plugins.removeRegistry(reg.url)"
                >
                  <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <button
            v-if="!plugins.hasDefaultRegistry"
            type="button"
            class="w-full h-9.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[12.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
            @click="handleRestoreDefault"
          >
            <Icon :icon="iconDownload" class="w-4 h-4 am-accent-text" />
            <span>{{ t('plugins.restoreDefaultSource') }} ({{ DEFAULT_PLUGIN_REGISTRY_REPO }})</span>
          </button>

          <label class="pt-3 am-hairline-t flex items-center justify-between gap-3 cursor-pointer">
            <div class="min-w-0 flex-1">
              <div class="text-[13.5px] font-medium text-[var(--text-primary)]">{{ t('plugins.safeMode') }}</div>
              <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">{{ t('plugins.safeModeSub') }}</div>
            </div>
            <input
              :checked="plugins.safeMode"
              type="checkbox"
              class="ios-switch shrink-0"
              @change="echoSystem.haptic('selection'); plugins.setSafeMode(!plugins.safeMode)"
            />
          </label>
        </div>
      </template>
    </section>

    <!-- ==================== TAB A: 已安装 ==================== -->
    <template v-if="activeSubTab === 'installed'">
      <!-- Independent OTA Batch Update Banner -->
      <div
        v-if="plugins.availableUpdatesCount > 0"
        class="rounded-[20px] bg-[var(--bg-card)] px-4 py-3 shadow-xs flex items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <div class="text-[13.5px] font-bold text-[var(--text-primary)]">
            发现 {{ plugins.availableUpdatesCount }} 款插件可独立更新
          </div>
          <div class="text-[11.5px] text-[var(--text-secondary)] truncate">
            无需更新弥音软件，数据 100% 无损保留
          </div>
        </div>
        <button
          type="button"
          class="h-8.5 px-3.5 rounded-full am-accent-bg text-white text-[12.5px] font-semibold border-0 shrink-0 inline-flex items-center gap-1 am-tap"
          :disabled="plugins.updatingAll"
          @click="handleUpdateAll"
        >
          <Icon v-if="plugins.updatingAll" :icon="iconRefresh" class="w-3.5 h-3.5 animate-spin" />
          <span>{{ plugins.updatingAll ? '更新中…' : t('plugins.updateAllBtn') }}</span>
        </button>
      </div>

      <section v-if="plugins.installed.length" class="space-y-2">
        <div class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
          <div
            v-for="item in plugins.installed"
            :key="item.manifest.id"
            class="px-4 py-3.5 flex items-center gap-3.5 cursor-pointer active:bg-[var(--bg-subtle)]/45 transition-colors"
            @click="echoSystem.haptic('light'); plugins.openPluginDetail(item.manifest.id)"
          >
            <!-- Unified Gradient Icon -->
            <div
              class="w-11 h-11 rounded-[14px] bg-gradient-to-br flex items-center justify-center text-white shadow-xs shrink-0"
              :class="resolvePluginVisual(item.manifest).gradientClass"
            >
              <Icon :icon="resolvePluginVisual(item.manifest).icon" class="w-5.5 h-5.5" />
            </div>

            <!-- Spacious 2-Row Info: Crisp 4-Char Short Name (never truncated!) + Live Badge -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-[15.5px] font-semibold text-[var(--text-primary)] whitespace-nowrap">
                  {{ item.manifest.name }}
                </span>
                <span
                  v-if="plugins.developerMode"
                  class="text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums"
                >
                  v{{ item.manifest.version }}
                </span>
              </div>

              <div class="mt-1 flex items-center gap-1.5 min-w-0">
                <span
                  v-if="plugins.getStatus(item.manifest.id).lastError"
                  class="text-[12px] text-[#d93025] truncate inline-flex items-center gap-1"
                >
                  <Icon :icon="iconAlertTriangle" class="w-3.5 h-3.5 shrink-0" />
                  <span class="truncate">{{ plugins.getStatus(item.manifest.id).lastError }}</span>
                </span>
                <span
                  v-else-if="item.enabled && !plugins.safeMode && plugins.getBadge(item.manifest.id)"
                  class="px-2 py-0.5 rounded-full text-[11px] font-semibold truncate max-w-full"
                  :class="badgeClass(plugins.getBadge(item.manifest.id)?.tone)"
                >
                  {{ plugins.getBadge(item.manifest.id)?.text }}
                </span>
                <span v-else class="text-[12px] text-[var(--text-secondary)] truncate">
                  {{ fallbackSubtitle(item.manifest.id, item.enabled) }}
                </span>
              </div>
            </div>

            <!-- Right: Independent Update Pill OR Global Native Switch + Chevron -->
            <div class="flex items-center gap-2 shrink-0" @click.stop>
              <button
                v-if="plugins.getAvailableUpdate(item.manifest.id)"
                type="button"
                class="h-8 px-3 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 am-tap"
                @click="handleQuickUpdate(item.manifest.id)"
              >
                {{ t('plugins.btnUpdate') }}
              </button>
              <input
                v-else
                :checked="item.enabled && !plugins.safeMode"
                :disabled="plugins.safeMode"
                type="checkbox"
                class="ios-switch"
                @change="echoSystem.haptic('selection'); plugins.togglePluginEnabled(item.manifest.id)"
              />
              <Icon :icon="iconChevronRight" class="w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      <!-- Clean Minimal Empty State -->
      <div
        v-else
        class="rounded-[22px] bg-[var(--bg-card)] px-5 py-8 text-center shadow-xs space-y-3"
      >
        <div class="w-12 h-12 rounded-2xl bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text">
          <Icon :icon="iconPuzzle" class="w-6 h-6" />
        </div>
        <div class="text-[15.5px] font-bold text-[var(--text-primary)]">{{ t('plugins.emptyTitle') }}</div>
        <p class="text-[12.5px] text-[var(--text-secondary)] leading-relaxed m-0 max-w-xs mx-auto">
          {{ t('plugins.emptyInstalledDesc') }}
        </p>
        <button
          type="button"
          class="h-10 px-5 rounded-full am-accent-bg text-white text-[13.5px] font-semibold border-0 am-tap"
          @click="switchSubTab('store')"
        >
          {{ t('plugins.browseStore') }}
        </button>
      </div>
    </template>

    <!-- ==================== TAB B: 扩展商店（精选推荐 + 极简列表） ==================== -->
    <template v-else>
      <!-- App Store "精选推荐" Editorial Spotlight Carousel -->
      <section v-if="featuredCatalog.length" class="space-y-2" data-plugin-spotlight>
        <div class="flex items-center gap-1.5 px-2">
          <Icon :icon="iconSparkles" class="w-3.5 h-3.5 am-accent-text" />
          <span class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {{ t('plugins.featuredTitle') }}
          </span>
        </div>

        <div class="am-hscroll flex gap-3 pb-1">
          <div
            v-for="item in featuredCatalog"
            :key="`feat-${item.manifest.id}`"
            class="w-[244px] shrink-0 rounded-[24px] p-4 bg-gradient-to-br text-white shadow-sm flex flex-col justify-between min-h-[138px] relative overflow-hidden"
            :class="resolvePluginVisual(item.manifest).gradientClass"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="w-10 h-10 rounded-[13px] bg-white/20 flex items-center justify-center shrink-0">
                <Icon :icon="resolvePluginVisual(item.manifest).icon" class="w-5.5 h-5.5 text-white" />
              </div>
              <button
                type="button"
                class="h-7.5 px-3.5 rounded-full bg-white text-[#111827] text-[12px] font-bold border-0 shrink-0 am-tap shadow-xs"
                @click="handleStoreAction(item)"
              >
                {{
                  plugins.getAvailableUpdate(item.manifest.id)
                    ? t('plugins.btnUpdate')
                    : plugins.getInstalledPlugin(item.manifest.id)
                      ? t('plugins.btnOpen')
                      : t('plugins.btnGet')
                }}
              </button>
            </div>

            <div class="mt-3">
              <div class="text-[17px] font-bold tracking-tight leading-tight text-white">
                {{ item.manifest.name }}
              </div>
              <p class="text-[12px] text-white/85 mt-1 m-0 line-clamp-2 leading-snug">
                {{ item.manifest.tagline || item.manifest.description }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Horizontal Category Pills -->
      <div class="am-hscroll flex items-center gap-2 pb-0.5">
        <button
          v-for="cat in PLUGIN_CATEGORIES"
          :key="cat.id"
          type="button"
          class="h-8 px-3.5 rounded-full text-[12.5px] font-semibold border-0 shrink-0 am-tap transition-colors"
          :class="
            selectedCategory === cat.id
              ? 'am-accent-bg text-white shadow-xs'
              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-xs'
          "
          @click="echoSystem.haptic('selection'); selectedCategory = cat.id"
        >
          {{ t(cat.labelKey) }}
        </button>
      </div>

      <!-- Loading Skeleton -->
      <div
        v-if="plugins.defaultLoading && !storeCatalog.length"
        class="rounded-[22px] bg-[var(--bg-card)] divide-y divide-[var(--hairline)] overflow-hidden shadow-xs"
      >
        <div v-for="n in 3" :key="n" class="px-4 py-3.5 flex items-center gap-3 animate-pulse">
          <div class="w-11 h-11 rounded-[14px] bg-[var(--bg-subtle)] shrink-0" />
          <div class="flex-1 space-y-2">
            <div class="h-3.5 w-20 rounded-full bg-[var(--bg-subtle)]" />
            <div class="h-3 w-44 rounded-full bg-[var(--bg-subtle)]/70" />
          </div>
          <div class="w-14 h-8 rounded-full bg-[var(--bg-subtle)] shrink-0" />
        </div>
      </div>

      <!-- Error + Retry -->
      <div
        v-else-if="plugins.defaultLoadError && !storeCatalog.length"
        class="rounded-[22px] bg-[var(--bg-card)] px-5 py-7 text-center shadow-xs space-y-3"
      >
        <div class="text-[14.5px] font-bold text-[var(--text-primary)]">{{ t('plugins.storeLoadFailed') }}</div>
        <p class="text-[12px] text-[var(--text-secondary)] m-0">{{ plugins.defaultLoadError }}</p>
        <button
          type="button"
          class="h-9.5 px-5 rounded-full am-accent-bg text-white text-[13px] font-semibold border-0 am-tap"
          @click="plugins.ensureDefaultRegistryLoaded()"
        >
          {{ t('plugins.retrySync') }}
        </button>
      </div>

      <!-- Curated Store List -->
      <div
        v-else-if="storeCatalog.length"
        class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs"
      >
        <div
          v-for="item in storeCatalog"
          :key="item.manifest.id"
          class="px-4 py-3.5 flex items-center gap-3.5"
        >
          <div
            class="w-11 h-11 rounded-[14px] bg-gradient-to-br flex items-center justify-center text-white shadow-xs shrink-0"
            :class="resolvePluginVisual(item.manifest).gradientClass"
          >
            <Icon :icon="resolvePluginVisual(item.manifest).icon" class="w-5.5 h-5.5" />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-[15.5px] font-semibold text-[var(--text-primary)] whitespace-nowrap">
                {{ item.manifest.name }}
              </span>
              <span
                v-if="plugins.developerMode"
                class="text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums"
              >
                v{{ item.manifest.version }}
              </span>
            </div>
            <p class="text-[12px] text-[var(--text-secondary)] mt-0.5 m-0 line-clamp-2 leading-snug">
              {{ item.manifest.tagline || item.manifest.description }}
            </p>
          </div>

          <button
            type="button"
            class="h-8.5 px-4 rounded-full text-[12.5px] font-semibold border-0 shrink-0 am-tap"
            :class="
              plugins.getAvailableUpdate(item.manifest.id)
                ? 'bg-[#ff9500] text-white'
                : plugins.getInstalledPlugin(item.manifest.id)
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                  : 'am-accent-bg text-white'
            "
            @click="handleStoreAction(item)"
          >
            {{
              plugins.getAvailableUpdate(item.manifest.id)
                ? t('plugins.btnUpdate')
                : plugins.getInstalledPlugin(item.manifest.id)
                  ? t('plugins.btnOpen')
                  : t('plugins.btnGet')
            }}
          </button>
        </div>
      </div>

      <!-- Empty Store -->
      <div
        v-else
        class="rounded-[22px] bg-[var(--bg-card)] px-5 py-7 text-center shadow-xs space-y-3"
      >
        <div class="text-[14.5px] font-bold text-[var(--text-primary)]">
          {{ plugins.registries.length ? t('plugins.noCategoryPlugins') : t('plugins.noRegistriesTitle') }}
        </div>
        <button
          v-if="!plugins.hasDefaultRegistry"
          type="button"
          class="h-9.5 px-5 rounded-full am-accent-bg text-white text-[13px] font-semibold border-0 am-tap"
          @click="handleRestoreDefault"
        >
          {{ t('plugins.restoreDefaultSource') }}
        </button>
      </div>
    </template>
  </div>
</template>
