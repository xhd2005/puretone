<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconRefresh from '@iconify/icons-tabler/refresh';
import { usePluginsStore } from '@/stores/plugins';
import { useI18n } from '@/i18n';
import { PLUGIN_PERMISSION_META, resolvePluginVisual } from '@/services/plugins/pluginUiMeta';

const plugins = usePluginsStore();
const { t } = useI18n();

const review = computed(() => plugins.pendingReview);
const isInstalling = computed(() => Boolean(plugins.installingId));
const visual = computed(() => (review.value ? resolvePluginVisual(review.value.manifest) : null));
const PERM_LABELS = PLUGIN_PERMISSION_META;
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
        <div class="flex items-start gap-3">
          <div
            class="w-11 h-11 rounded-[15px] bg-gradient-to-br flex items-center justify-center text-white shadow-sm shrink-0"
            :class="visual?.gradientClass || 'from-[#3456be] to-[#5d82ff]'"
          >
            <Icon :icon="visual?.icon || iconPuzzle" class="w-5.5 h-5.5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <h3 class="text-[16.5px] font-bold text-[var(--text-primary)] truncate">
                {{ review.isUpdate ? t('plugins.confirmUpdate') : t('plugins.confirmInstall') }}
              </h3>
              <span class="px-1.5 py-0.5 rounded-md bg-[var(--bg-subtle)] text-[10.5px] font-semibold text-[var(--text-secondary)] shrink-0">
                v{{ review.manifest.version }}
              </span>
            </div>
            <div class="text-[13px] font-semibold text-[var(--text-primary)] mt-0.5 truncate">
              {{ review.manifest.name }}
            </div>
            <div class="text-[11.5px] text-[var(--text-secondary)] truncate">
              {{ review.manifest.author }} · {{ review.manifest.protocol }}
            </div>
          </div>
        </div>

        <p class="text-[12.5px] leading-relaxed text-[var(--text-secondary)] m-0">
          {{ review.manifest.description }}
        </p>

        <!-- SHA-256 Integrity Fingerprint -->
        <div class="rounded-2xl bg-[var(--bg-card)] px-3.5 py-2.5 flex items-center gap-2.5">
          <Icon :icon="iconShieldCheck" class="w-4.5 h-4.5 text-[#34c759] shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-semibold text-[var(--text-primary)]">{{ t('plugins.sha256Verify') }}</div>
            <div class="text-[10.5px] font-mono text-[var(--text-tertiary)] truncate">
              {{ review.manifest.sha256 }}
            </div>
          </div>
        </div>

        <!-- Declared Permissions Audit -->
        <div class="space-y-1.5">
          <div class="text-[11.5px] font-semibold text-[var(--text-secondary)] px-0.5">
            {{ t('plugins.permissionsTitle', { count: review.manifest.permissions.length }) }}
          </div>
          <div class="rounded-2xl bg-[var(--bg-card)] divide-y divide-[var(--hairline)] max-h-[30vh] am-scroll overflow-hidden">
            <div
              v-for="perm in review.manifest.permissions"
              :key="perm"
              class="px-3.5 py-2"
            >
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
            class="h-10.5 rounded-[14px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
            :disabled="isInstalling"
            @click="plugins.cancelInstallReview()"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="h-10.5 rounded-[14px] am-accent-bg text-white text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
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
