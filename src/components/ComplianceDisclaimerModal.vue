<script lang="ts">
export const COMPLIANCE_ACCEPTED_KEY = 'compliance.accepted.v1';
</script>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
import { echoSystem } from '@/native/echoSystem';
import { APP_AUTHOR, APP_REPO_URL } from '@/services/update/updateService';
import PureToneMark from './PureToneMark.vue';

const ui = useUiStore();

async function acceptAndClose() {
  echoSystem.haptic('success');
  await echoSystem.kvSetJson(COMPLIANCE_ACCEPTED_KEY, {
    accepted: true,
    version: '2.2.0',
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
      class="fixed inset-0 z-[105] flex items-center justify-center p-5 lg-scrim"
    >
      <div
        class="lg-sheet-panel w-full max-w-sm rounded-[28px] p-5 shadow-2xl space-y-4"
        @click.stop
      >
        <div class="flex items-center gap-3">
          <PureToneMark :size="44" />
          <div class="min-w-0">
            <h2 class="text-[19px] font-bold tracking-tight text-[var(--text-primary)]">
              欢迎使用纯音 · PureTone
            </h2>
            <p class="text-[12px] text-[var(--text-secondary)] mt-0.5">
              开源学习声明与免责告知
            </p>
          </div>
        </div>

        <div class="rounded-[18px] bg-[var(--bg-card)] p-3.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)] space-y-2 max-h-[42vh] am-scroll">
          <p class="m-0">
            <strong class="text-[var(--text-primary)]">1. 个人学习与非商业定位：</strong>
            PureTone（纯音）由独立开发者 <code class="font-semibold">{{ APP_AUTHOR }}</code> 基于 GPL-3.0 协议开源，仅用于跨平台移动端音频架构与 UI 动效研究，永久无广告、无任何付费与商业化行为。
          </p>
          <p class="m-0">
            <strong class="text-[var(--text-primary)]">2. 本地直连与隐私承诺：</strong>
            软件不自建中转服务器，不托管或分发任何音频文件；账号登录凭据与听歌统计仅保存在您的设备本地。
          </p>
          <p class="m-0">
            <strong class="text-[var(--text-primary)]">3. 版权尊重与合规提示：</strong>
            音频、歌词与封面版权均归原音乐平台及版权方所有。请支持正版音乐，切勿将本软件用于任何非法分发或商业用途；如涉及版权方合法权益，请联系开源仓库在 24 小时内处理。
          </p>
        </div>

        <div class="space-y-2">
          <button
            type="button"
            class="w-full h-11 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 am-tap shadow-sm"
            @click="acceptAndClose"
          >
            我已知悉并继续使用
          </button>
          <button
            type="button"
            class="w-full h-9 rounded-[12px] bg-transparent border-0 text-[12px] font-medium text-[var(--text-secondary)] am-tap"
            @click="openRepo"
          >
            查看 GitHub 开源协议与免责声明
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
