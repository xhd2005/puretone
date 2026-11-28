import { kugouApi } from '@/services/kugou/kugouEngine';

/**
 * Read-only helper that fetches the user's current KuGou membership expiration timestamp
 * for profile display (performs zero automated claiming or task actions).
 */
export async function fetchVipExpiryText(auth: { token: string; userid: string }): Promise<string> {
  try {
    const unionRes = await kugouApi.getBatchUnionVipInfo(auth.userid, auth);
    const busiVip = unionRes?.body?.data?.busi_vip;
    if (busiVip && typeof busiVip === 'object') {
      const arr = busiVip[auth.userid] || busiVip[Number(auth.userid)];
      if (Array.isArray(arr)) {
        const tvip = arr.find(
          (v: any) => v && (v.product_type === 'tvip' || v.busi_type === 'concept') && Number(v.is_vip) === 1,
        );
        if (tvip?.vip_end_time) return String(tvip.vip_end_time);
      }
    }
  } catch {
    // fallback to detail endpoint
  }
  try {
    const vipRes = await kugouApi.getUserVipDetail(auth);
    const list = vipRes?.body?.data?.busi_vip;
    if (Array.isArray(list)) {
      const tvip = list.find((v: any) => v?.product_type === 'tvip' && v?.vip_end_time);
      if (tvip?.vip_end_time) return String(tvip.vip_end_time);
      const anyVip = list.find((v: any) => Number(v?.is_vip) === 1 && v?.vip_end_time);
      if (anyVip?.vip_end_time) return String(anyVip.vip_end_time);
    }
  } catch {
    // ignore
  }
  return '';
}
