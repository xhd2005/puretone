<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconRefresh from '@iconify/icons-tabler/refresh';
import { useUiStore } from '@/stores/ui';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { extractAccountFromLogin, kugouApi } from '@/services/kugou/kugouEngine';

const ui = useUiStore();
const accounts = useAccountsStore();
const vip = useVipStore();

const mode = ref<'sms' | 'password' | 'qr'>('sms');
const mobile = ref('');
const smsCode = ref('');
const smsCountdown = ref(0);
const username = ref('');
const password = ref('');
const submitting = ref(false);
const errorMsg = ref('');

const qrKey = ref('');
const qrImg = ref('');
const qrStatusText = ref('');
let qrTimer: ReturnType<typeof setInterval> | null = null;
let smsTimer: ReturnType<typeof setInterval> | null = null;

function stopQrPoll() {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

onUnmounted(() => {
  stopQrPoll();
  if (smsTimer) clearInterval(smsTimer);
});

watch(
  () => ui.loginModalOpen,
  (open) => {
    errorMsg.value = '';
    if (!open) {
      stopQrPoll();
    } else if (mode.value === 'qr') {
      void loadQr();
    }
  },
);

watch(mode, (m) => {
  errorMsg.value = '';
  if (m === 'qr' && ui.loginModalOpen) {
    void loadQr();
  } else {
    stopQrPoll();
  }
});

async function handleSendSms() {
  const num = mobile.value.trim();
  if (!/^1\d{10}$/.test(num)) {
    errorMsg.value = '请输入正确的 11 位手机号';
    return;
  }
  errorMsg.value = '';
  try {
    const res = await kugouApi.sendSmsCode(num);
    if (Number(res?.body?.status) === 0) {
      errorMsg.value = String(res?.body?.error_msg || res?.body?.data || '验证码发送失败');
      return;
    }
    ui.showToast('短信验证码已发送');
    smsCountdown.value = 60;
    if (smsTimer) clearInterval(smsTimer);
    smsTimer = setInterval(() => {
      smsCountdown.value -= 1;
      if (smsCountdown.value <= 0 && smsTimer) {
        clearInterval(smsTimer);
        smsTimer = null;
      }
    }, 1000);
  } catch (e: any) {
    errorMsg.value = e?.body?.error_msg || e?.message || '发送验证码失败';
  }
}

async function finishLogin(body: Record<string, any>) {
  const profile = extractAccountFromLogin(body);
  if (!profile) {
    errorMsg.value = String(body?.error_msg || body?.msg || '登录未返回有效凭证，请检查账号或验证码');
    return;
  }
  await accounts.addOrUpdateAccount(profile);
  ui.loginModalOpen = false;
  ui.showToast(`欢迎回来，${profile.nickname}`);
  void vip.maybeAutoClaimOnLaunch(false);
}

async function submitSms() {
  if (!mobile.value.trim() || !smsCode.value.trim()) {
    errorMsg.value = '请填写手机号与验证码';
    return;
  }
  submitting.value = true;
  errorMsg.value = '';
  try {
    const res = await kugouApi.loginBySms(mobile.value.trim(), smsCode.value.trim());
    await finishLogin(res.body);
  } catch (e: any) {
    errorMsg.value = e?.body?.error_msg || e?.message || '验证码登录失败';
  } finally {
    submitting.value = false;
  }
}

async function submitPassword() {
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请填写酷狗账号与密码';
    return;
  }
  submitting.value = true;
  errorMsg.value = '';
  try {
    const res = await kugouApi.loginByPassword(username.value.trim(), password.value);
    await finishLogin(res.body);
  } catch (e: any) {
    errorMsg.value = e?.body?.error_msg || e?.message || '账号密码登录失败';
  } finally {
    submitting.value = false;
  }
}

async function loadQr() {
  stopQrPoll();
  qrStatusText.value = '正在生成酷狗登录二维码…';
  qrImg.value = '';
  try {
    const qr = await kugouApi.createLoginQr();
    qrKey.value = qr.key;
    qrImg.value = qr.qrImg;
    qrStatusText.value = '使用另一台设备的酷狗 App 扫码登录';
    qrTimer = setInterval(async () => {
      if (!qrKey.value) return;
      try {
        const check = await kugouApi.checkLoginQr(qrKey.value);
        const st = Number(check?.body?.data?.status ?? 0);
        if (st === 0) {
          qrStatusText.value = '二维码已过期，请点击刷新';
          stopQrPoll();
        } else if (st === 2) {
          qrStatusText.value = '已扫码，请在手机上确认登录';
        } else if (st === 4) {
          stopQrPoll();
          await finishLogin(check.body);
        }
      } catch {
        // continue polling
      }
    }, 2500);
  } catch (e: any) {
    qrStatusText.value = e?.message || '二维码获取失败，请重试';
  }
}
</script>

