<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconPin from '@iconify/icons-tabler/pin';
import iconPinned from '@iconify/icons-tabler/pinned';
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

const plugins = usePluginsStore();
const ui = useUiStore();
const { t } = useI18n();

type DetailSubTab = 'panel' | 'diagnostics';
const activeTab = ref<DetailSubTab>('panel');
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
      activeTab.value = st.hasPanel && !plugins.safeMode ? 'panel' : 'diagnostics';
      diagTick.value += 1;
    }
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
  ui.showToast(next ? '已置顶至档案页快捷胶囊' : '已取消档案页置顶');
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
    ui.showToast(`已清空 ${removed} 条插件独立存储数据`);
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

function handleStartUpdate() {
  if (!availableUpdate.value) return;
  echoSystem.haptic('light');
  plugins.requestInstallReview(
    availableUpdate.value.manifest,
    availableUpdate.value.registryUrl,
    availableUpdate.value.registryName,
  );
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="isOpen && plugin && visual"
      class="fixed inset-0 z-[92] flex items-end justify-center lg-scrim"
      @click="plugins.closePluginDetail()"
    >
      <div
        class="lg-sheet-panel w-full max-w-2xl rounded-t-[30px] shadow-2xl flex flex-col overflow-hidden"
        :style="dragSheet.sheetStyle.value"
        data-plugin-detail-sheet
        @click.stop
      >
        <!-- Drag Handle + Header -->
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
            <!-- Immersive Plugin Title Row -->
            <div class="flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-[16px] bg-gradient-to-br flex items-center justify-center text-white shadow-sm shrink-0"
                :class="visual.gradientClass"
              >
                <Icon :icon="visual.icon" class="w-6 h-6" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <h2 class="text-[17px] font-bold text-[var(--text-primary)] truncate m-0">
                    {{ plugin.manifest.name }}
                  </h2>
                  <span class="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] text-[10.5px] font-semibold text-[var(--text-secondary)] shrink-0 tabular-nums">
                    v{{ plugin.manifest.version }}
                  </span>
                </div>
                <div class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                  {{ plugin.manifest.author }}
                </div>
              </div>

              <button
                type="button"
                class="w-9 h-9 rounded-full border-0 flex items-center justify-center shrink-0 am-tap"
                :class="
                  pinned
                    ? 'am-accent-bg text-white'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                "
                :aria-label="pinned ? t('plugins.unpin') : t('plugins.pinToProfile')"
                @click="handleTogglePin"
              >
                <Icon :icon="pinned ? iconPinned : iconPin" class="w-4.5 h-4.5" />
              </button>

              <button
                type="button"
                class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] shrink-0 am-tap"
                aria-label="Close"
                @click="plugins.closePluginDetail()"
              >
                <Icon :icon="iconX" class="w-4.5 h-4.5" />
              </button>
            </div>

            <!-- Update Banner if newer version is available -->
            <div
              v-if="availableUpdate"
              class="rounded-2xl bg-[var(--bg-card)] px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-xs"
            >
              <div class="min-w-0">
                <div class="text-[12.5px] font-bold text-[var(--text-primary)]">
                  发现新版 v{{ availableUpdate.manifest.version }}
                </div>
                <div class="text-[11px] text-[var(--text-secondary)] truncate">
                  无损升级 · 完整保留本地签到/配置数据
                </div>
              </div>
              <button
                type="button"
                class="h-8 px-3.5 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 inline-flex items-center gap-1 shrink-0 am-tap"
                @click="handleStartUpdate"
              >
                <Icon :icon="iconDownload" class="w-3.5 h-3.5" />
                <span>{{ t('plugins.btnUpdate') }}</span>
              </button>
            </div>

            <!-- 2-Tab Sub Switcher + Enable Switch -->
            <div class="flex items-center gap-2.5">
              <div class="flex-1 rounded-full bg-[var(--bg-subtle)] p-1 grid grid-cols-2">
                <button
                  type="button"
                  class="h-8 rounded-full text-[12.5px] font-semibold border-0 transition-colors"
                  :class="
                    activeTab === 'panel'
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent text-[var(--text-secondary)]'
                  "
                  @click="echoSystem.haptic('selection'); activeTab = 'panel'"
                >
                  {{ t('plugins.detailTabPanel') }}
                </button>
                <button
                  type="button"
                  class="h-8 rounded-full text-[12.5px] font-semibold border-0 transition-colors"
                  :class="
                    activeTab === 'diagnostics'
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent text-[var(--text-secondary)]'
                  "
                  @click="echoSystem.haptic('selection'); activeTab = 'diagnostics'; diagTick += 1"
                >
                  {{ t('plugins.detailTabDiagnostics') }}
                </button>
              </div>

              <input
                :checked="plugin.enabled && !plugins.safeMode"
                :disabled="plugins.safeMode"
                type="checkbox"
                class="ios-switch shrink-0"
                @change="echoSystem.haptic('selection'); plugins.togglePluginEnabled(plugin.manifest.id)"
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
          <!-- SUBTAB 1: Control Panel -->
          <template v-if="activeTab === 'panel'">
            <div
              v-if="plugins.safeMode || !plugin.enabled"
              class="rounded-[22px] bg-[var(--bg-card)] p-5 text-center shadow-xs space-y-2.5"
            >
              <div class="text-[14.5px] font-bold text-[var(--text-primary)]">
                {{ plugins.safeMode ? t('plugins.pausedSafeMode') : t('plugins.disabledState') }}
              </div>
              <p class="text-[12.5px] text-[var(--text-secondary)] m-0">
                开启右上角开关后即可使用本扩展控制面板。
              </p>
            </div>
            <PluginPanelRenderer v-else :plugin-id="plugin.manifest.id" />
          </template>

          <!-- SUBTAB 2: Diagnostics, Permissions, Recent 20 Sandbox Logs & Storage Management -->
          <template v-else-if="diagnostics">
            <!-- 4-Cell Diagnostics Grid -->
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
                <p class="text-[12px] text-[var(--text-secondary)] leading-relaxed m-0">
                  {{ plugin.manifest.description }}
                </p>
              </div>
            </section>

            <!-- Recent 20 Sandbox Logs -->
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

            <!-- Granted Permissions -->
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

            <!-- Management Actions: Share / Clear Sandbox Storage / Uninstall -->
            <section class="space-y-2">
              <div class="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] px-2">
                {{ t('plugins.manageActions') }}
              </div>
              <div class="rounded-[22px] bg-[var(--bg-card)] p-4 shadow-xs space-y-2.5">
                <button
                  v-if="plugin.registryUrl"
                  type="button"
                  class="w-full h-10.5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[13.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                  @click="plugins.copyShareLink(plugin.registryUrl, plugin.manifest.id)"
                >
                  <Icon :icon="iconShare" class="w-4 h-4 am-accent-text" />
                  <span>{{ t('plugins.shareMeluneLink') }}</span>
                </button>

                <button
                  type="button"
                  class="w-full h-10.5 rounded-full text-[13.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
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

                <button
                  type="button"
                  class="w-full h-10.5 rounded-full bg-[#ff3b30]/12 text-[#ff3b30] text-[13.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
                  @click="handleUninstall"
                >
                  <Icon :icon="iconTrash" class="w-4 h-4" />
                  <span>{{ t('plugins.uninstallExt') }}</span>
                </button>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>
