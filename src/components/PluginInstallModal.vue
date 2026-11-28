<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import iconShieldCheck from '@iconify/icons-tabler/shield-check';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconRefresh from '@iconify/icons-tabler/refresh';
import { usePluginsStore } from '@/stores/plugins';
import { useI18n } from '@/i18n';
import type { MelunePermission } from '@/services/plugins/types';

const plugins = usePluginsStore();
const { t } = useI18n();

const review = computed(() => plugins.pendingReview);
const isInstalling = computed(() => Boolean(plugins.installingId));

const PERM_LABELS: Record<MelunePermission, { label: string; desc: string }> = {
  storage: { label: '隔离本地存储', desc: '仅可读写该扩展专属沙盒配置，无法读取账号凭证' },
  network: { label: 'HTTPS 网络请求', desc: '允许通过应用网络层访问外部公开接口' },
  'kugou.api': { label: '曲库接口调用', desc: '允许调用白名单曲库与活动查询接口' },
  'kugou.auth': { label: '账号摘要与代签', desc: '读取当前账号昵称/状态并由宿主安全代理调用（不暴露明文 Token）' },
  'audio.resolver': { label: '音频源解析扩展', desc: '提供备用候选音源检索与单曲锁定能力' },
  'lyric.filter': { label: '歌词净化过滤', desc: '在展示前对歌词文本执行过滤或排版增强' },
  'ui.panel': { label: '扩展控制面板', desc: '在扩展中心展示声明式控制卡片（禁止原始 HTML 注入）' },
  'lifecycle.launch': { label: '启动与登录事件', desc: '允许按扩展内用户开关响应应用启动或登录完成事件' },
};
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
          <div class="w-11 h-11 rounded-2xl bg-[var(--bg-subtle)] flex items-center justify-center am-accent-text shrink-0">
            <Icon :icon="iconPuzzle" class="w-6 h-6" />
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