<template>
  <Transition name="am-fade">
    <div
      v-if="ui.loginModalOpen"
      class="fixed inset-0 z-[90] flex flex-col justify-end bg-black/55"
      @click="ui.loginModalOpen = false"
    >
      <div
        class="bg-[var(--bg-grouped)] rounded-t-[26px] px-5 pt-3 pb-[calc(var(--safe-bottom)+24px)] shadow-2xl"
        @click.stop
      >
        <div class="w-9 h-1 rounded-full bg-[var(--text-tertiary)]/50 mx-auto mb-3" />

        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-[22px] font-bold tracking-tight text-[var(--text-primary)]">登录酷狗账号</h2>
            <p class="text-[13px] text-[var(--text-secondary)] mt-0.5">直连酷狗概念版，支持多账号独立领 VIP</p>
          </div>
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
            @click="ui.loginModalOpen = false"
          >
            <Icon :icon="iconX" class="w-4 h-4" />
          </button>
        </div>

        <!-- iOS Segmented Control -->
        <div class="grid grid-cols-3 p-1 rounded-xl bg-[var(--bg-subtle)] mb-5">
          <button
            v-for="tab in [
              { id: 'sms', label: '短信验证码' },
              { id: 'password', label: '账号密码' },
              { id: 'qr', label: '扫码登录' },
            ]"
            :key="tab.id"
            type="button"
            class="h-8 rounded-[9px] text-[13px] font-semibold border-0 transition-all"
            :class="
              mode === tab.id
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'bg-transparent text-[var(--text-secondary)]'
            "
            @click="mode = tab.id as any"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- SMS Form -->
        <form v-if="mode === 'sms'" class="space-y-3" @submit.prevent="submitSms">
          <div class="rounded-2xl bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)]">
            <input
              v-model="mobile"
              type="tel"
              inputmode="numeric"
              placeholder="输入 11 位手机号"
              class="am-input"
            />
            <div class="flex items-center pr-2">
              <input
                v-model="smsCode"
                type="text"
                inputmode="numeric"
                placeholder="输入短信验证码"
                class="am-input flex-1"
              />
              <button
                type="button"
                class="px-3.5 h-8 rounded-full text-[13px] font-semibold border-0 am-tap shrink-0"
                :class="smsCountdown > 0 ? 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]' : 'am-accent-text bg-transparent'"
                :disabled="smsCountdown > 0"
                @click="handleSendSms"
              >
                {{ smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码' }}
              </button>
            </div>
          </div>

          <p v-if="errorMsg" class="text-[13px] text-[#ff3b30] px-1">{{ errorMsg }}</p>

          <button
            type="submit"
            class="w-full h-12 rounded-[14px] am-accent-bg text-white text-[16px] font-semibold border-0 am-tap mt-2"
            :disabled="submitting"
          >
            {{ submitting ? '登录中…' : '登录' }}
          </button>
        </form>

        <!-- Password Form -->
        <form v-else-if="mode === 'password'" class="space-y-3" @submit.prevent="submitPassword">
          <div class="rounded-2xl bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)]">
            <input v-model="username" type="text" placeholder="酷狗账号 / 手机号" class="am-input" />
            <input v-model="password" type="password" placeholder="密码" class="am-input" />
          </div>
          <p v-if="errorMsg" class="text-[13px] text-[#ff3b30] px-1">{{ errorMsg }}</p>
          <button
            type="submit"
            class="w-full h-12 rounded-[14px] am-accent-bg text-white text-[16px] font-semibold border-0 am-tap mt-2"
            :disabled="submitting"
          >
            {{ submitting ? '登录中…' : '登录' }}
          </button>
        </form>

        <!-- QR Login -->
        <div v-else class="flex flex-col items-center py-4">
          <div class="w-44 h-44 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-sm">
            <img v-if="qrImg" :src="qrImg" alt="登录二维码" class="w-full h-full object-contain" />
            <span v-else class="text-[12px] text-neutral-400">加载中…</span>
          </div>
          <p class="text-[13px] text-[var(--text-secondary)] mt-3 text-center">{{ qrStatusText }}</p>
          <button
            type="button"
            class="mt-3 px-4 h-9 rounded-full bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-primary)] border-0 flex items-center gap-1.5 am-tap"
            @click="loadQr"
          >
            <Icon :icon="iconRefresh" class="w-4 h-4" />
            <span>刷新二维码</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.am-input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  outline: none;
}
.am-input::placeholder {
  color: var(--text-tertiary);
}
</style>
