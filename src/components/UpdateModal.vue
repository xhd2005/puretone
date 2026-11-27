<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconDownload from '@iconify/icons-tabler/download';
import iconExternalLink from '@iconify/icons-tabler/external-link';
import iconX from '@iconify/icons-tabler/x';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { formatBytes, skipUpdateVersion } from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';

const ui = useUiStore();
const { t } = useI18n();
const info = computed(() => ui.updateReleaseInfo);

const downloading = ref(false);
const progressPct = ref(0);
const downloadedText = ref('');
const activeNodeLabel = ref('');
const errorText = ref('');
let unsubProgress: (() => void) | null = null;

interface ParsedNoteLine {
  type: 'heading' | 'bullet' | 'text';
  text: string;
}

const formattedNotes = computed<ParsedNoteLine[]>(() => {
  const raw = info.value?.releaseNotes || '';
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^#{1,4}\s+/.test(line)) {
        return { type: 'heading' as const, text: line.replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '') };
      }
      if (/^[-*•]\s+/.test(line)) {
        return { type: 'bullet' as const, text: line.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '') };
      }
      return { type: 'text' as const, text: line.replace(/\*\*/g, '') };
    });
});

watch(info, async (val) => {
  errorText.value = '';
  progressPct.value = 0;
  downloadedText.value = '';
  activeNodeLabel.value = '';
  downloading.value = false;
  if (val && !unsubProgress) {
    unsubProgress = await echoSystem.onUpdateDownloadProgress((ev) => {
      if (ev.sourceLabel) activeNodeLabel.value = ev.sourceLabel;
      if (ev.error) {
        downloading.value = false;
        errorText.value = ev.error;
        return;
      }
      progressPct.value = ev.percent;
      if (ev.totalBytes > 0) {
        downloadedText.value = `${formatBytes(ev.downloadedBytes)} / ${formatBytes(ev.totalBytes)}`;
      } else if (ev.downloadedBytes > 0) {
        downloadedText.value = formatBytes(ev.downloadedBytes);
      }
      if (ev.done) {
        downloading.value = false;
        ui.showToast('安装包校验通过，请在系统弹窗中确认安装');
      }
    });
  }
});

onUnmounted(() => {
  unsubProgress?.();
  unsubProgress = null;
});

function close() {
  if (downloading.value) return;
  ui.updateReleaseInfo = null;
}

async function handleDownloadInstall() {
  if (!info.value || downloading.value) return;
  echoSystem.haptic('medium');
  errorText.value = '';

  const candidates = info.value.downloadCandidates?.length
    ? info.value.downloadCandidates
    : info.value.apkUrl
      ? [{ url: info.value.apkUrl, label: 'GitHub' }]
      : [];

  if (!candidates.length) {
    await echoSystem.openExternalUrl(info.value.htmlUrl);
    return;
  }

  downloading.value = true;
  progressPct.value = 2;
  activeNodeLabel.value = candidates[0].label;
  const res = await echoSystem.downloadAndInstallApk({
    url: candidates[0].url,
    candidates,
    fileName: info.value.apkFileName,
    expectedSha256: info.value.apkSha256,
  });
  if (!res.started) {
    downloading.value = false;
    if (res.message) {
      errorText.value = res.message;
      ui.showToast(res.message, 3200);
    }
  }
}

async function handleOpenBrowser() {
  if (!info.value) return;
  echoSystem.haptic('light');
  const preferredUrl = info.value.downloadCandidates?.[0]?.url || info.value.apkUrl || info.value.htmlUrl;
  await echoSystem.openExternalUrl(preferredUrl);
}

