import '@/polyfills/setupGlobals';
import { installCapacitorAxiosAdapter } from './capacitorAxiosAdapter';
import { echoSystem } from '@/native/echoSystem';
import type { AccountProfile, PlaylistSummary, Song } from '@/types/music';

// Static lazy registry of ONLY the ~38 KuGouMusicApi modules needed by EchoMusic Mobile
type KugouModuleFn = (params: Record<string, unknown>, useAxios: (cfg: Record<string, unknown>) => Promise<KugouApiResponse>) => Promise<KugouApiResponse>;

export interface KugouApiResponse {
  status: number;
  body: Record<string, any>;
  cookie?: string[];
  headers?: Record<string, string>;
}

export interface DeviceIdentity {
  guid: string;
  mid: string;
  dfid: string;
  webglHash: string;
  mac: string;
  dev: string;
}

export interface VerificationChallenge {
  eventId: string;
  ssaCode?: string;
}

type VerificationHandler = (challenge: VerificationChallenge) => Promise<boolean>;

const DEVICE_STORAGE_KEY = 'kugou.device.identity.v1';

const moduleLoaders: Record<string, () => Promise<{ default?: KugouModuleFn } | KugouModuleFn>> = {
  '/register/dev': () => import('@kugou/module/register_dev.js'),
  '/captcha/sent': () => import('@kugou/module/captcha_sent.js'),
  '/login/cellphone': () => import('@kugou/module/login_cellphone.js'),
  '/login': () => import('@kugou/module/login.js'),
  '/login/token': () => import('@kugou/module/login_token.js'),
  '/login/qr/key': () => import('@kugou/module/login_qr_key.js'),
  '/login/qr/create': () => import('@kugou/module/login_qr_create.js'),
  '/login/qr/check': () => import('@kugou/module/login_qr_check.js'),
  '/user/detail': () => import('@kugou/module/user_detail.js'),
  '/user/vip/detail': () => import('@kugou/module/user_vip_detail.js'),
  '/user/batch/union/vipinfo': () => import('@kugou/module/user_batch_union_vipinfo.js'),
  '/v2/batch_union_vipinfo': () => import('@kugou/module/user_batch_union_vipinfo.js'),
  '/user/verify': () => import('@kugou/module/user_verify.js'),
  '/youth/day/vip': () => import('@kugou/module/youth_day_vip.js'),
  '/youth/day/vip/upgrade': () => import('@kugou/module/youth_day_vip_upgrade.js'),
  '/youth/vip': () => import('@kugou/module/youth_vip.js'),
  '/user/listen/report': () => import('@kugou/module/user_listen_report.js'),
  '/playhistory/upload': () => import('@kugou/module/playhistory_upload.js'),
  '/user/listen': () => import('@kugou/module/user_listen.js'),
  '/user/grade/info': () => import('@kugou/module/user_grade_info.js'),
  '/youth/listen/song': () => import('@kugou/module/youth_listen_song.js'),
  '/youth/month/vip/record': () => import('@kugou/module/youth_month_vip_record.js'),
  '/youth/union/vip': () => import('@kugou/module/youth_union_vip.js'),
  '/everyday/recommend': () => import('@kugou/module/everyday_recommend.js'),
  '/personal/fm': () => import('@kugou/module/personal_fm.js'),
  '/search': () => import('@kugou/module/search.js'),
  '/search/hot': () => import('@kugou/module/search_hot.js'),
  '/search/suggest': () => import('@kugou/module/search_suggest.js'),
  '/user/playlist': () => import('@kugou/module/user_playlist.js'),
  '/playlist/detail': () => import('@kugou/module/playlist_detail.js'),
  '/playlist/track/all/new': () => import('@kugou/module/playlist_track_all_new.js'),
  '/playlist/track/all': () => import('@kugou/module/playlist_track_all.js'),
  '/playlist/tracks/add': () => import('@kugou/module/playlist_tracks_add.js'),
  '/playlist/tracks/del': () => import('@kugou/module/playlist_tracks_del.js'),
  '/user/history': () => import('@kugou/module/user_history.js'),
  '/privilege/lite': () => import('@kugou/module/privilege_lite.js'),
  '/song/url': () => import('@kugou/module/song_url.js'),
  '/song/url/new': () => import('@kugou/module/song_url_new.js'),
  '/search/lyric': () => import('@kugou/module/search_lyric.js'),
  '/lyric': () => import('@kugou/module/lyric.js'),
};

