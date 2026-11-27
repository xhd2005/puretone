<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconBrandWechat from '@iconify/icons-tabler/brand-wechat';
import iconSend from '@iconify/icons-tabler/send';
import iconQrcode from '@iconify/icons-tabler/qrcode';
import iconExternalLink from '@iconify/icons-tabler/external-link';
import iconScan from '@iconify/icons-tabler/scan';
import { useUiStore } from '@/stores/ui';
import { useAccountsStore } from '@/stores/accounts';
import { useVipStore } from '@/stores/vip';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import { extractAccountFromLogin, kugouApi } from '@/services/kugou/kugouEngine';
import PureToneMark from './PureToneMark.vue';

const ui = useUiStore();
const accounts = useAccountsStore();
const vip = useVipStore();

const dragSheet = useDraggableSheet({
  onDismiss: () => {
    ui.loginModalOpen = false;
  },
});

type LoginMode = 'wechat' | 'sms' | 'password' | 'qr';
const mode = ref<LoginMode>('wechat');

// SMS / Password state
const mobile = ref('');
const smsCode = ref('');
const smsCountdown = ref(0);
const username = ref('');
const password = ref('');
const submitting = ref(false);
const errorMsg = ref('');

// WeChat login state
const wxLoading = ref(false);
const wxUuid = ref('');
const wxRawBase64 = ref('');
const wxQrImg = ref('');
const wxStatusText = ref('');
const wxShowQr = ref(false);
let wxSessionSeq = 0;

// KuGou QR state (Same-device friendly!)
const qrKey = ref('');
const qrImg = ref('');
const qrRawBase64 = ref('');
const qrUrl = ref('');
const qrStatusText = ref('');
let qrTimer: ReturnType<typeof setInterval> | null = null;
let smsTimer: ReturnType<typeof setInterval> | null = null;

