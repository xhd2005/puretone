<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconPlus from '@iconify/icons-tabler/plus';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconTrash from '@iconify/icons-tabler/trash';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconShare from '@iconify/icons-tabler/share-2';
import iconChevronDown from '@iconify/icons-tabler/chevron-down';
import iconAlertTriangle from '@iconify/icons-tabler/alert-triangle';
import { usePluginsStore } from '@/stores/plugins';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { parseMeluneExtensionDeepLink } from '@/services/plugins/deepLink';
import PluginPanelRenderer from './PluginPanelRenderer.vue';

const plugins = usePluginsStore();
const ui = useUiStore();
const { t } = useI18n();

const sourceInput = ref('');
const adding = ref(false);

async function handleImportSource() {
  const raw = sourceInput.value.trim();
  if (!raw || adding.value) return;
  echoSystem.haptic('light');
  adding.value = true;
  try {
    if (parseMeluneExtensionDeepLink(raw)) {
      const ok = await plugins.handleDeepLinkUri(raw);
      if (ok) sourceInput.value = '';
      return;
    }
    const saved = await plugins.addOrRefreshRegistry(raw);
    sourceInput.value = '';
    echoSystem.haptic('success');
    ui.showToast(`已导入源「${saved.name}」（${saved.plugins.length} 款扩展）`);
  } catch (err: any) {
    ui.showToast(err?.message || '导入插件源失败', 3200);
  } finally {
    adding.value = false;
  }
}

async function handleRefreshRegistry(url: string) {
  echoSystem.haptic('light');
  try {
    const saved = await plugins.addOrRefreshRegistry(url);
    ui.showToast(`已同步「${saved.name}」（${saved.plugins.length} 款扩展）`);
  } catch (err: any) {
    ui.showToast(err?.message || '同步失败', 3000);
  }
}

function togglePanel(pluginId: string) {
  echoSystem.haptic('selection');
  plugins.activePanelPluginId = plugins.activePanelPluginId === pluginId ? '' : pluginId;
}

function isInstalled(id: string): boolean {
  return Boolean(plugins.getInstalledPlugin(id));
}

function hasUpdate(id: string, remoteVersion: string): boolean {
  const local = plugins.getInstalledPlugin(id);
  return Boolean(local && local.manifest.version !== remoteVersion);
}
</script>