async function handleSkip() {
  if (!info.value) return;
  echoSystem.haptic('selection');
  await skipUpdateVersion(info.value.latestVersion);
  ui.updateReleaseInfo = null;
  ui.showToast(`已暂忽略 v${info.value.latestVersion}`);
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="info"
      class="fixed inset-0 z-[95] flex flex-col justify-end sm:items-center sm:justify-center lg-scrim"
      @click="close"
    >
      <div
        class="lg-sheet-panel rounded-t-[28px] sm:rounded-[28px] sm:max-w-md w-full px-5 pt-4 pb-[calc(var(--safe-bottom)+20px)] max-h-[84vh] flex flex-col"
        @click.stop
      >
        <div class="flex items-start justify-between gap-3 pb-3.5 am-hairline-b shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <PureToneMark :size="44" />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[19px] font-bold tracking-tight text-[var(--text-primary)]">{{ t('update.found') }}</span>
                <span class="px-2 py-0.5 rounded-full am-accent-bg text-white text-[11px] font-bold">
                  v{{ info.latestVersion }}
                </span>
              </div>
              <div class="text-[12px] text-[var(--text-secondary)] mt-0.5 tabular-nums truncate">
                {{ t('update.current', { ver: info.currentVersion }) }}
                <template v-if="info.apkSizeBytes"> · {{ formatBytes(info.apkSizeBytes) }}</template>
                <template v-if="info.publishedAt"> · {{ info.publishedAt }}</template>
              </div>
              <div
                v-if="info.checkedVia"
                class="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold am-accent-text"
              >
                <Icon :icon="iconShieldCheck" class="w-3 h-3 shrink-0" />
                <span class="truncate">{{ t('update.checkedVia', { node: info.checkedVia }) }}</span>
              </div>
            </div>
          </div>

          <button
            v-if="!downloading"
            type="button"
            class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap shrink-0"
            @click="close"
          >
            <Icon :icon="iconX" class="w-4 h-4" />
          </button>
        </div>

        <!-- Release Notes Changelog -->
        <div class="flex-1 am-scroll py-3.5 space-y-2">
          <div class="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            <Icon :icon="iconSparkles" class="w-3.5 h-3.5 am-accent-text" />
            <span>{{ t('update.changelog') }}</span>
          </div>

          <div class="rounded-[18px] bg-[var(--bg-card)] p-4 space-y-2 text-[14px] leading-relaxed">
            <template v-for="(item, idx) in formattedNotes" :key="idx">
              <div v-if="item.type === 'heading'" class="text-[14px] font-bold text-[var(--text-primary)] pt-1">
                {{ item.text }}
              </div>
              <div v-else-if="item.type === 'bullet'" class="flex items-start gap-2 text-[var(--text-primary)]">
                <span class="w-1.5 h-1.5 rounded-full am-accent-bg mt-2 shrink-0" />
                <span class="flex-1">{{ item.text }}</span>
              </div>
              <p v-else class="text-[var(--text-secondary)] m-0">{{ item.text }}</p>
            </template>
          </div>

          <!-- Download Progress Bar + Active Mirror Node -->
          <div v-if="downloading || progressPct > 0" class="rounded-[16px] bg-[var(--bg-card)] p-3.5 space-y-1.5">
            <div class="flex items-center justify-between text-[12px] font-semibold">
              <span class="text-[var(--text-primary)]">
                {{ progressPct >= 100 ? '校验通过，正在拉起安装…' : '正在下载安装包…' }}
              </span>
              <span class="am-accent-text tabular-nums">{{ progressPct }}% {{ downloadedText ? `(${downloadedText})` : '' }}</span>
            </div>
            <div v-if="activeNodeLabel" class="text-[11px] text-[var(--text-secondary)] truncate">
              {{ t('update.sourceNode', { node: activeNodeLabel }) }}
            </div>
            <div class="h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
              <div
                class="h-full rounded-full am-accent-bg transition-all duration-200"
                :style="{ width: `${progressPct}%` }"
              />
            </div>
          </div>

          <p v-if="errorText" class="text-[12px] text-[#ff3b30] px-1">{{ errorText }}</p>
        </div>

        <!-- Actions -->
        <div class="pt-3 am-hairline-t space-y-2 shrink-0">
          <button
            type="button"
            class="w-full h-12 rounded-[15px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-2 am-tap"
            :disabled="downloading"
            @click="handleDownloadInstall"
          >
            <Icon :icon="iconDownload" class="w-4.5 h-4.5" />
            <span>{{ downloading ? t('update.downloading', { pct: progressPct }) : t('update.downloadNow') }}</span>
          </button>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="h-10 rounded-[12px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[13px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
              @click="handleOpenBrowser"
            >
              <Icon :icon="iconExternalLink" class="w-4 h-4 shrink-0" />
              <span class="truncate">{{ t('update.browserDownload') }}</span>
            </button>
            <button
              type="button"
              class="h-10 rounded-[12px] bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[13px] font-semibold border-0 am-tap"
              :disabled="downloading"
              @click="handleSkip"
            >
              {{ t('update.later') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