function stopAllPolling() {
  wxSessionSeq += 1;
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

onUnmounted(() => {
  stopAllPolling();
  if (smsTimer) clearInterval(smsTimer);
});

watch(
  () => ui.loginModalOpen,
  (open) => {
    errorMsg.value = '';
    if (!open) {
      stopAllPolling();
      wxStatusText.value = '';
      wxShowQr.value = false;
    } else if (mode.value === 'qr') {
      void loadKugouQr();
    }
  },
);

watch(mode, (m) => {
  errorMsg.value = '';
  stopAllPolling();
  if (m === 'qr' && ui.loginModalOpen) {
    void loadKugouQr();
  }
});

async function finishLogin(body: Record<string, any>) {
  const profile = extractAccountFromLogin(body);
  if (!profile) {
    errorMsg.value = String(body?.error_msg || body?.msg || '登录未返回有效凭证，请重试');
    return;
  }
  stopAllPolling();
  echoSystem.haptic('success');
  await accounts.addOrUpdateAccount(profile);
  ui.loginModalOpen = false;
  ui.showToast(`欢迎回来，${profile.nickname}`);
  void vip.maybeAutoClaimOnLaunch(false);
}

// ---- WeChat Login Flow ----

async function ensureWxSession(): Promise<{ uuid: string; rawBase64: string; qrImg: string } | null> {
  if (wxUuid.value && wxRawBase64.value) {
    return { uuid: wxUuid.value, rawBase64: wxRawBase64.value, qrImg: wxQrImg.value };
  }
  wxLoading.value = true;
  errorMsg.value = '';
  wxStatusText.value = '正在准备微信登录凭证…';
  try {
    const res = await kugouApi.createWxLogin();
    wxUuid.value = res.uuid;
    wxRawBase64.value = res.rawBase64;
    wxQrImg.value = res.qrImg;
    return res;
  } catch (e: any) {
    const msg = e?.body?.msg?.message || e?.body?.error_msg || e?.message || '获取微信登录凭证失败';
    errorMsg.value = String(msg);
    wxStatusText.value = '';
    return null;
  } finally {
    wxLoading.value = false;
  }
}

async function startWxLongPoll(uuid: string) {
  const mySeq = ++wxSessionSeq;
  wxStatusText.value = '等待你在微信中确认授权，完成后返回即自动登录…';

  while (mySeq === wxSessionSeq && ui.loginModalOpen && mode.value === 'wechat') {
    try {
      const check = await kugouApi.checkWxLogin(uuid);
      if (mySeq !== wxSessionSeq) break;
      const body = check?.body || {};
      const code = Number(body.wx_errcode ?? body.status ?? 0);

      if (code === 405 && body.wx_code) {
        wxStatusText.value = '微信已授权，正在登录酷狗账号…';
        const loginRes = await kugouApi.loginByOpenPlat(String(body.wx_code));
        if (mySeq !== wxSessionSeq) break;
        await finishLogin(loginRes.body);
        return;
      } else if (code === 404) {
        wxStatusText.value = '已扫描，请在微信中点击「允许」确认登录…';
      } else if (code === 402 || code === 403) {
        wxUuid.value = '';
        wxRawBase64.value = '';
        wxQrImg.value = '';
        wxStatusText.value = code === 403 ? '你已取消微信授权，请重新点击登录' : '授权凭证已过期，请重新点击登录';
        return;
      }
    } catch {
      if (mySeq !== wxSessionSeq) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function handleOneTapWeChat(action: 'scan' | 'share') {
  echoSystem.haptic('light');
  wxUuid.value = '';
  wxRawBase64.value = '';
  const session = await ensureWxSession();
  if (!session) return;

  void startWxLongPoll(session.uuid);

  if (action === 'scan') {
    const res = await echoSystem.launchWeChatScanWithQr(session.rawBase64);
    if (res.launched) {
      ui.showToast('已存相册首张并唤起微信，点右下角相册选取即登录', 3500);
    } else {
      wxShowQr.value = true;
      errorMsg.value = res.message || '未能自动唤起微信，可直接扫码下方二维码';
    }
  } else {
    const res = await echoSystem.shareQrToWeChat(session.rawBase64);
    if (res.launched) {
      ui.showToast('请发给文件传输助手并长按识别登录', 3500);
    } else {
      wxShowQr.value = true;
      errorMsg.value = res.message || '未能唤起微信分享';
    }
  }
}

async function toggleShowWxQr() {
  wxShowQr.value = !wxShowQr.value;
  if (wxShowQr.value) {
    const session = await ensureWxSession();
    if (session) void startWxLongPoll(session.uuid);
  }
}

// ---- SMS & Password ----

async function handleSendSms() {
  const num = mobile.value.trim();
  if (!/^1\d{10}$/.test(num)) {
    errorMsg.value = '请输入正确的 11 位手机号';
    return;
  }
  echoSystem.haptic('light');
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

// ---- KuGou App QR (Same-Device First!) ----

async function loadKugouQr() {
  stopAllPolling();
  qrStatusText.value = '正在生成酷狗登录二维码…';
  qrImg.value = '';
  qrRawBase64.value = '';
  qrUrl.value = '';
  try {
    const qr = await kugouApi.createLoginQr();
    qrKey.value = qr.key;
    qrImg.value = qr.qrImg;
    qrRawBase64.value = qr.rawBase64;
    qrUrl.value = qr.url;
    qrStatusText.value = '点击下方一键打开酷狗扫码，或截图/直接扫码登录';
    qrTimer = setInterval(async () => {
      if (!qrKey.value) return;
      try {
        const check = await kugouApi.checkLoginQr(qrKey.value);
        const st = Number(check?.body?.data?.status ?? 0);
        if (st === 0) {
          qrStatusText.value = '二维码已过期，请点击刷新';
          stopAllPolling();
        } else if (st === 2) {
          qrStatusText.value = '已扫描，请在酷狗中点击确认登录…';
        } else if (st === 4) {
          stopAllPolling();
          await finishLogin(check.body);
        }
      } catch {
        // continue polling
      }
    }, 2200);
  } catch (e: any) {
    qrStatusText.value = e?.message || '二维码获取失败，请点击重试';
  }
}

async function handleSameDeviceKugouQr() {
  echoSystem.haptic('light');
  if (!qrRawBase64.value) {
    await loadKugouQr();
  }
  if (!qrRawBase64.value) return;
  const res = await echoSystem.launchKugouWithQr(qrRawBase64.value);
  if (res.launched) {
    qrStatusText.value = `等待你在${res.appName || '酷狗'}中扫码确认，返回后将自动登录…`;
    ui.showToast(res.message || '已存相册首张并打开酷狗', 3500);
  } else {
    ui.showToast(res.message || '二维码已保存至相册首张，打开酷狗扫一扫即可', 3200);
  }
}

async function handleOpenKugouH5() {
  echoSystem.haptic('light');
  if (!qrUrl.value) return;
  await echoSystem.openExternalUrl(qrUrl.value);
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.loginModalOpen"
      class="fixed inset-0 z-[90] flex flex-col justify-end lg-scrim"
      @click="ui.loginModalOpen = false"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] px-5 pt-2 pb-[calc(var(--safe-bottom)+24px)] max-h-[88vh] am-scroll"
          :style="dragSheet.sheetStyle.value"
        >
        <div
          class="touch-none pt-1 pb-3"
          @touchstart="dragSheet.onHandleTouchStart"
          @touchmove="dragSheet.onHandleTouchMove"
          @touchend="dragSheet.onHandleTouchEnd"
          @touchcancel="dragSheet.onHandleTouchEnd"
        >
          <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />
        </div>

        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <PureToneMark :size="38" />
            <div>
              <h2 class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">登录酷狗账号</h2>
              <p class="text-[12px] text-[var(--text-secondary)] mt-0.5">弥音本地直连 · 支持多号独立领 VIP</p>
            </div>
          </div>
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
            @click="ui.loginModalOpen = false"
          >
            <Icon :icon="iconX" class="w-4 h-4" />
          </button>
        </div>

        <!-- 4-Way Segmented Control -->
        <div class="grid grid-cols-4 p-1 rounded-2xl bg-[var(--bg-subtle)] mb-5">
          <button
            v-for="tab in [
              { id: 'wechat', label: '微信' },
              { id: 'qr', label: '酷狗扫码' },
              { id: 'sms', label: '验证码' },
              { id: 'password', label: '密码' },
            ]"
            :key="tab.id"
            type="button"
            class="h-8 rounded-[11px] text-[13px] font-semibold border-0 transition-all"
            :class="
              mode === tab.id
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'bg-transparent text-[var(--text-secondary)]'
            "
            @click="echoSystem.haptic('selection'); mode = tab.id as LoginMode"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- TAB 1: ONE-TAP WECHAT LOGIN -->
        <div v-if="mode === 'wechat'" class="space-y-3">
          <div class="rounded-[20px] bg-[var(--bg-card)] p-4 text-center">
            <div class="w-14 h-14 rounded-2xl bg-[#07C160]/12 text-[#07C160] mx-auto flex items-center justify-center mb-3">
              <Icon :icon="iconBrandWechat" class="w-8 h-8" />
            </div>
            <div class="text-[17px] font-bold text-[var(--text-primary)]">调用本机微信快速登录</div>
            <p class="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              点击后将自动把授权图存至相册首张并唤起微信扫一扫，点右下角相册选取确认后返回即可自动登录。
            </p>

            <button
              type="button"
              class="mt-4 w-full h-12 rounded-[14px] bg-[#07C160] text-white text-[16px] font-semibold border-0 flex items-center justify-center gap-2 am-tap"
              :disabled="wxLoading"
              @click="handleOneTapWeChat('scan')"
            >
              <Icon :icon="iconBrandWechat" class="w-5 h-5" />
              <span>{{ wxLoading ? '正在连接微信…' : '一键打开微信扫一扫登录' }}</span>
            </button>

            <button
              type="button"
              class="mt-2.5 w-full h-11 rounded-[12px] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
              :disabled="wxLoading"
              @click="handleOneTapWeChat('share')"
            >
              <Icon :icon="iconSend" class="w-4 h-4 text-[#07C160]" />
              <span>发送到微信「文件传输助手」长按识别</span>
            </button>

            <p v-if="wxStatusText" class="text-[13px] am-accent-text font-medium mt-3 leading-snug">
              {{ wxStatusText }}
            </p>
            <p v-if="errorMsg" class="text-[13px] text-[#ff3b30] mt-2">{{ errorMsg }}</p>

            <div class="mt-4 pt-3 am-hairline-t">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] bg-transparent border-0 p-1 am-tap"
                @click="toggleShowWxQr"
              >
                <Icon :icon="iconQrcode" class="w-4 h-4" />
                <span>{{ wxShowQr ? '收起二维码' : '展开二维码' }}</span>
              </button>

              <div v-if="wxShowQr" class="mt-3 flex flex-col items-center">
                <div class="w-44 h-44 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-sm">
                  <img v-if="wxQrImg" :src="wxQrImg" alt="微信登录二维码" class="w-full h-full object-contain" />
                  <span v-else class="text-[12px] text-neutral-400">正在加载二维码…</span>
                </div>
                <button
                  type="button"
                  class="mt-2.5 px-3.5 h-8 rounded-full bg-[var(--bg-subtle)] text-[12px] font-medium text-[var(--text-primary)] border-0 inline-flex items-center gap-1 am-tap"
                  @click="wxUuid = ''; wxRawBase64 = ''; wxQrImg = ''; ensureWxSession().then((s) => s && startWxLongPoll(s.uuid))"
                >
                  <Icon :icon="iconRefresh" class="w-3.5 h-3.5" />
                  <span>刷新二维码</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: KUGOU QR (Same-Device First, No "Other Device" Warning!) -->
        <div v-else-if="mode === 'qr'" class="rounded-[20px] bg-[var(--bg-card)] p-4 flex flex-col items-center">
          <div class="w-44 h-44 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-sm">
            <img v-if="qrImg" :src="qrImg" alt="酷狗登录二维码" class="w-full h-full object-contain" />
            <span v-else class="text-[12px] text-neutral-400">加载中…</span>
          </div>

          <p class="text-[13px] text-[var(--text-secondary)] mt-3 text-center leading-snug px-2">
            {{ qrStatusText }}
          </p>

          <button
            type="button"
            class="mt-4 w-full h-12 rounded-[14px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-2 am-tap"
            :disabled="!qrImg"
            @click="handleSameDeviceKugouQr"
          >
            <Icon :icon="iconScan" class="w-5 h-5" />
            <span>保存二维码并一键打开酷狗</span>
          </button>

          <div class="grid grid-cols-2 gap-2.5 w-full mt-2.5">
            <button
              type="button"
              class="h-10 rounded-[12px] bg-[var(--bg-subtle)] text-[13px] font-semibold text-[var(--text-primary)] border-0 flex items-center justify-center gap-1.5 am-tap"
              :disabled="!qrUrl"
              @click="handleOpenKugouH5"
            >
              <Icon :icon="iconExternalLink" class="w-4 h-4" />
              <span>网页授权跳转</span>
            </button>
            <button
              type="button"
              class="h-10 rounded-[12px] bg-[var(--bg-subtle)] text-[13px] font-semibold text-[var(--text-primary)] border-0 flex items-center justify-center gap-1.5 am-tap"
              @click="loadKugouQr"
            >
              <Icon :icon="iconRefresh" class="w-4 h-4" />
              <span>刷新二维码</span>
            </button>
          </div>
        </div>

        <!-- TAB 3: SMS Form -->
        <form v-else-if="mode === 'sms'" class="space-y-3" @submit.prevent="submitSms">
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

        <!-- TAB 4: Password Form -->
        <form v-else class="space-y-3" @submit.prevent="submitPassword">
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