const moduleCache = new Map<string, KugouModuleFn>();

let createRequestFn: ((cfg: Record<string, unknown>) => Promise<KugouApiResponse>) | null = null;
let deviceIdentity: DeviceIdentity | null = null;
let initPromise: Promise<DeviceIdentity> | null = null;
let activeAuth: { token: string; userid: string; t1?: string } | null = null;
let verificationHandler: VerificationHandler | null = null;

function randomHex(len: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * 16)];
  }
  return out;
}

function generateMac(): string {
  const bytes = [0x02, ...Array.from({ length: 5 }, () => Math.floor(Math.random() * 256))];
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function setActiveKugouAuth(auth: { token: string; userid: string; t1?: string } | null): void {
  activeAuth = auth && auth.token ? { token: auth.token, userid: String(auth.userid || ''), t1: auth.t1 } : null;
}

export function setKugouVerificationHandler(handler: VerificationHandler | null): void {
  verificationHandler = handler;
}

async function getCreateRequest(): Promise<(cfg: Record<string, unknown>) => Promise<KugouApiResponse>> {
  if (createRequestFn) return createRequestFn;
  installCapacitorAxiosAdapter();
  const mod = (await import('@kugou/util/request.js')) as {
    createRequest?: (cfg: Record<string, unknown>) => Promise<KugouApiResponse>;
    default?: { createRequest?: (cfg: Record<string, unknown>) => Promise<KugouApiResponse> };
  };
  const fn = mod.createRequest || mod.default?.createRequest;
  if (!fn) throw new Error('Failed to load KuGouMusicApi createRequest');
  createRequestFn = fn;
  return fn;
}

export async function initKugouEngine(): Promise<DeviceIdentity> {
  if (deviceIdentity && deviceIdentity.dfid && deviceIdentity.dfid !== '-') {
    return deviceIdentity;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    installCapacitorAxiosAdapter();
    const utilMod = (await import('@kugou/util/util.js')) as Record<string, any>;
    const util = utilMod.default || utilMod;

    let saved = await echoSystem.kvGetJson<Partial<DeviceIdentity> | null>(DEVICE_STORAGE_KEY, null);
    const guid = saved?.guid || (typeof util.generateGuid === 'function' ? util.generateGuid() : randomHex(32));
    const mid = saved?.mid || (typeof util.calculateMid === 'function' ? String(util.calculateMid(guid)) : randomHex(32));
    const webglHash = saved?.webglHash || randomHex(32);
    const mac = saved?.mac || generateMac();
    const dev = saved?.dev || 'EchoMusic';
    let dfid = saved?.dfid || '';

    deviceIdentity = { guid, mid, dfid: dfid || '-', webglHash, mac, dev };

    if (!dfid || dfid === '-') {
      try {
        const regRes = await callKugouRoute('/register/dev', {}, { skipInit: true, skipAuth: true });
        const returnedDfid = String(regRes?.body?.data?.dfid || '').trim();
        if (returnedDfid) {
          dfid = returnedDfid;
          deviceIdentity.dfid = dfid;
        }
      } catch {
        // non-fatal, retry lazily on next launch
      }
    }

    await echoSystem.kvSetJson(DEVICE_STORAGE_KEY, deviceIdentity);
    return deviceIdentity;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export function getDeviceIdentity(): DeviceIdentity | null {
  return deviceIdentity;
}

export interface KugouCallOptions {
  authOverride?: { token: string; userid: string; t1?: string } | null;
  skipAuth?: boolean;
  skipInit?: boolean;
  skipVerification?: boolean;
}

function extractChallenge(resOrErr: any): VerificationChallenge | null {
  const body = resOrErr?.body ?? resOrErr?.response?.body ?? resOrErr;
  const headers = resOrErr?.headers ?? resOrErr?.response?.headers ?? {};
  const ssa =
    body?.ssaCode ??
    body?.ssa_code ??
    body?.data?.ssaCode ??
    headers?.['ssa-code'] ??
    headers?.['SSA-CODE'] ??
    '';
  const eventId = body?.data?.event_id ?? body?.event_id ?? ssa ?? '';
  const norm = String(eventId || '').trim();
  if (!norm) return null;
  return { eventId: norm, ssaCode: String(ssa || norm).trim() };
}

export async function callKugouRoute(
  route: string,
  params: Record<string, unknown> = {},
  options: KugouCallOptions = {},
): Promise<KugouApiResponse> {
  if (!options.skipInit) {
    await initKugouEngine();
  }
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  let modFn = moduleCache.get(normalizedRoute);
  if (!modFn) {
    const loader = moduleLoaders[normalizedRoute];
    if (!loader) {
      throw new Error(`Unsupported KuGou route: ${normalizedRoute}`);
    }
    const loaded = await loader();
    modFn = (typeof loaded === 'function' ? loaded : loaded.default) as KugouModuleFn;
    if (typeof modFn !== 'function') {
      throw new Error(`Invalid KuGou module export for ${normalizedRoute}`);
    }
    moduleCache.set(normalizedRoute, modFn);
  }

  const useAxios = await getCreateRequest();
  const auth = options.skipAuth ? null : options.authOverride !== undefined ? options.authOverride : activeAuth;
  const dev = deviceIdentity || {
    guid: randomHex(32),
    mid: randomHex(32),
    dfid: '-',
    webglHash: randomHex(32),
    mac: generateMac(),
    dev: 'EchoMusic',
  };

  const cookie: Record<string, string> = {
    KUGOU_API_GUID: dev.guid,
    KUGOU_API_MID: dev.mid,
    KUGOU_API_MAC: dev.mac,
    KUGOU_API_DEV: dev.dev,
    KUGOU_API_WEBGL: dev.webglHash,
    dfid: dev.dfid || '-',
    mid: dev.mid,
    uuid: dev.guid,
  };
  if (auth?.token) cookie.token = auth.token;
  if (auth?.userid) cookie.userid = String(auth.userid);
  if (auth?.t1) cookie.t1 = auth.t1;

  const queryParams: Record<string, unknown> = {
    ...params,
    cookie: { ...cookie, ...((params.cookie as Record<string, string>) || {}) },
  };
  if (auth?.token && queryParams.token === undefined) queryParams.token = auth.token;
  if (auth?.userid && queryParams.userid === undefined) queryParams.userid = auth.userid;

  const execute = async (): Promise<KugouApiResponse> => {
    const res = await modFn!(queryParams, useAxios);
    // Capture updated dfid if returned in cookie
    if (Array.isArray(res?.cookie)) {
      for (const c of res.cookie) {
        const m = /^dfid=([^;]+)/i.exec(c);
        if (m && m[1] && m[1] !== '-' && deviceIdentity && deviceIdentity.dfid !== m[1]) {
          deviceIdentity.dfid = m[1];
          void echoSystem.kvSetJson(DEVICE_STORAGE_KEY, deviceIdentity);
        }
      }
    }
    return res;
  };

  try {
    const res = await execute();
    if (!options.skipVerification && verificationHandler) {
      const challenge = extractChallenge(res);
      const errCode = Number(res?.body?.error_code ?? res?.body?.errcode ?? 0);
      if (challenge && (errCode === 20028 || res.status !== 200)) {
        const passed = await verificationHandler(challenge);
        if (passed) return execute();
      }
    }
    return res;
  } catch (err: any) {
    if (!options.skipVerification && verificationHandler) {
      const challenge = extractChallenge(err);
      if (challenge) {
        const passed = await verificationHandler(challenge);
        if (passed) return execute();
      }
    }
    throw err;
  }
}

// ---- Data Normalization Helpers ----

export function fixCoverUrl(raw?: string, size = 480): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  return url
    .replace(/\{size\}/gi, String(size))
    .replace(/^http:\/\//i, 'https://');
}

export function normalizeSong(raw: Record<string, any>): Song {
  const hash128 = String(raw.hash ?? raw.FileHash ?? raw.filehash ?? raw.audio_info?.hash ?? '').trim();
  const hash320 = String(
    raw.hash_320 ?? raw.HQFileHash ?? raw['320hash'] ?? raw.HQ?.Hash ?? raw.audio_info?.hash_320 ?? '',
  ).trim();
  const hashFlac = String(
    raw.hash_flac ?? raw.SQFileHash ?? raw.sqhash ?? raw.SQ?.Hash ?? raw.audio_info?.hash_flac ?? '',
  ).trim();

  const hash = hash128 || hash320 || hashFlac;
  const rawName = String(raw.songname ?? raw.SongName ?? raw.ori_audio_name ?? raw.name ?? raw.filename ?? '').trim();
  let title = rawName;
  let artist = String(
    raw.author_name ??
      raw.singername ??
      raw.SingerName ??
      (Array.isArray(raw.singerinfo)
        ? raw.singerinfo.map((s: any) => s?.name).filter(Boolean).join(' / ')
        : '') ??
      (Array.isArray(raw.Singers)
        ? raw.Singers.map((s: any) => s?.name).filter(Boolean).join(' / ')
        : ''),
  ).trim();

  if (!artist && rawName.includes(' - ')) {
    const idx = rawName.indexOf(' - ');
    artist = rawName.slice(0, idx).trim();
    title = rawName.slice(idx + 3).trim();
  }

  const rawDur = Number(
    raw.time_length ?? raw.timelength ?? raw.duration ?? raw.Duration ?? raw.audio_info?.duration ?? 0,
  );
  const duration = rawDur > 10000 ? Math.round(rawDur / 1000) : Math.round(rawDur || 0);

  const coverRaw =
    raw.sizable_cover ??
    raw.trans_param?.union_cover ??
    raw.album_sizable_cover ??
    raw.cover ??
    raw.img ??
    raw.Image ??
    '';

  const mixSongId = Number(raw.mixsongid ?? raw.mixSongId ?? raw.album_audio_id ?? raw.MixSongID ?? 0) || undefined;
  const privilege = Number(raw.privilege ?? raw.Privilege ?? raw.pay_type ?? 0);
  const isVip = privilege === 10 || privilege === 8 || Number(raw.pay_type_320 ?? 0) === 3;
  const isGray = privilege === 5;

  return {
    id: String(mixSongId || hash || `${artist}-${title}`),
    hash,
    hash320: hash320 || undefined,
    hashFlac: hashFlac || undefined,
    mixSongId,
    albumId: raw.album_id ? String(raw.album_id) : raw.AlbumID ? String(raw.AlbumID) : undefined,
    title: title || '未知歌曲',
    artist: artist || '未知歌手',
    album: String(raw.album_name ?? raw.AlbumName ?? raw.remark ?? '').trim(),
    duration,
    coverUrl: fixCoverUrl(coverRaw, 480),
    isVip,
    isGray,
    privilege,
  };
}

// ---- High-level Typed KuGou API ----

export const kugouApi = {
  async sendSmsCode(mobile: string) {
    return callKugouRoute('/captcha/sent', { mobile }, { skipAuth: true });
  },

  async loginBySms(mobile: string, code: string) {
    return callKugouRoute('/login/cellphone', { mobile, code }, { skipAuth: true });
  },

  async loginByPassword(username: string, password: string) {
    return callKugouRoute('/login', { username, password }, { skipAuth: true });
  },

  async refreshToken(auth: { token: string; userid: string; t1?: string }) {
    return callKugouRoute('/login/token', { token: auth.token, userid: auth.userid }, { authOverride: auth });
  },

  async createLoginQr() {
    const keyRes = await callKugouRoute('/login/qr/key', {}, { skipAuth: true });
    const qrcode = keyRes?.body?.data?.qrcode;
    if (!qrcode) throw new Error('获取登录二维码失败');
    const imgRes = await callKugouRoute('/login/qr/create', { key: qrcode, qrimg: true }, { skipAuth: true });
    return {
      key: String(qrcode),
      qrImg: String(imgRes?.body?.data?.base64 || ''),
      url: String(imgRes?.body?.data?.url || ''),
    };
  },

  async checkLoginQr(key: string) {
    return callKugouRoute('/login/qr/check', { key }, { skipAuth: true });
  },

  async getUserDetail(authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/user/detail', {}, { authOverride });
  },

  async getUserVipDetail(authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/user/vip/detail', {}, { authOverride });
  },

  async getBatchUnionVipInfo(userid: string, authOverride?: { token: string; userid: string }) {
    return callKugouRoute(
      '/v2/batch_union_vipinfo',
      { useridlist: [Number(userid)], busi_type: 'concept', get_type: '2' },
      { authOverride },
    );
  },

  async getEverydayRecommend(): Promise<Song[]> {
    const res = await callKugouRoute('/everyday/recommend');
    const list = res?.body?.data?.song_list ?? res?.body?.data?.list ?? [];
    return Array.isArray(list) ? list.map(normalizeSong) : [];
  },

  async getPersonalFm(): Promise<Song[]> {
    const res = await callKugouRoute('/personal/fm', { action: 'play', mode: 'normal' });
    const list = res?.body?.data?.song_list ?? res?.body?.data?.list ?? res?.body?.data ?? [];
    return Array.isArray(list) ? list.map(normalizeSong) : [];
  },

  async searchSongs(keywords: string, page = 1, pagesize = 30): Promise<{ songs: Song[]; total: number }> {
    const res = await callKugouRoute('/search', { keywords, page, pagesize, type: 'song' });
    const data = res?.body?.data ?? {};
    const list = data.lists ?? data.info ?? [];
    return {
      songs: Array.isArray(list) ? list.map(normalizeSong) : [],
      total: Number(data.total ?? list.length ?? 0),
    };
  },

  async searchPlaylists(keywords: string, page = 1, pagesize = 20): Promise<PlaylistSummary[]> {
    const res = await callKugouRoute('/search', { keywords, page, pagesize, type: 'special' });
    const list = res?.body?.data?.lists ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((item: any) => ({
      id: String(item.gid ?? item.specialid ?? ''),
      globalCollectionId: String(item.gid ?? item.global_collection_id ?? ''),
      name: String(item.specialname ?? item.name ?? '未命名歌单'),
      coverUrl: fixCoverUrl(item.img ?? item.pic, 400),
      trackCount: Number(item.song_count ?? item.songcount ?? 0),
      creator: String(item.nickname ?? ''),
      description: String(item.intro ?? ''),
    }));
  },

  async getHotSearch(): Promise<string[]> {
    const res = await callKugouRoute('/search/hot');
    const list = res?.body?.data?.list ?? res?.body?.data?.info ?? [];
    if (!Array.isArray(list)) return [];
    const keywords: string[] = [];
    for (const item of list) {
      if (typeof item?.keyword === 'string') keywords.push(item.keyword);
      else if (Array.isArray(item?.keywords)) {
        for (const k of item.keywords) {
          if (k?.keyword) keywords.push(String(k.keyword));
        }
      }
    }
    return Array.from(new Set(keywords)).slice(0, 16);
  },

  async getSearchSuggest(keywords: string): Promise<string[]> {
    if (!keywords.trim()) return [];
    const res = await callKugouRoute('/search/suggest', { keywords });
    const groups = res?.body?.data ?? [];
    if (!Array.isArray(groups)) return [];
    const out: string[] = [];
    for (const g of groups) {
      const records = g?.RecordDatas ?? [];
      for (const r of records) {
        if (r?.HintInfo) out.push(String(r.HintInfo));
      }
    }
    return Array.from(new Set(out)).slice(0, 10);
  },

  async getUserPlaylists(): Promise<PlaylistSummary[]> {
    const res = await callKugouRoute('/user/playlist', { page: 1, pagesize: 100 });
    const list = res?.body?.data?.info ?? [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((item: any) => item && !item.is_drop && item.name)
      .map((item: any) => ({
        id: String(item.listid ?? item.global_collection_id ?? ''),
        listId: item.listid ? String(item.listid) : undefined,
        globalCollectionId: String(item.global_collection_id ?? ''),
        name: String(item.name || '未命名歌单'),
        coverUrl: fixCoverUrl(item.pic || item.img, 400),
        trackCount: Number(item.count ?? 0),
        creator: String(item.list_create_username ?? ''),
        description: String(item.intro ?? ''),
        isFavorite: String(item.name) === '我喜欢' || Number(item.listid) === 2,
      }));
  },

  async getPlaylistTracks(globalCollectionId: string, page = 1, pagesize = 100): Promise<Song[]> {
    try {
      const res = await callKugouRoute('/playlist/track/all/new', {
        id: globalCollectionId,
        page,
        pagesize,
      });
      const list = res?.body?.data?.songs ?? res?.body?.data?.info ?? [];
      if (Array.isArray(list) && list.length > 0) return list.map(normalizeSong);
    } catch {
      // fallback to legacy endpoint
    }
    const res = await callKugouRoute('/playlist/track/all', { id: globalCollectionId, page, pagesize });
    const list = res?.body?.data?.songs ?? res?.body?.data?.info ?? [];
    return Array.isArray(list) ? list.map(normalizeSong) : [];
  },

  async addTracksToPlaylist(listid: string, songs: Song[]) {
    const data = songs
      .map((s) => `${encodeURIComponent(s.title)}|${s.hash}|${s.albumId || 0}|${s.mixSongId || 0}`)
      .join(',');
    return callKugouRoute('/playlist/tracks/add', { listid, data });
  },

  async getSongPrivilegeLite(hash: string) {
    return callKugouRoute('/privilege/lite', { hash });
  },

  async getSongUrl(hash: string, quality = '', freePart?: boolean) {
    const params: Record<string, unknown> = { hash };
    if (quality) params.quality = quality;
    if (freePart) params.free_part = 1;
    return callKugouRoute('/song/url', params);
  },

  async getSongUrlNew(hash: string, quality = '') {
    return callKugouRoute('/song/url/new', { hash, quality });
  },

  async searchLyric(keyword: string, hash: string, durationMs?: number) {
    return callKugouRoute('/search/lyric', {
      keywords: keyword,
      hash,
      timelength: durationMs || undefined,
    });
  },

  async downloadLyric(id: string, accesskey: string, fmt: 'krc' | 'lrc' = 'krc') {
    return callKugouRoute('/lyric', { id, accesskey, fmt, decode: false });
  },

  async getUserHistory(): Promise<Song[]> {
    const res = await callKugouRoute('/user/history');
    const list = res?.body?.data?.songs ?? res?.body?.data?.info ?? [];
    return Array.isArray(list) ? list.map(normalizeSong) : [];
  },

  // ---- VIP Claim Endpoints ----
  async claimDayVip(receiveDay: string, authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/youth/day/vip', { receive_day: receiveDay }, { authOverride });
  },

  async upgradeDayVip(authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/youth/day/vip/upgrade', {}, { authOverride });
  },

  async claimConceptAd(authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/youth/vip', {}, { authOverride });
  },

  async reportListeningEvent(
    payload: { event: 'start' | 'end'; mixsongid: number; duration: number },
    authOverride?: { token: string; userid: string },
  ) {
    return callKugouRoute(
      '/user/listen/report',
      {
        event: payload.event,
        mixsongid: payload.mixsongid,
        duration: payload.duration,
        state: '完整播放',
      },
      { authOverride },
    );
  },

  async uploadPlayHistory(mxid: number, authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/playhistory/upload', { mxid }, { authOverride });
  },

  async reportListenTime(
    payload: { d_sec: number; diff_sec: number },
    authOverride?: { token: string; userid: string },
  ) {
    return callKugouRoute('/user/grade/info', payload, { authOverride });
  },

  async reportYouthListenSong(mixsongid: number, authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/youth/listen/song', { mixsongid }, { authOverride });
  },

  async getMonthVipRecord(authOverride?: { token: string; userid: string }) {
    return callKugouRoute('/youth/month/vip/record', {}, { authOverride });
  },
};

export function extractAccountFromLogin(body: Record<string, any>): AccountProfile | null {
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const token = String(data?.token || '').trim();
  const userid = String(data?.userid || '').trim();
  if (!token || !userid) return null;
  const now = Date.now();
  return {
    userid,
    token,
    t1: data?.t1 ? String(data.t1) : undefined,
    nickname: String(data?.nickname || data?.username || `用户 ${userid}`),
    avatar: fixCoverUrl(data?.pic || data?.avatar || '', 240),
    vipType: Number(data?.vip_type ?? 0),
    isVip: Number(data?.is_vip ?? 0) === 1,
    vipEndTime: data?.vip_end_time ? String(data.vip_end_time) : undefined,
    addedAt: now,
    lastUsedAt: now,
  };
}
