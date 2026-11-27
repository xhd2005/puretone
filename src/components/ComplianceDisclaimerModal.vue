<script lang="ts">
export const COMPLIANCE_ACCEPTED_KEY = 'compliance.accepted.v1';
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { APP_REPO_URL } from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';

const ui = useUiStore();
const { t } = useI18n();

const clauses = computed(() => [
  { title: t('compliance.c1.title'), body: t('compliance.c1.body') },
  { title: t('compliance.c2.title'), body: t('compliance.c2.body') },
  { title: t('compliance.c3.title'), body: t('compliance.c3.body') },
  { title: t('compliance.c4.title'), body: t('compliance.c4.body') },
  { title: t('compliance.c5.title'), body: t('compliance.c5.body') },
  { title: t('compliance.c6.title'), body: t('compliance.c6.body') },
  { title: t('compliance.c7.title'), body: t('compliance.c7.body') },
]);

async function acceptAndClose() {
  echoSystem.haptic('success');
  await echoSystem.kvSetJson(COMPLIANCE_ACCEPTED_KEY, {
    accepted: true,
    version: '2.3.0',
    acceptedAt: Date.now(),
  });
  ui.complianceModalOpen = false;
}

async function openRepo() {
  echoSystem.haptic('light');
  await echoSystem.openExternalUrl(APP_REPO_URL);
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.complianceModalOpen"
      class="fixed inset-0 z-[105] flex items-center justify-center p-4 lg-scrim"
    >
      <div
        class="lg-sheet-panel w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-3.5"
        @click.stop
      >
        <div class="flex items-center gap-3">
          <PureToneMark :size="44" />
          <div class="min-w-0">
            <h2 class="text-[18px] font-bold tracking-tight text-[var(--text-primary)]">
              {{ t('compliance.title') }}
            </h2>
            <p class="text-[12px] text-[var(--text-secondary)] mt-0.5">
              {{ t('compliance.subtitle') }}
            </p>
          </div>
        </div>

        <div class="rounded-[18px] bg-[var(--bg-card)] p-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)] space-y-2.5 max-h-[50vh] am-scroll">
          <div v-for="(c, idx) in clauses" :key="idx" class="space-y-0.5">
            <div class="font-bold text-[var(--text-primary)]">{{ c.title }}</div>
            <p class="m-0">{{ c.body }}</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <button
            type="button"
            class="w-full h-11 rounded-[14px] am-accent-bg text-white text-[14.5px] font-semibold border-0 am-tap shadow-sm"
            @click="acceptAndClose"
          >
            {{ t('compliance.accept') }}
          </button>
          <button
            type="button"
            class="w-full h-9 rounded-[12px] bg-transparent border-0 text-[12px] font-medium text-[var(--text-secondary)] am-tap"
            @click="openRepo"
          >
            {{ t('compliance.viewRepo') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
