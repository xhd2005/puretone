<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconChevronDown from '@iconify/icons-tabler/chevron-down';
import { usePluginsStore } from '@/stores/plugins';
import { useI18n } from '@/i18n';
import { PLUGIN_PERMISSION_META, resolvePluginVisual } from '@/services/plugins/pluginUiMeta';

const plugins = usePluginsStore();
const { t } = useI18n();

const review = computed(() => plugins.pendingReview);
const isInstalling = computed(() => Boolean(plugins.installingId));
const visual = computed(() => (review.value ? resolvePluginVisual(review.value.manifest) : null));
const showTechDetails = ref(false);
const PERM_LABELS = PLUGIN_PERMISSION_META;

watch(
  () => plugins.pendingReview,
  () => {
    showTechDetails.value = plugins.developerMode;
  },
);
</script>

<template>
  <Transition name="lg-dialog">
    <div
      v-if="review"
      class="fixed inset-0 z-[102] flex items-center justify-center p-4 lg-scrim"
      @click="!isInstalling && plugins.cancelInstallReview()"
    >
      <div
        class="lg-sheet-panel lg-dialog-card w-full max-w-md rounded-[26px] p-5 shadow-2xl space-y-4"
        @click.stop
      >
        <div class="flex items-center gap-3.5">
          <div
            class="w-12 h-12 rounded-[16px] bg-gradient-to-br flex items-center justify-center text-white shadow-sm shrink-0"
            :class="visual?.gradientClass || 'from-[#3456be] to-[#5d82ff]'"
          >
            <Icon :icon="visual?.icon || iconPuzzle" class="w-6 h-6" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-[18px] font-bold text-[var(--text-primary)] truncate m-0">
              {{ review.manifest.name }}
            </h3>
            <div class="text-[12.5px] text-[var(--text-secondary)] mt-0.5 truncate">
              {{ review.isUpdate ? t('plugins.confirmUpdate') : t('plugins.confirmInstall') }}
              <span v-if="plugins.developerMode"> · v{{ review.manifest.version }}</span>
            </div>
          </div>
        </div>

        <p class="text-[13px] leading-relaxed text-[var(--text-secondary)] m-0">
          {{ review.manifest.tagline || review.manifest.description }}
        </p>

        <!-- Clean Verified Safety Badge (always friendly for normal users) -->
        <div class="rounded-2xl bg-[#34c759]/10 px-3.5 py-2.5 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <Icon :icon="iconShieldCheck" class="w-4.5 h-4.5 text-[#239941] shrink-0" />
            <span class="text-[12.5px] font-semibold text-[#239941] truncate">
              {{ t('plugins.safeVerifiedPill') }}
            </span>
          </div>
          <button
            v-if="!plugins.developerMode"
            type="button"
            class="text-[11.5px] font-medium text-[var(--text-secondary)] bg-transparent border-0 inline-flex items-center gap-0.5 shrink-0"
            @click="showTechDetails = !showTechDetails"
          >
            <span>{{ showTechDetails ? '收起' : '详情' }}</span>
            <Icon
              :icon="iconChevronDown"
              class="w-3.5 h-3.5 transition-transform"
              :class="{ 'rotate-180': showTechDetails }"
            />
          </button>
        </div>

        <!-- Technical Audit (auto-shown in Developer Mode or on-demand in Consumer Mode) -->
        <div v-if="showTechDetails || plugins.developerMode" class="space-y-2.5">
          <div class="rounded-2xl bg-[var(--bg-card)] px-3.5 py-2.5">
            <div class="text-[11px] font-semibold text-[var(--text-primary)]">{{ t('plugins.sha256Verify') }}</div>
            <div class="text-[10.5px] font-mono text-[var(--text-tertiary)] truncate mt-0.5">
              {{ review.manifest.sha256 }}
            </div>
          </div>

          <div class="rounded-2xl bg-[var(--bg-card)] divide-y divide-[var(--hairline)] max-h-[26vh] am-scroll overflow-hidden">
            <div v-for="perm in review.manifest.permissions" :key="perm" class="px-3.5 py-2">
              <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">
                {{ PERM_LABELS[perm]?.label || perm }}
              </div>
              <div class="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">
                {{ PERM_LABELS[perm]?.desc || perm }}
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            class="h-11 rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
            :disabled="isInstalling"
            @click="plugins.cancelInstallReview()"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="h-11 rounded-full am-accent-bg text-white text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            :disabled="isInstalling"
            @click="plugins.confirmPendingInstall()"
          >
            <Icon v-if="isInstalling" :icon="iconRefresh" class="w-4 h-4 animate-spin" />
            <span>{{ isInstalling ? t('plugins.verifying') : review.isUpdate ? t('plugins.updateNow') : t('plugins.installNow') }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
