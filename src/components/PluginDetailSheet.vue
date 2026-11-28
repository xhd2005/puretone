<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconShare from '@iconify/icons-tabler/share-2';
import iconTrash from '@iconify/icons-tabler/trash';
import iconDatabase from '@iconify/icons-tabler/database';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconDownload from '@iconify/icons-tabler/download';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconTerminal from '@iconify/icons-tabler/terminal';
import { usePluginsStore } from '@/stores/plugins';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import { PLUGIN_PERMISSION_META, resolvePluginVisual } from '@/services/plugins/pluginUiMeta';
import PluginPanelRenderer from './PluginPanelRenderer.vue';
import SegmentedControl from './SegmentedControl.vue';

const plugins = usePluginsStore();
const ui = useUiStore();
const { t } = useI18n();

type DetailSubTab = 'panel' | 'diagnostics';
const activeTab = ref<DetailSubTab>('panel');
const detailSubTabs = computed<Array<{ id: DetailSubTab; label: string }>>(() => [
  { id: 'panel', label: t('plugins.detailTabPanel') },
  { id: 'diagnostics', label: t('plugins.detailTabDiagnostics') },
]);
const bodyScrollRef = ref<HTMLElement | null>(null);
const confirmClear = ref(false);
const clearingData = ref(false);
const diagTick = ref(0);

const plugin = computed(() => plugins.detailPlugin);
const isOpen = computed(() => Boolean(plugin.value));
const visual = computed(() => (plugin.value ? resolvePluginVisual(plugin.value.manifest) : null));
const availableUpdate = computed(() =>
  plugin.value ? plugins.getAvailableUpdate(plugin.value.manifest.id) : null,
);
const checkingThis = computed(
  () => Boolean(plugin.value && plugins.checkingSinglePluginId === plugin.value.manifest.id),
);
const diagnostics = computed(() => {
  void diagTick.value;
  if (!plugin.value) return null;
  return plugins.getDiagnostics(plugin.value.manifest.id);
});
const pinned = computed(() => (plugin.value ? plugins.isPinned(plugin.value.manifest.id) : false));

const capabilitySummary = computed(() => {
  const d = diagnostics.value;
  if (!d) return '--';
  const tags: string[] = [];
  if (d.hasPanel) tags.push('面板');
  if (d.hasAudioResolver) tags.push('音源');
  if (d.hasLyricFilter) tags.push('歌词');
  if (d.hasLaunchHook) tags.push('生命周期');
  return tags.length ? tags.join(' · ') : '已就绪';
});

const dragSheet = useDraggableSheet({
  detents: [0.64, 0.94],
  initialDetentIndex: 1,
  scrollElRef: bodyScrollRef,
  onDismiss: () => {
    plugins.closePluginDetail();
  },
});

watch(
  () => plugins.detailPluginId,
  (id) => {
    confirmClear.value = false;
    if (id) {
      dragSheet.reset();
      const st = plugins.getStatus(id);
      activeTab.value = !plugins.developerMode || (st.hasPanel && !plugins.safeMode) ? 'panel' : 'diagnostics';
      diagTick.value += 1;
    }
  },
);

watch(
  () => plugins.developerMode,
  (dev) => {
    if (!dev) activeTab.value = 'panel';
  },
);

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function handleTogglePin() {
  if (!plugin.value) return;
  echoSystem.haptic('selection');
  const next = await plugins.togglePinPlugin(plugin.value.manifest.id);
  ui.showToast(next ? '已放到首页与档案页快捷直达' : '已从首页快捷区移除');
}

async function handleSingleUpdateAction() {
  if (!plugin.value || checkingThis.value) return;
  echoSystem.haptic('light');
  if (availableUpdate.value) {
    plugins.requestInstallReview(
      availableUpdate.value.manifest,
      availableUpdate.value.registryUrl,
      availableUpdate.value.registryName,
    );
    return;
  }
  try {
    const res = await plugins.checkSinglePluginUpdate(plugin.value.manifest.id);
    if (res.hasUpdate && res.update) {
      plugins.requestInstallReview(res.update.manifest, res.update.registryUrl, res.update.registryName);
    } else {
      ui.showToast(`「${plugin.value.manifest.name}」已是最新版本`);
    }
  } catch (err: any) {
    ui.showToast(err?.message || '检查插件更新失败', 3000);
  }
}