<template>
  <div class="space-y-4" data-plugin-hub>
    <!-- Header Summary + Safe Mode Switch -->
    <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-10 h-10 rounded-2xl bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text shrink-0">
            <Icon :icon="iconPuzzle" class="w-5.5 h-5.5" />
          </div>
          <div class="min-w-0">
            <div class="text-[15.5px] font-bold text-[var(--text-primary)] leading-tight">
              {{ t('plugins.hubTitle') }}
            </div>
            <div class="text-[11.5px] text-[var(--text-secondary)] mt-0.5 truncate">
              {{ t('plugins.hubSub', { active: plugins.enabledCount, total: plugins.installed.length }) }}
            </div>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[10.5px] font-semibold text-[var(--text-secondary)] shrink-0">
          melune-ext/v1
        </span>
      </div>

      <!-- Add Registry URL or melune:// Share Link -->
      <div class="flex items-center gap-2">
        <input
          v-model="sourceInput"
          type="text"
          :placeholder="t('plugins.sourcePlaceholder')"
          class="flex-1 min-w-0 h-10 rounded-xl bg-[var(--bg-subtle)] px-3 text-[12.5px] text-[var(--text-primary)] border-0 outline-none"
          @keydown.enter="handleImportSource"
        />
        <button
          type="button"
          class="h-10 px-3.5 rounded-xl am-accent-bg text-white text-[13px] font-semibold border-0 inline-flex items-center gap-1 shrink-0 am-tap"
          :disabled="adding || !sourceInput.trim()"
          @click="handleImportSource"
        >
          <Icon v-if="adding" :icon="iconRefresh" class="w-4 h-4 animate-spin" />
          <Icon v-else :icon="iconPlus" class="w-4 h-4" />
          <span>{{ t('plugins.addSource') }}</span>
        </button>
      </div>

      <p class="text-[11px] leading-relaxed text-[var(--text-tertiary)] m-0">
        {{ t('plugins.sourceHint') }}
      </p>

      <!-- Safe Mode Toggle -->
      <label class="pt-2.5 am-hairline-t flex items-center justify-between gap-3 cursor-pointer">
        <div class="flex items-center gap-2 min-w-0">
          <Icon :icon="iconShieldCheck" class="w-4 h-4 am-accent-text shrink-0" />
          <div class="min-w-0">
            <div class="text-[13.5px] font-medium text-[var(--text-primary)]">{{ t('plugins.safeMode') }}</div>
            <div class="text-[11px] text-[var(--text-secondary)] leading-snug">{{ t('plugins.safeModeSub') }}</div>
          </div>
        </div>
        <input
          :checked="plugins.safeMode"
          type="checkbox"
          class="ios-switch shrink-0"
          @change="echoSystem.haptic('selection'); plugins.setSafeMode(!plugins.safeMode)"
        />
      </label>
    </section>

    <!-- Installed Extensions -->
    <section v-if="plugins.installed.length" class="space-y-2">
      <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
        {{ t('plugins.installedGroup', { count: plugins.installed.length }) }}
      </div>

      <div class="space-y-2.5">
        <div
          v-for="item in plugins.installed"
          :key="item.manifest.id"
          class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3"
        >
          <div class="flex items-start justify-between gap-2.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[15px] font-bold text-[var(--text-primary)] truncate">
                  {{ item.manifest.name }}
                </span>
                <span class="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] text-[10px] font-semibold text-[var(--text-secondary)] shrink-0">
                  v{{ item.manifest.version }}
                </span>
              </div>
              <p class="text-[12px] text-[var(--text-secondary)] mt-0.5 m-0 leading-snug">
                {{ item.manifest.description }}
              </p>
              <div class="text-[10.5px] text-[var(--text-tertiary)] mt-1 truncate">
                {{ item.manifest.author }} · SHA-256 {{ item.manifest.sha256.slice(0, 10) }}…
              </div>
            </div>

            <input
              :checked="item.enabled && !plugins.safeMode"
              :disabled="plugins.safeMode"
              type="checkbox"
              class="ios-switch shrink-0"
              @change="echoSystem.haptic('selection'); plugins.togglePluginEnabled(item.manifest.id)"
            />
          </div>

          <div
            v-if="plugins.getStatus(item.manifest.id).lastError"
            class="rounded-xl bg-[#ff3b30]/12 text-[#d93025] px-3 py-2 text-[11.5px] flex items-center gap-1.5"
          >
            <Icon :icon="iconAlertTriangle" class="w-4 h-4 shrink-0" />
            <span class="min-w-0 flex-1">{{ plugins.getStatus(item.manifest.id).lastError }}</span>
          </div>

          <!-- Action Row: Expand Panel / Share Link / Uninstall -->
          <div class="flex items-center justify-between gap-2 pt-1">
            <button
              v-if="item.enabled && !plugins.safeMode && plugins.getStatus(item.manifest.id).hasPanel"
              type="button"
              class="h-8 px-3 rounded-full text-[12px] font-semibold border-0 inline-flex items-center gap-1 am-tap"
              :class="
                plugins.activePanelPluginId === item.manifest.id
                  ? 'am-accent-bg text-white'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
              "
              @click="togglePanel(item.manifest.id)"
            >
              <span>{{ plugins.activePanelPluginId === item.manifest.id ? t('plugins.hidePanel') : t('plugins.openPanel') }}</span>
              <Icon
                :icon="iconChevronDown"
                class="w-3.5 h-3.5 transition-transform"
                :class="{ 'rotate-180': plugins.activePanelPluginId === item.manifest.id }"
              />
            </button>
            <span v-else class="text-[11px] text-[var(--text-tertiary)]">
              {{ plugins.safeMode ? t('plugins.pausedSafeMode') : item.enabled ? t('plugins.activeBackground') : t('plugins.disabledState') }}
            </span>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="item.registryUrl"
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
                aria-label="Share"
                @click="plugins.copyShareLink(item.registryUrl, item.manifest.id)"
              >
                <Icon :icon="iconShare" class="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[#ff3b30] am-tap"
                aria-label="Uninstall"
                @click="echoSystem.haptic('medium'); plugins.uninstallPlugin(item.manifest.id); ui.showToast('已卸载扩展')"
              >
                <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <!-- Inline Declarative Liquid Glass Plugin Panel -->
          <div
            v-if="item.enabled && !plugins.safeMode && plugins.activePanelPluginId === item.manifest.id"
            class="pt-2 am-hairline-t"
          >
            <PluginPanelRenderer :plugin-id="item.manifest.id" />
          </div>
        </div>
      </div>
    </section>

    <!-- Added Community Registries -->
    <section v-if="plugins.registries.length" class="space-y-2.5">
      <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
        {{ t('plugins.registriesGroup', { count: plugins.registries.length }) }}
      </div>

      <div
        v-for="reg in plugins.registries"
        :key="reg.url"
        class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden shadow-xs"
      >
        <div class="px-4 py-3 flex items-center justify-between gap-2 am-hairline-b">
          <div class="min-w-0 flex-1">
            <div class="text-[14.5px] font-bold text-[var(--text-primary)] truncate">{{ reg.name }}</div>
            <div class="text-[11px] text-[var(--text-tertiary)] truncate">{{ reg.url }}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
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
              class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
              @click="plugins.copyShareLink(reg.url)"
            >
              <Icon :icon="iconShare" class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[#ff3b30] am-tap"
              @click="echoSystem.haptic('light'); plugins.removeRegistry(reg.url)"
            >
              <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="divide-y divide-[var(--hairline)]">
          <div
            v-for="plg in reg.plugins"
            :key="plg.id"
            class="px-4 py-3 flex items-center justify-between gap-3"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[14px] font-semibold text-[var(--text-primary)] truncate">{{ plg.name }}</span>
                <span class="text-[10.5px] text-[var(--text-tertiary)] shrink-0">v{{ plg.version }}</span>
              </div>
              <div class="text-[11.5px] text-[var(--text-secondary)] mt-0.5 line-clamp-2 leading-snug">
                {{ plg.description }}
              </div>
            </div>

            <button
              type="button"
              class="h-8 px-3 rounded-full text-[12px] font-semibold border-0 shrink-0 am-tap"
              :class="
                hasUpdate(plg.id, plg.version)
                  ? 'am-accent-bg text-white'
                  : isInstalled(plg.id)
                    ? 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                    : 'am-accent-bg text-white'
              "
              @click="plugins.requestInstallReview(plg, reg.url, reg.name)"
            >
              {{
                hasUpdate(plg.id, plg.version)
                  ? t('plugins.btnUpdate')
                  : isInstalled(plg.id)
                    ? t('plugins.btnReinstall')
                    : t('plugins.btnInstall')
              }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Pure Compliant Empty Guide -->
    <section
      v-if="!plugins.installed.length && !plugins.registries.length"
      class="rounded-[22px] bg-[var(--bg-card)] px-5 py-7 text-center space-y-2.5 shadow-xs"
    >
      <div class="w-12 h-12 rounded-2xl bg-[var(--bg-subtle)] mx-auto flex items-center justify-center am-accent-text">
        <Icon :icon="iconPuzzle" class="w-6 h-6" />
      </div>
      <div class="text-[15px] font-bold text-[var(--text-primary)]">{{ t('plugins.emptyTitle') }}</div>
      <p class="text-[12px] leading-relaxed text-[var(--text-secondary)] m-0">
        {{ t('plugins.emptyDesc') }}
      </p>
    </section>
  </div>
</template>
