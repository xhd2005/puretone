<script lang="ts">
export const COMPLIANCE_ACCEPTED_KEY = 'compliance.accepted.v1';

export interface ComplianceAcceptanceRecord {
  accepted?: boolean;
  acceptedVersion?: string;
  version?: string;
  acceptedAt?: number;
}

/**
 * Requires explicit user re-confirmation on first install AND after EVERY app version upgrade.
 */
export function shouldShowComplianceDisclaimer(
  record: ComplianceAcceptanceRecord | null | undefined,
  currentVersion: string,
): boolean {
  const cleanCurrent = String(currentVersion || '').trim().replace(/^v/i, '');
  if (!record || !record.accepted) return true;
  const acceptedVer = String(record.acceptedVersion || record.version || '')
    .trim()
    .replace(/^v/i, '');
  if (!acceptedVer) return true;
  return acceptedVer !== cleanCurrent;
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { APP_REPO_URL, FALLBACK_APP_VERSION, getCurrentAppVersion } from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';

const ui = useUiStore();
const { t } = useI18n();
const currentVersion = ref(FALLBACK_APP_VERSION);

onMounted(async () => {
  currentVersion.value = await getCurrentAppVersion();
});

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
  const ver = currentVersion.value || (await getCurrentAppVersion());
  await echoSystem.kvSetJson(COMPLIANCE_ACCEPTED_KEY, {
    accepted: true,
    acceptedVersion: ver,
    version: ver,
    acceptedAt: Date.now(),
  } satisfies ComplianceAcceptanceRecord);
  ui.complianceAccepted = true;
  ui.complianceModalOpen = false;
}

async function declineAndExit() {
  echoSystem.haptic('light');
  await echoSystem.exitApp();
}

async function openRepo() {
  echoSystem.haptic('light');
  await echoSystem.openExternalUrl(APP_REPO_URL);
}
</script>

<template>
  <Transition name="lg-dialog">
    <div
      v-if="ui.complianceModalOpen"
      class="fixed inset-0 z-[105] flex items-center justify-center p-4 lg-scrim"
    >
      <div
        class="lg-sheet-panel lg-dialog-card w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-3.5"
        @click.stop
      >
        <div class="flex items-center gap-3">
          <PureToneMark :size="46" />
          <div class="min-w-0 flex-1">
            <h2 class="text-[17px] font-bold tracking-tight text-[var(--text-primary)] leading-snug">
              {{ t('compliance.title') }}
            </h2>
            <p class="text-[11.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">
              {{ t('compliance.subtitle', { ver: currentVersion }) }}
            </p>
          </div>
        </div>

        <div class="rounded-[18px] bg-[var(--bg-card)] p-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)] space-y-2.5 max-h-[50vh] am-scroll">
          <div v-for="(c, idx) in clauses" :key="idx" class="space-y-0.5">
            <div class="font-bold text-[var(--text-primary)]">{{ c.title }}</div>
            <p class="m-0">{{ c.body }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <button
            type="button"
            class="w-full h-11 rounded-[14px] am-accent-bg text-white text-[14.5px] font-semibold border-0 am-tap shadow-sm"
            @click="acceptAndClose"
          >
            {{ t('compliance.accept') }}
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="h-9 rounded-[12px] bg-[var(--bg-subtle)] border-0 text-[12px] font-semibold text-[var(--text-secondary)] am-tap"
              @click="declineAndExit"
            >
              {{ t('compliance.declineExit') }}
            </button>
            <button
              type="button"
              class="h-9 rounded-[12px] bg-transparent border-0 text-[12px] font-medium am-accent-text am-tap truncate"
              @click="openRepo"
            >
              {{ t('compliance.viewRepo') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