async function handleClearData() {
  if (!plugin.value || clearingData.value) return;
  if (!confirmClear.value) {
    echoSystem.haptic('light');
    confirmClear.value = true;
    return;
  }
  clearingData.value = true;
  try {
    const removed = await plugins.clearPluginStorage(plugin.value.manifest.id);
    confirmClear.value = false;
    diagTick.value += 1;
    echoSystem.haptic('success');
    ui.showToast(`已清空 ${removed} 条插件独立数据`);
  } finally {
    clearingData.value = false;
  }
}

async function handleUninstall() {
  if (!plugin.value) return;
  echoSystem.haptic('medium');
  const name = plugin.value.manifest.name;
  await plugins.uninstallPlugin(plugin.value.manifest.id);
  ui.showToast(`已卸载「${name}」`);
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="isOpen && plugin && visual"
      class="fixed inset-0 z-[92] flex flex-col justify-end lg-scrim"
      @click="plugins.closePluginDetail()"
    >
      <div class="lg-sheet-slide items-center" @click.stop>
        <div
          class="lg-sheet-panel w-full max-w-2xl rounded-t-[30px] shadow-2xl flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
          data-plugin-detail-sheet
        >
        <!-- Drag Handle + Clean Header -->
        <div
          class="shrink-0 am-hairline-b"
          @touchstart.passive="dragSheet.onHandleTouchStart"
          @touchmove="dragSheet.onHandleTouchMove"
          @touchend.passive="dragSheet.onHandleTouchEnd"
          @touchcancel.passive="dragSheet.onHandleTouchEnd"
        >
          <div class="pt-3 pb-1.5 flex justify-center">
            <div class="w-10 h-1 rounded-full bg-[var(--text-tertiary)]/35" />
          </div>

          <div class="px-4 pt-1 pb-3.5 space-y-3">
            <div class="flex items-center gap-3">
              <div
                class="w-11 h-11 rounded-[15px] bg-gradient-to-br flex items-center justify-center text-white shadow-sm shrink-0"
                :class="visual.gradientClass"
              >
                <Icon :icon="visual.icon" class="w-5.5 h-5.5" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <h2 class="text-[18px] font-bold text-[var(--text-primary)] truncate m-0">
                    {{ plugin.manifest.name }}
                  </h2>
                  <span
                    v-if="plugins.developerMode"
                    class="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] text-[10.5px] font-semibold text-[var(--text-secondary)] shrink-0 tabular-nums"
                  >
                    v{{ plugin.manifest.version }}
                  </span>
                </div>
                <div class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                  {{
                    plugins.developerMode
                      ? plugin.manifest.author
                      : plugin.manifest.tagline || plugin.manifest.description
                  }}
                </div>
              </div>

              <input
                :checked="plugin.enabled && !plugins.safeMode"
                :disabled="plugins.safeMode"
                type="checkbox"
                class="ios-switch shrink-0"
                @change="echoSystem.haptic('selection'); plugins.togglePluginEnabled(plugin.manifest.id)"
              />

              <button
                type="button"
                class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] shrink-0 am-tap"
                aria-label="Close"
                @click="plugins.closePluginDetail()"
              >
                <Icon :icon="iconX" class="w-4.5 h-4.5" />
              </button>
            </div>

            <!-- Independent OTA Update Banner when a new plugin version is ready -->
            <div
              v-if="availableUpdate"
              class="rounded-2xl bg-[var(--bg-card)] px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-xs"
            >
              <div class="min-w-0">
                <div class="text-[12.5px] font-bold text-[var(--text-primary)]">
                  {{ availableUpdate.isHotfixSameVersion ? '发现热修复更新' : `发现新版 v${availableUpdate.manifest.version}` }}
                </div>
                <div class="text-[11px] text-[var(--text-secondary)] truncate">
                  独立热更新 · 无需升级软件，数据无损保留
                </div>
              </div>
              <button
                type="button"
                class="h-8 px-3.5 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 inline-flex items-center gap-1 shrink-0 am-tap"
                @click="handleSingleUpdateAction"
              >
                <Icon :icon="iconDownload" class="w-3.5 h-3.5" />
                <span>{{ t('plugins.btnUpdate') }}</span>
              </button>
            </div>

            <!-- Developer-Only 2-Tab Switcher (hidden completely in Consumer Mode!) -->
            <div v-if="plugins.developerMode" @touchstart.stop>
              <SegmentedControl
                v-model="activeTab"
                :options="detailSubTabs"
                variant="pill"
                size="md"
                @change="(tab) => { if (tab === 'diagnostics') diagTick += 1; }"
              />
            </div>
          </div>
        </div>

        <!-- Scrollable Sheet Body -->
        <div
          ref="bodyScrollRef"
          class="flex-1 min-h-0 am-scroll px-4 pt-4 pb-[calc(var(--safe-bottom)+32px)] space-y-4"
          @touchstart.passive="dragSheet.onBodyTouchStart"
          @touchmove="dragSheet.onBodyTouchMove"
          @touchend.passive="dragSheet.onBodyTouchEnd"
          @touchcancel.passive="dragSheet.onBodyTouchEnd"
        >
          <!-- SUBTAB 1 (Default for ALL users): Clean Control Panel + Plain-Language Bottom Card -->
          <template v-if="!plugins.developerMode || activeTab === 'panel'">
            <div
              v-if="plugins.safeMode || !plugin.enabled"
              class="rounded-[22px] bg-[var(--bg-card)] p-5 text-center shadow-xs space-y-2"
            >
              <div class="text-[14.5px] font-bold text-[var(--text-primary)]">
                {{ plugins.safeMode ? t('plugins.pausedSafeMode') : t('plugins.disabledState') }}
              </div>
              <p class="text-[12.5px] text-[var(--text-secondary)] m-0">
                打开右上角开关即可立即启用本插件。
              </p>
            </div>
            <PluginPanelRenderer v-else :plugin-id="plugin.manifest.id" />

            <!-- Plain-Language Consumer Footer Card -->
            <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3" data-plugin-simple-actions>
              <label class="flex items-center justify-between gap-3 cursor-pointer">
                <div class="min-w-0 flex-1">
                  <div class="text-[14.5px] font-medium text-[var(--text-primary)]">{{ t('plugins.pinHomeLabel') }}</div>
                  <div class="text-[11.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                    {{ t('plugins.pinHomeSub') }}
                  </div>
                </div>
                <input
                  :checked="pinned"
                  type="checkbox"
                  class="ios-switch shrink-0"
                  @change="handleTogglePin"
                />
              </label>

              <div class="pt-3 am-hairline-t grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  class="h-10 rounded-full text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                  :class="
                    availableUpdate
                      ? 'am-accent-bg text-white shadow-xs'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                  "
                  :disabled="checkingThis"
                  @click="handleSingleUpdateAction"
                >
                  <Icon
                    :icon="availableUpdate ? iconDownload : iconRefresh"
                    class="w-4 h-4"
                    :class="{ 'animate-spin': checkingThis }"
                  />
                  <span>
                    {{
                      checkingThis
                        ? '检查中…'
                        : availableUpdate
                          ? t('plugins.installUpdateNow')
                          : t('plugins.checkSingleUpdate')
                    }}
                  </span>
                </button>

                <button
                  type="button"
                  class="h-10 rounded-full bg-[#ff3b30]/12 text-[#ff3b30] text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                  @click="handleUninstall"
                >
                  <Icon :icon="iconTrash" class="w-4 h-4" />
                  <span>{{ t('plugins.uninstallExt') }}</span>
                </button>
              </div>
            </section>
          </template>

          <!-- SUBTAB 2 (Developer Mode ONLY): Diagnostics, 20 Sandbox Logs, Permissions & Data Tools -->
          <template v-else-if="diagnostics">
            <section class="space-y-2">
              <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                {{ t('plugins.diagOverview') }}
              </div>
              <div class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-3">
                <div class="grid grid-cols-2 gap-2">
                  <div class="rounded-2xl bg-[var(--bg-subtle)]/55 px-3 py-2.5">
                    <div class="text-[11px] text-[var(--text-secondary)]">运行状态</div>
                    <div
                      class="text-[13.5px] font-bold mt-0.5"
                      :class="diagnostics.loaded ? 'text-[#239941]' : 'text-[var(--text-secondary)]'"
                    >
                      {{ diagnostics.loaded ? '沙箱运行中' : plugins.safeMode ? '安全模式暂停' : '未启用' }}
                    </div>
                  </div>
                  <div class="rounded-2xl bg-[var(--bg-subtle)]/55 px-3 py-2.5">
                    <div class="text-[11px] text-[var(--text-secondary)]">初始化耗时</div>
                    <div class="text-[13.5px] font-bold text-[var(--text-primary)] mt-0.5 tabular-nums">
                      {{ diagnostics.loadDurationMs }} ms
                    </div>
                  </div>
                  <div class="rounded-2xl bg-[var(--bg-subtle)]/55 px-3 py-2.5">
                    <div class="text-[11px] text-[var(--text-secondary)]">已挂载能力</div>
                    <div class="text-[13px] font-bold text-[var(--text-primary)] mt-0.5 truncate">
                      {{ capabilitySummary }}
                    </div>
                  </div>
                  <div class="rounded-2xl bg-[var(--bg-subtle)]/55 px-3 py-2.5">
                    <div class="text-[11px] text-[var(--text-secondary)]">SHA-256 指纹</div>
                    <div class="text-[12px] font-mono font-semibold text-[var(--text-primary)] mt-0.5 truncate">
                      {{ plugin.manifest.sha256.slice(0, 12) }}…
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between px-2">
                <span class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] inline-flex items-center gap-1">
                  <Icon :icon="iconTerminal" class="w-3.5 h-3.5" />
                  <span>{{ t('plugins.diagLogs', { count: diagnostics.logs.length }) }}</span>
                </span>
                <button
                  type="button"
                  class="text-[11.5px] font-semibold am-accent-text bg-transparent border-0 inline-flex items-center gap-1 am-tap"
                  @click="echoSystem.haptic('light'); diagTick += 1"
                >
                  <Icon :icon="iconRefresh" class="w-3.5 h-3.5" />
                  <span>刷新</span>
                </button>
              </div>

              <div class="rounded-[22px] bg-[var(--bg-card)] p-3.5 shadow-xs">
                <div
                  v-if="diagnostics.logs.length"
                  class="space-y-1.5 max-h-52 am-scroll font-mono text-[11px] leading-snug"
                >
                  <div
                    v-for="(entry, li) in [...diagnostics.logs].reverse()"
                    :key="`${entry.ts}-${li}`"
                    class="flex items-start gap-2 px-2 py-1 rounded-lg bg-[var(--bg-subtle)]/45"
                  >
                    <span class="text-[var(--text-tertiary)] shrink-0 tabular-nums">{{ formatLogTime(entry.ts) }}</span>
                    <span
                      class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                      :class="
                        entry.level === 'error'
                          ? 'bg-[#ff3b30]'
                          : entry.level === 'warn'
                            ? 'bg-[#ff9500]'
                            : 'bg-[#34c759]'
                      "
                    />
                    <span class="text-[var(--text-primary)] break-all">{{ entry.message }}</span>
                  </div>
                </div>
                <div v-else class="py-4 text-center text-[12px] text-[var(--text-tertiary)]">
                  暂无运行日志
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2 inline-flex items-center gap-1">
                <Icon :icon="iconShieldCheck" class="w-3.5 h-3.5 text-[#34c759]" />
                <span>{{ t('plugins.permissionsTitle', { count: plugin.manifest.permissions.length }) }}</span>
              </div>
              <div class="rounded-[22px] bg-[var(--bg-card)] divide-y divide-[var(--hairline)] overflow-hidden shadow-xs">
                <div
                  v-for="perm in plugin.manifest.permissions"
                  :key="perm"
                  class="px-4 py-2.5"
                >
                  <div class="text-[13px] font-semibold text-[var(--text-primary)]">
                    {{ PLUGIN_PERMISSION_META[perm]?.label || perm }}
                  </div>
                  <div class="text-[11.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                    {{ PLUGIN_PERMISSION_META[perm]?.desc || perm }}
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-2.5">
              <button
                v-if="plugin.registryUrl"
                type="button"
                class="w-full h-10 rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                @click="plugins.copyShareLink(plugin.registryUrl, plugin.manifest.id)"
              >
                <Icon :icon="iconShare" class="w-4 h-4 am-accent-text" />
                <span>{{ t('plugins.shareMeluneLink') }}</span>
              </button>

              <button
                type="button"
                class="w-full h-10 rounded-full text-[13px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                :class="
                  confirmClear
                    ? 'bg-[#ff9500] text-white'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                "
                :disabled="clearingData"
                @click="handleClearData"
              >
                <Icon :icon="iconDatabase" class="w-4 h-4" />
                <span>
                  {{
                    clearingData
                      ? '正在清空…'
                      : confirmClear
                        ? t('plugins.confirmClearData')
                        : t('plugins.clearData')
                  }}
                </span>
              </button>
            </section>
          </template>
        </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
