<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconCopy from '@iconify/icons-tabler/copy';
import iconCheck from '@iconify/icons-tabler/check';
import iconAlertCircle from '@iconify/icons-tabler/alert-circle';
import iconRefresh from '@iconify/icons-tabler/refresh';
import { pluginRuntime } from '@/services/plugins/pluginRuntime';
import type { MelunePanelView } from '@/services/plugins/types';
import { echoSystem } from '@/native/echoSystem';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{
  pluginId: string;
}>();

const ui = useUiStore();
const view = ref<MelunePanelView | null>(null);
const loading = ref(false);
const actingKey = ref('');
const inputDrafts = reactive<Record<string, string>>({});

async function refresh() {
  loading.value = true;
  try {
    const next = await pluginRuntime.renderPluginPanel(props.pluginId);
    view.value = next;
    if (next) {
      for (const sec of next.sections) {
        for (const blk of sec.blocks) {
          if (blk.type === 'text-input' && !(blk.id in inputDrafts)) {
            inputDrafts[blk.id] = blk.value || '';
          }
        }
      }
    }
  } finally {
    loading.value = false;
  }
}

async function runAction(action: string, payload?: Record<string, unknown>, key = '') {
  if (actingKey.value) return;
  echoSystem.haptic('light');
  actingKey.value = key || action;
  try {
    await pluginRuntime.dispatchPluginAction(props.pluginId, action, payload);
    await refresh();
  } finally {
    actingKey.value = '';
  }
}

async function submitTextInput(id: string, action: string) {
  const val = String(inputDrafts[id] ?? '').trim();
  await runAction(action, { id, value: val }, `input:${id}`);
}

async function copyCode(code: string) {
  if (!code) return;
  echoSystem.haptic('success');
  await echoSystem.copyToClipboard(code);
  ui.showToast('已复制到剪贴板');
}

let unsub: (() => void) | null = null;
onMounted(() => {
  void refresh();
  unsub = pluginRuntime.subscribePanelUpdates((changedId) => {
    if (changedId === props.pluginId) {
      void refresh();
    }
  });
});

watch(
  () => props.pluginId,
  () => {
    for (const k of Object.keys(inputDrafts)) delete inputDrafts[k];
    void refresh();
  },
);

onUnmounted(() => {
  unsub?.();
  unsub = null;
});
</script>

<template>
  <div class="space-y-3" data-plugin-panel-renderer>
    <div v-if="loading && !view" class="py-6 text-center text-[12.5px] text-[var(--text-secondary)]">
      正在加载扩展面板…
    </div>

    <div v-else-if="!view" class="rounded-2xl bg-[var(--bg-subtle)]/60 p-4 text-center text-[12.5px] text-[var(--text-secondary)]">
      该扩展暂无可交互面板，已作为后台能力挂载生效。
    </div>

    <template v-else>
      <div v-if="view.subtitle" class="text-[12px] text-[var(--text-secondary)] px-1">
        {{ view.subtitle }}
      </div>

      <section
        v-for="(sec, si) in view.sections"
        :key="si"
        class="rounded-[18px] bg-[var(--bg-subtle)]/55 p-3.5 space-y-3"
      >
        <div
          v-if="sec.title"
          class="text-[12px] font-bold uppercase tracking-wide text-[var(--text-secondary)]"
        >
          {{ sec.title }}
        </div>

        <template v-for="(blk, bi) in sec.blocks" :key="`${si}-${bi}`">
          <!-- Hero Stat -->
          <div v-if="blk.type === 'hero-stat'" class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[11.5px] font-medium text-[var(--text-secondary)]">{{ blk.label }}</div>
              <div class="flex items-baseline gap-1 mt-0.5">
                <span class="text-[30px] font-bold tracking-tight tabular-nums text-[var(--text-primary)] leading-none">
                  {{ blk.value }}
                </span>
                <span v-if="blk.unit" class="text-[12.5px] font-medium text-[var(--text-secondary)]">
                  {{ blk.unit }}
                </span>
              </div>
              <div v-if="blk.sub" class="text-[11.5px] text-[var(--text-secondary)] mt-1 tabular-nums">
                {{ blk.sub }}
              </div>
            </div>
            <span
              v-if="blk.badge"
              class="px-2.5 py-1 rounded-full bg-[var(--bg-card)] text-[11px] font-semibold am-accent-text shrink-0"
            >
              {{ blk.badge }}
            </span>
          </div>

          <!-- Key-Value Grid -->
          <div
            v-else-if="blk.type === 'kv-grid'"
            class="grid gap-2"
            :class="blk.columns === 3 ? 'grid-cols-3' : 'grid-cols-2'"
          >
            <div
              v-for="(item, ii) in blk.items"
              :key="ii"
              class="rounded-xl bg-[var(--bg-card)] px-3 py-2 min-w-0"
              :class="item.muted ? 'opacity-70' : ''"
            >
              <div class="text-[10.5px] text-[var(--text-secondary)] truncate">{{ item.label }}</div>
              <div
                class="text-[13px] font-bold truncate mt-0.5 tabular-nums"
                :class="item.accent ? 'am-accent-text' : 'text-[var(--text-primary)]'"
              >
                {{ item.value }}
              </div>
            </div>
          </div>

          <!-- Notice Banner -->
          <div
            v-else-if="blk.type === 'notice'"
            class="rounded-xl px-3 py-2.5 text-[12px] leading-relaxed"
            :class="
              blk.tone === 'success'
                ? 'bg-[#34c759]/12 text-[#239941]'
                : blk.tone === 'warning'
                  ? 'bg-[#ff9500]/12 text-[#c97200]'
                  : blk.tone === 'error'
                    ? 'bg-[#ff3b30]/12 text-[#d93025]'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
            "
          >
            <div v-if="blk.title" class="font-bold mb-0.5 text-[var(--text-primary)]">{{ blk.title }}</div>
            <div>{{ blk.text }}</div>
          </div>

          <!-- Copyable Code Box -->
          <div
            v-else-if="blk.type === 'copy-code'"
            class="rounded-xl bg-[var(--bg-card)] px-3 py-2.5 flex items-center justify-between gap-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="text-[11px] text-[var(--text-secondary)]">{{ blk.label }}</div>
              <div class="text-[15px] font-bold tracking-wider tabular-nums text-[var(--text-primary)] truncate mt-0.5">
                {{ blk.code }}
              </div>
              <div v-if="blk.hint" class="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">{{ blk.hint }}</div>
            </div>
            <button
              type="button"
              class="h-8 px-3 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 inline-flex items-center gap-1 shrink-0 am-tap"
              @click="copyCode(blk.code)"
            >
              <Icon :icon="iconCopy" class="w-3.5 h-3.5" />
              <span>复制</span>
            </button>
          </div>

          <!-- Action Button Row -->
          <div
            v-else-if="blk.type === 'button-row'"
            class="grid gap-2"
            :class="blk.buttons.length === 1 ? 'grid-cols-1' : blk.buttons.length === 3 ? 'grid-cols-3' : 'grid-cols-2'"
          >
            <button
              v-for="btn in blk.buttons"
              :key="btn.id"
              type="button"
              class="h-10 px-3 rounded-xl text-[13px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap min-w-0"
              :class="
                btn.variant === 'primary'
                  ? 'am-accent-bg text-white shadow-xs'
                  : btn.variant === 'danger'
                    ? 'bg-[#ff3b30]/14 text-[#ff3b30]'
                    : 'bg-[var(--bg-card)] text-[var(--text-primary)]'
              "
              :disabled="btn.disabled || Boolean(actingKey)"
              @click="runAction(btn.action, btn.payload, btn.id)"
            >
              <Icon
                v-if="btn.loading || actingKey === btn.id"
                :icon="iconRefresh"
                class="w-3.5 h-3.5 animate-spin shrink-0"
              />
              <span class="truncate">{{ btn.label }}</span>
            </button>
          </div>

          <!-- Toggle Row -->
          <label
            v-else-if="blk.type === 'toggle'"
            class="rounded-xl bg-[var(--bg-card)] px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer"
          >
            <div class="min-w-0">
              <div class="text-[13.5px] font-medium text-[var(--text-primary)]">{{ blk.label }}</div>
              <div v-if="blk.sub" class="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                {{ blk.sub }}
              </div>
            </div>
            <input
              :checked="blk.value"
              type="checkbox"
              class="ios-switch shrink-0"
              @change="runAction(blk.action, { id: blk.id, value: !blk.value }, `toggle:${blk.id}`)"
            />
          </label>

          <!-- Text Input + Submit -->
          <div v-else-if="blk.type === 'text-input'" class="rounded-xl bg-[var(--bg-card)] p-3 space-y-2">
            <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">{{ blk.label }}</div>
            <div class="flex items-center gap-2">
              <input
                v-model="inputDrafts[blk.id]"
                type="text"
                :placeholder="blk.placeholder || ''"
                class="flex-1 min-w-0 h-9 rounded-lg bg-[var(--bg-subtle)] px-2.5 text-[12.5px] text-[var(--text-primary)] border-0 outline-none"
              />
              <button
                type="button"
                class="h-9 px-3.5 rounded-lg am-accent-bg text-white text-[12.5px] font-semibold border-0 shrink-0 am-tap"
                :disabled="Boolean(actingKey)"
                @click="submitTextInput(blk.id, blk.action)"
              >
                {{ blk.submitLabel || '保存' }}
              </button>
            </div>
            <div v-if="blk.hint" class="text-[11px] text-[var(--text-tertiary)] leading-snug">{{ blk.hint }}</div>
          </div>

          <!-- Step Status Checklist -->
          <div v-else-if="blk.type === 'steps'" class="rounded-xl bg-[var(--bg-card)] divide-y divide-[var(--hairline)] overflow-hidden">
            <div
              v-for="(st, idx) in blk.items"
              :key="idx"
              class="px-3 py-2 flex items-center justify-between gap-2 text-[12px]"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <Icon
                  v-if="st.status === 'success' || st.status === 'already'"
                  :icon="iconCheck"
                  class="w-3.5 h-3.5 text-[#34c759] shrink-0"
                />
                <Icon
                  v-else-if="st.status === 'failed'"
                  :icon="iconAlertCircle"
                  class="w-3.5 h-3.5 text-[#ff3b30] shrink-0"
                />
                <Icon
                  v-else-if="st.status === 'running'"
                  :icon="iconRefresh"
                  class="w-3.5 h-3.5 am-accent-text animate-spin shrink-0"
                />
                <span v-else class="w-2 h-2 rounded-full bg-[var(--text-tertiary)]/50 mx-0.5 shrink-0" />
                <span class="font-medium text-[var(--text-primary)] truncate">{{ st.label }}</span>
              </div>
              <span class="text-[11px] text-[var(--text-secondary)] truncate max-w-[52%]">
                {{ st.detail || (st.status === 'skipped' ? '已跳过' : '') }}
              </span>
            </div>
          </div>

          <!-- Monthly Calendar Grid -->
          <div v-else-if="blk.type === 'calendar'" class="rounded-xl bg-[var(--bg-card)] p-3 space-y-2">
            <div class="text-[12px] font-semibold text-[var(--text-secondary)]">{{ blk.title }}</div>
            <div class="grid grid-cols-7 gap-1 text-center text-[10.5px] text-[var(--text-tertiary)]">
              <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
            </div>
            <div class="grid grid-cols-7 gap-1">
              <div
                v-for="cell in blk.cells"
                :key="cell.key"
                class="aspect-square flex items-center justify-center rounded-full text-[11px] font-medium tabular-nums"
                :class="
                  cell.empty
                    ? ''
                    : cell.isClaimed
                      ? 'am-accent-bg text-white font-semibold'
                      : cell.isFailed
                        ? 'bg-[#ff3b30]/15 text-[#ff3b30]'
                        : cell.isToday
                          ? 'ring-1 ring-[var(--accent)] am-accent-text font-bold'
                          : cell.isFuture
                            ? 'text-[var(--text-tertiary)]/45'
                            : 'text-[var(--text-secondary)]'
                "
              >
                {{ cell.empty ? '' : cell.day }}
              </div>
            </div>
          </div>

          <!-- Interactive Chip / Badge List -->
          <div v-else-if="blk.type === 'badge-list'" class="space-y-1.5">
            <div v-if="blk.title" class="text-[11.5px] font-medium text-[var(--text-secondary)]">
              {{ blk.title }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="(item, bi2) in blk.items"
                :key="bi2"
                type="button"
                class="px-2.5 py-1 rounded-full text-[11.5px] font-semibold border-0 am-tap"
                :class="
                  item.active
                    ? 'am-accent-bg text-white'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                "
                @click="item.action && runAction(item.action, item.payload, `badge:${bi2}`)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>
