import '@/polyfills/setupGlobals';
import { echoSystem } from '@/native/echoSystem';
import type {
  AccountProfile,
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  CommentClassifyTag,
  CommentHotwordTag,
  HotSearchItem,
  HotSearchTab,
  PlaylistSummary,
  Song,
  SongArtistRef,
  SongClimaxRange,
  SongComment,
  SongCommentsPage,
} from '@/types/music';

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
  '/login/wx/create': () => import('@kugou/module/login_wx_create.js'),
  '/login/wx/check': () => import('@kugou/module/login_wx_check.js'),
  '/login/openplat': () => import('@kugou/module/login_openplat.js'),
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
  '/comment/music': () => import('@kugou/module/comment_music.js'),
  '/comment/music/classify': () => import('@kugou/module/comment_music_classify.js'),
  '/comment/music/hotword': () => import('@kugou/module/comment_music_hotword.js'),
  '/comment/floor': () => import('@kugou/module/comment_floor.js'),
  '/comment/count': () => import('@kugou/module/comment_count.js'),
  '/comment/music/send': () => import('@kugou/module/comment_music_send.js'),
  '/comment/floor/send': () => import('@kugou/module/comment_floor_send.js'),
  '/artist/detail': () => import('@kugou/module/artist_detail.js'),
  '/artist/audios': () => import('@kugou/module/artist_audios.js'),
  '/artist/albums': () => import('@kugou/module/artist_albums.js'),
  '/artist/follow': () => import('@kugou/module/artist_follow.js'),
  '/artist/unfollow': () => import('@kugou/module/artist_unfollow.js'),
  '/album/detail': () => import('@kugou/module/album_detail.js'),
  '/album/songs': () => import('@kugou/module/album_songs.js'),
  '/song/climax': () => import('@kugou/module/song_climax.js'),
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
    const utilMod = (await import('@kugou/util/util.js')) as Record<string, any>;
    const util = utilMod.default || utilMod;

    let saved = await echoSystem.kvGetJson<Partial<DeviceIdentity> | null>(DEVICE_STORAGE_KEY, null);
    const guid = saved?.guid || (typeof util.generateGuid === 'function' ? util.generateGuid() : randomHex(32));
    const mid = saved?.mid || (typeof util.calculateMid === 'function' ? String(util.calculateMid(guid)) : randomHex(32));
    const webglHash = saved?.webglHash || randomHex(32);
    const mac = saved?.mac || generateMac();
    const dev = saved?.dev || 'PureTone';
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
    dev: 'PureTone',
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

const AUDIO_EXT_RE = /\.(mp3|flac|m4a|wav|ape|ogg|aac|wma)$/i;

export function stripAudioExtension(raw?: string): string {
  return String(raw || '').trim().replace(AUDIO_EXT_RE, '').trim();
}

function normArtistCompare(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s/\\、,，&·・]+/g, '')
    .trim();
}

/**
 * Strips audio extensions (.mp3/.flac/...) AND redundant "Artist - " prefixes that KuGou
 * cloud playlists often bake into song filenames even when `artist` is already provided.
 */
export function cleanSongTitleAndArtist(
  rawTitle?: string,
  rawArtist?: string,
): { title: string; artist: string } {
  let title = stripAudioExtension(rawTitle);
  let artist = stripAudioExtension(rawArtist);

  const sepMatch = /\s+[-–—]\s+/.exec(title);
  if (sepMatch && sepMatch.index > 0) {
    const left = stripAudioExtension(title.slice(0, sepMatch.index));
    const right = stripAudioExtension(title.slice(sepMatch.index + sepMatch[0].length));
    if (left && right) {
      if (!artist || artist === '未知歌手') {
        artist = left;
        title = right;
      } else {
        const normLeft = normArtistCompare(left);
        const normArt = normArtistCompare(artist);
        const primaryArt = normArtistCompare(artist.split(/[/、&,，]/)[0] || '');
        const primaryLeft = normArtistCompare(left.split(/[/、&,，]/)[0] || '');
        if (
          normLeft &&
          normArt &&
          (normLeft === normArt ||
            normLeft.includes(normArt) ||
            normArt.includes(normLeft) ||
            (primaryArt.length >= 2 && primaryArt === primaryLeft))
        ) {
          title = right;
        }
      }
    }
  }

  return {
    title: title || '未知歌曲',
    artist: artist || '未知歌手',
  };
}

export function extractSongArtistRefs(raw: Record<string, any>, fallbackArtistText = ''): SongArtistRef[] {
  const out: SongArtistRef[] = [];
  const seen = new Set<string>();
  const pushRef = (idRaw: unknown, nameRaw: unknown) => {
    const name = stripAudioExtension(String(nameRaw || '')).trim();
    const idStr = String(idRaw ?? '').trim();
    const id = idStr && idStr !== '0' && idStr !== 'null' && idStr !== 'undefined' ? idStr : '';
    if (!name) return;
    const key = `${id || 'n'}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, name });
  };

  const lists = [raw.singerinfo, raw.Singers, raw.authors, raw.base?.authors];
  for (const arr of lists) {
    if (Array.isArray(arr) && arr.length > 0) {
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        pushRef(item.id ?? item.author_id ?? item.singerid ?? item.SingerID, item.name ?? item.author_name ?? item.singername);
      }
      if (out.length > 0) return out;
    }
  }

  const singleId = raw.author_id ?? raw.singerid ?? raw.SingerId ?? raw.base?.author_id;
  const names = fallbackArtistText
    .split(/\s*(?:\/|、|&|,|，|\bfeat\.?\b|\bft\.?\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s && s !== '未知歌手');

  if (names.length === 1) {
    pushRef(singleId, names[0]);
  } else if (names.length > 1) {
    const idList = String(singleId ?? '')
      .split(/[,，/]/)
      .map((s) => s.trim());
    names.forEach((n, idx) => pushRef(idList[idx] ?? '', n));
  }
  return out;
}

export function normalizeSong(raw: Record<string, any>): Song {
  const hash128 = String(
    raw.hash ?? raw.FileHash ?? raw.filehash ?? raw.audio_info?.hash ?? raw.audio_info?.hash_128 ?? '',
  ).trim();
  const hash320 = String(
    raw.hash_320 ?? raw.HQFileHash ?? raw['320hash'] ?? raw.HQ?.Hash ?? raw.audio_info?.hash_320 ?? '',
  ).trim();
  const hashFlac = String(
    raw.hash_flac ?? raw.SQFileHash ?? raw.sqhash ?? raw.SQ?.Hash ?? raw.audio_info?.hash_flac ?? '',
  ).trim();

  const hash = hash128 || hash320 || hashFlac;
  const rawName = String(
    raw.songname ?? raw.SongName ?? raw.ori_audio_name ?? raw.audio_name ?? raw.base?.audio_name ?? raw.name ?? raw.filename ?? '',
  );
  const rawArtist = String(
    raw.author_name ??
      raw.base?.author_name ??
      raw.singername ??
      raw.SingerName ??
      (Array.isArray(raw.singerinfo)
        ? raw.singerinfo.map((s: any) => s?.name).filter(Boolean).join(' / ')
        : '') ??
      (Array.isArray(raw.Singers)
        ? raw.Singers.map((s: any) => s?.name).filter(Boolean).join(' / ')
        : '') ??
      (Array.isArray(raw.authors)
        ? raw.authors.map((s: any) => s?.author_name ?? s?.name).filter(Boolean).join(' / ')
        : ''),
  );
  const { title, artist } = cleanSongTitleAndArtist(rawName, rawArtist);
  const artists = extractSongArtistRefs(raw, artist);

  const rawDur = Number(
    raw.time_length ??
      raw.timelength ??
      raw.duration ??
      raw.Duration ??
      raw.audio_info?.duration ??
      raw.audio_info?.timelength ??
      0,
  );
  const duration = rawDur > 10000 ? Math.round(rawDur / 1000) : Math.round(rawDur || 0);

  const coverRaw =
    raw.sizable_cover ??
    raw.trans_param?.union_cover ??
    raw.album_sizable_cover ??
    raw.album_info?.sizable_cover ??
    raw.cover ??
    raw.img ??
    raw.Image ??
    '';

  const mixSongId =
    Number(raw.mixsongid ?? raw.mixSongId ?? raw.album_audio_id ?? raw.MixSongID ?? raw.base?.album_audio_id ?? 0) ||
    undefined;
  const fileId = Number(raw.fileid ?? raw.fileId ?? 0) || undefined;
  const addedAt = Number(raw.addtime ?? raw.add_time ?? raw.create_time ?? 0) || undefined;
  const privilege = Number(raw.privilege ?? raw.Privilege ?? raw.pay_type ?? raw.copyright?.privilege ?? 0);
  const isVip = privilege === 10 || privilege === 8 || Number(raw.pay_type_320 ?? 0) === 3;
  const isGray = privilege === 5 || Number(raw.fail_process ?? 0) === 12;

  const albumIdRaw = raw.album_id ?? raw.AlbumID ?? raw.album_info?.album_id ?? raw.base?.album_id;
  const albumId = albumIdRaw && String(albumIdRaw) !== '0' ? String(albumIdRaw) : undefined;

  return {
    id: String(mixSongId || hash || `${artist}-${title}`),
    hash,
    hash320: hash320 || undefined,
    hashFlac: hashFlac || undefined,
    mixSongId,
    fileId,
    addedAt,
    albumId,
    title: title || '未知歌曲',
    artist: artist || '未知歌手',
    artists: artists.length ? artists : undefined,
    album: String(raw.album_name ?? raw.AlbumName ?? raw.album_info?.album_name ?? raw.remark ?? '').trim(),
    duration,
    coverUrl: fixCoverUrl(coverRaw, 480),
    isVip,
    isGray,
    privilege,
  };
}

export function formatCompactCount(count: number, locale: 'zh-CN' | 'zh-TW' | 'en' = 'zh-CN'): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (locale === 'en') {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
  }
  const unitW = locale === 'zh-TW' ? '萬' : '万';
  const unitY = locale === 'zh-TW' ? '億' : '亿';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}${unitY}`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}${unitW}`;
  return String(n);
}

export function parseHotSearchTabs(body: Record<string, any> | null | undefined, fallbackTitle = '热搜榜'): HotSearchTab[] {
  const data = body?.data ?? body ?? {};
  const rawList = data.list ?? data.info ?? [];
  if (!Array.isArray(rawList) || !rawList.length) return [];

  const tabs: HotSearchTab[] = [];
  const flatItems: HotSearchItem[] = [];

  for (const group of rawList) {
    if (!group || typeof group !== 'object') continue;
    if (Array.isArray(group.keywords) && group.keywords.length > 0) {
      const seen = new Set<string>();
      const items: HotSearchItem[] = [];
      for (const k of group.keywords) {
        const kw = String(k?.keyword ?? k?.title ?? '').trim();
        if (!kw || seen.has(kw)) continue;
        seen.add(kw);
        const reason = String(k?.reason ?? k?.desc ?? k?.subtitle ?? '').trim() || undefined;
        const rawIcon = Number(k?.icon ?? 0);
        const tag =
          String(k?.tag ?? '').trim() ||
          (rawIcon === 1 ? 'NEW' : rawIcon === 2 || rawIcon === 3 ? 'HOT' : undefined);
        items.push({ keyword: kw, reason, tag, rank: items.length + 1 });
        if (items.length >= 20) break;
      }
      if (items.length) {
        tabs.push({
          title: String(group.name ?? group.title ?? group.tab_name ?? fallbackTitle).trim() || fallbackTitle,
          items,
        });
      }
    } else if (typeof group.keyword === 'string' && group.keyword.trim()) {
      flatItems.push({
        keyword: group.keyword.trim(),
        reason: String(group.reason ?? '').trim() || undefined,
        rank: flatItems.length + 1,
      });
    }
  }

  if (!tabs.length && flatItems.length) {
    tabs.push({ title: fallbackTitle, items: flatItems.slice(0, 20) });
  }
  return tabs;
}

export function normalizeCommentItem(raw: Record<string, any>, fallbackSpecialId = ''): SongComment {
  const likeObj = raw.like && typeof raw.like === 'object' ? raw.like : null;
  const likeCount = Number(likeObj?.likenum ?? likeObj?.count ?? raw.like_num ?? raw.likenum ?? raw.praise_num ?? 0) || 0;
  const replyCount = Number(raw.reply_num ?? raw.replynum ?? raw.reply_count ?? 0) || 0;
  const userName = String(raw.user_name ?? raw.username ?? raw.nickname ?? '匿名乐迷').trim() || '匿名乐迷';
  const rawAvatar = String(raw.user_pic ?? raw.userpic ?? raw.avatar ?? '').trim();
  const vipRaw = raw.vip_type ?? raw.vipType ?? raw.vip?.vip_type ?? 0;
  const isVip = Number(vipRaw) > 0 || Boolean(raw.is_vip);
  const addTime = String(raw.addtime ?? raw.add_time ?? raw.create_time ?? '').trim();
  const location = String(raw.location ?? raw.ip_location ?? '').trim() || undefined;
  const content = String(raw.content ?? '').trim();
  const id = String(raw.id ?? raw.cid ?? raw.comment_id ?? `${userName}-${addTime}`);
  const tid = String(raw.tid ?? raw.id ?? id);
  const specialId = String(raw.special_id ?? raw.childrenid ?? fallbackSpecialId ?? '').trim() || undefined;
  const replyToUser = String(raw.puser ?? raw.reply_user_name ?? '').trim() || undefined;

  return {
    id,
    tid,
    specialId,
    userId: raw.user_id ? String(raw.user_id) : undefined,
    userName,
    userAvatar: fixCoverUrl(rawAvatar, 120),
    isVip,
    content,
    addTime,
    location,
    likeCount,
    replyCount,
    replyToUser,
  };
}

export function normalizeClimaxRange(body: Record<string, any> | null | undefined, durationMs = 0): SongClimaxRange | null {
  const rawList = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : body?.data ? [body.data] : [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rawStart = Number(item.start_time ?? item.startTime ?? item.climax_start ?? 0);
    const rawLen = Number(item.timelength ?? item.time_length ?? item.duration ?? 0);
    if (!Number.isFinite(rawStart) || rawStart <= 0) continue;
    // KuGou climax endpoint typically returns ms (e.g. 54200, 32000), fallback if seconds
    const startMs = rawStart < 1000 && durationMs > 10000 ? rawStart * 1000 : rawStart;
    const lenMs = rawLen > 0 ? (rawLen < 600 && durationMs > 10000 ? rawLen * 1000 : rawLen) : 28000;
    const clampedStart = durationMs > 0 ? Math.min(startMs, Math.max(0, durationMs - 5000)) : startMs;
    const clampedEnd = durationMs > 0 ? Math.min(durationMs, clampedStart + lenMs) : clampedStart + lenMs;
    if (clampedEnd > clampedStart + 1000) {
      return { startMs: Math.round(clampedStart), endMs: Math.round(clampedEnd) };
    }
  }
  return null;
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
    const data = keyRes?.body?.data;
    const qrcode = data?.qrcode;
    if (!qrcode) throw new Error('获取酷狗登录二维码失败');
    let qrImg = String(data?.qrcode_img || '').trim();
    if (!qrImg) {
      const imgRes = await callKugouRoute('/login/qr/create', { key: qrcode, qrimg: true }, { skipAuth: true });
      qrImg = String(imgRes?.body?.data?.base64 || '').trim();
    }
    if (qrImg && !qrImg.startsWith('data:')) {
      qrImg = `data:image/png;base64,${qrImg}`;
    }
    const rawBase64 = qrImg.replace(/^data:image\/[^;]+;base64,/, '');
    return {
      key: String(qrcode),
      qrImg,
      rawBase64,
      url: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrcode}`,
    };
  },

  async checkLoginQr(key: string) {
    return callKugouRoute('/login/qr/check', { key }, { skipAuth: true });
  },

  async createWxLogin() {
    const res = await callKugouRoute('/login/wx/create', {}, { skipAuth: true });
    const body = res?.body || {};
    const uuid = String(body?.uuid || '').trim();
    const rawBase64 = String(body?.qrcode?.qrcodebase64 || '').trim();
    if (!uuid || !rawBase64) {
      throw new Error('获取微信登录凭证失败，请检查网络后重试');
    }
    const qrImg = rawBase64.startsWith('data:') ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`;
    return {
      uuid,
      rawBase64: rawBase64.replace(/^data:image\/[^;]+;base64,/, ''),
      qrImg,
      url: String(body?.qrcode?.qrcodeurl || `https://open.weixin.qq.com/connect/confirm?uuid=${uuid}`),
    };
  },

  async checkWxLogin(uuid: string) {
    return callKugouRoute('/login/wx/check', { uuid, timestamp: Date.now() }, { skipAuth: true });
  },

  async loginByOpenPlat(code: string) {
    return callKugouRoute('/login/openplat', { code, plat: 2 }, { skipAuth: true });
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

  async getHotSearchTabs(): Promise<HotSearchTab[]> {
    const res = await callKugouRoute('/search/hot');
    return parseHotSearchTabs(res?.body);
  },

  async getHotSearch(): Promise<string[]> {
    const tabs = await this.getHotSearchTabs();
    const keywords = tabs.flatMap((t) => t.items.map((i) => i.keyword));
    return Array.from(new Set(keywords)).slice(0, 16);
  },

  async searchArtists(keywords: string, page = 1, pagesize = 20): Promise<ArtistSummary[]> {
    const res = await callKugouRoute('/search', { keywords, page, pagesize, type: 'author' });
    const list = res?.body?.data?.lists ?? res?.body?.data?.info ?? [];
    if (!Array.isArray(list)) return [];
    return list
      .map((item: any) => ({
        id: String(item.AuthorId ?? item.author_id ?? item.singerid ?? item.id ?? '').trim(),
        name: String(item.AuthorName ?? item.author_name ?? item.singername ?? item.name ?? '').trim(),
        avatar: fixCoverUrl(item.Avatar ?? item.sizable_avatar ?? item.imgurl ?? item.pic ?? '', 300),
        songCount: Number(item.AudioCount ?? item.song_count ?? item.songcount ?? 0) || 0,
        albumCount: Number(item.AlbumCount ?? item.album_count ?? item.albumcount ?? 0) || 0,
        fansCount: Number(item.FansNum ?? item.fansnums ?? item.fans_count ?? 0) || 0,
        isFollow: Number(item.IsFollow ?? item.is_follow ?? 0) === 1,
      }))
      .filter((a: ArtistSummary) => Boolean(a.id && a.name));
  },

  async searchAlbums(keywords: string, page = 1, pagesize = 20): Promise<AlbumSummary[]> {
    const res = await callKugouRoute('/search', { keywords, page, pagesize, type: 'album' });
    const list = res?.body?.data?.lists ?? res?.body?.data?.info ?? [];
    if (!Array.isArray(list)) return [];
    return list
      .map((item: any) => ({
        id: String(item.albumid ?? item.album_id ?? item.id ?? '').trim(),
        name: String(item.albumname ?? item.album_name ?? item.name ?? '').trim(),
        artist: String(item.singer ?? item.author_name ?? item.singername ?? '').trim(),
        artistId: item.singerid || item.author_id ? String(item.singerid ?? item.author_id) : undefined,
        coverUrl: fixCoverUrl(item.img ?? item.sizable_cover ?? item.pic ?? '', 400),
        publishDate: String(item.publish_time ?? item.publish_date ?? '').slice(0, 10) || undefined,
        songCount: Number(item.songcount ?? item.song_count ?? 0) || undefined,
        language: String(item.language ?? '').trim() || undefined,
        intro: String(item.intro ?? '').trim() || undefined,
      }))
      .filter((a: AlbumSummary) => Boolean(a.id && a.name));
  },

  async resolveArtistByName(name: string): Promise<ArtistSummary | null> {
    const clean = name.trim();
    if (!clean || clean === '未知歌手') return null;
    const list = await this.searchArtists(clean, 1, 8).catch(() => []);
    if (!list.length) return null;
    const exact = list.find((a) => a.name.toLowerCase() === clean.toLowerCase());
    return exact || list[0];
  },

  async getArtistDetail(authorId: string): Promise<ArtistDetail | null> {
    const res = await callKugouRoute('/artist/detail', { id: authorId });
    const rawData = res?.body?.data;
    const d = Array.isArray(rawData) ? rawData[0] : rawData;
    if (!d || typeof d !== 'object') return null;
    const rawIntro = String(d.intro ?? d.short_intro ?? '').trim();
    const rawLong = String(d.long_intro ?? d.intro ?? '').trim();
    return {
      id: String(d.author_id ?? authorId),
      name: String(d.author_name ?? d.singername ?? '').trim() || '未知歌手',
      avatar: fixCoverUrl(d.sizable_avatar ?? d.avatar ?? d.imgurl ?? '', 480),
      songCount: Number(d.song_count ?? d.audio_count ?? 0) || 0,
      albumCount: Number(d.album_count ?? 0) || 0,
      mvCount: Number(d.mv_count ?? d.video_count ?? 0) || 0,
      fansCount: Number(d.fansnums ?? d.fans_count ?? 0) || 0,
      birthday: String(d.birthday ?? '').trim() || undefined,
      intro: rawIntro || rawLong,
      longIntro: rawLong || rawIntro,
      isFollow: Number(d.is_follow ?? d.follow_status ?? 0) === 1,
    };
  },

  async getArtistSongs(
    authorId: string,
    sort: 'hot' | 'new' = 'hot',
    page = 1,
    pagesize = 30,
  ): Promise<{ songs: Song[]; total: number; hasMore: boolean }> {
    const res = await callKugouRoute('/artist/audios', { id: authorId, sort, page, pagesize });
    const data = res?.body?.data;
    const list = Array.isArray(data) ? data : data?.songs ?? data?.list ?? data?.info ?? [];
    const total = Number(res?.body?.total ?? data?.total ?? 0) || 0;
    const songs = Array.isArray(list) ? list.map(normalizeSong) : [];
    const hasMore = total > 0 ? page * pagesize < total && songs.length > 0 : songs.length >= pagesize;
    return { songs, total, hasMore };
  },

  async getArtistAlbums(
    authorId: string,
    page = 1,
    pagesize = 24,
  ): Promise<{ albums: AlbumSummary[]; total: number; hasMore: boolean }> {
    const res = await callKugouRoute('/artist/albums', { id: authorId, sort: 'new', page, pagesize });
    const data = res?.body?.data;
    const list = Array.isArray(data) ? data : data?.albums ?? data?.list ?? [];
    const total = Number(res?.body?.total ?? data?.total ?? 0) || 0;
    const albums: AlbumSummary[] = Array.isArray(list)
      ? list
          .map((item: any) => ({
            id: String(item.album_id ?? item.albumid ?? item.id ?? '').trim(),
            name: String(item.album_name ?? item.albumname ?? item.name ?? '').trim(),
            artist: String(item.author_name ?? item.singername ?? '').trim(),
            artistId: authorId,
            coverUrl: fixCoverUrl(item.sizable_cover ?? item.img ?? item.pic ?? '', 400),
            publishDate: String(item.publish_date ?? item.publish_time ?? '').slice(0, 10) || undefined,
            songCount: Number(item.song_count ?? item.audio_count ?? 0) || undefined,
            language: String(item.language ?? '').trim() || undefined,
            intro: String(item.intro ?? '').trim() || undefined,
          }))
          .filter((a: AlbumSummary) => Boolean(a.id && a.name))
      : [];
    const hasMore = total > 0 ? page * pagesize < total && albums.length > 0 : albums.length >= pagesize;
    return { albums, total, hasMore };
  },

  async setArtistFollow(authorId: string, follow: boolean): Promise<boolean> {
    const res = await callKugouRoute(follow ? '/artist/follow' : '/artist/unfollow', { id: authorId });
    const status = Number(res?.body?.status ?? 0);
    const err = Number(res?.body?.error_code ?? res?.body?.errcode ?? 0);
    return status === 1 || err === 0;
  },

  async getAlbumDetail(albumId: string): Promise<AlbumDetail | null> {
    const [metaRes, songsRes] = await Promise.all([
      callKugouRoute('/album/detail', { id: albumId }).catch(() => null),
      callKugouRoute('/album/songs', { id: albumId, page: 1, pagesize: 100 }).catch(() => null),
    ]);
    const rawMeta = metaRes?.body?.data;
    const meta = Array.isArray(rawMeta) ? rawMeta[0] : rawMeta;
    const songsData = songsRes?.body?.data;
    const rawSongs = Array.isArray(songsData) ? songsData : songsData?.songs ?? songsData?.list ?? [];
    const songs = Array.isArray(rawSongs) ? rawSongs.map(normalizeSong) : [];
    if (!meta && !songs.length) return null;

    const firstAuthor = Array.isArray(meta?.authors) ? meta.authors[0] : null;
    return {
      id: String(meta?.album_id ?? albumId),
      name: String(meta?.album_name ?? songs[0]?.album ?? '未知专辑').trim(),
      artist: String(meta?.author_name ?? firstAuthor?.author_name ?? songs[0]?.artist ?? '未知歌手').trim(),
      artistId: firstAuthor?.author_id ? String(firstAuthor.author_id) : undefined,
      coverUrl: fixCoverUrl(meta?.sizable_cover ?? songs[0]?.coverUrl ?? '', 480),
      publishDate: String(meta?.publish_date ?? '').slice(0, 10) || undefined,
      songCount: songs.length,
      language: String(meta?.language ?? '').trim() || undefined,
      intro: String(meta?.intro ?? '').trim() || undefined,
      songs,
    };
  },

  async getSongCommentCount(song: { hash?: string; mixSongId?: number }): Promise<number> {
    if (song.hash) {
      try {
        const res = await callKugouRoute('/comment/count', { hash: song.hash });
        const body = res?.body ?? {};
        const direct = Number(body[song.hash] ?? body[song.hash.toLowerCase()] ?? body[song.hash.toUpperCase()] ?? body?.data?.[song.hash] ?? body?.count ?? 0);
        if (direct > 0) return direct;
      } catch {
        // fallback below
      }
    }
    if (song.mixSongId) {
      try {
        const res = await callKugouRoute('/comment/music', { mixsongid: song.mixSongId, page: 1, pagesize: 1 });
        return Number(res?.body?.count ?? res?.body?.data?.count ?? 0) || 0;
      } catch {
        return 0;
      }
    }
    return 0;
  },

  async getSongComments(mixSongId: number, page = 1, pagesize = 25): Promise<SongCommentsPage> {
    const res = await callKugouRoute('/comment/music', {
      mixsongid: mixSongId,
      page,
      pagesize,
      show_classify: 1,
      show_hotword_list: 1,
    });
    const b = res?.body?.data && Array.isArray(res?.body?.data?.list) ? res.body.data : res?.body ?? {};
    const specialId = String(b.special_id ?? b.childrenid ?? '').trim() || undefined;
    const hotList: any[] = page === 1 && Array.isArray(b.weightList) ? b.weightList : [];
    const mainList: any[] = Array.isArray(b.list) ? b.list : [];
    const seen = new Set<string>();
    const comments: SongComment[] = [];
    for (const raw of [...hotList, ...mainList]) {
      if (!raw || typeof raw !== 'object') continue;
      const item = normalizeCommentItem(raw, specialId || '');
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      comments.push(item);
    }
    const classifies: CommentClassifyTag[] = Array.isArray(b.classify_list)
      ? b.classify_list
          .map((c: any) => ({
            id: String(c.type_id ?? c.id ?? '').trim(),
            name: String(c.type_name ?? c.name ?? '').trim(),
            count: Number(c.count ?? c.num ?? 0) || undefined,
          }))
          .filter((c: CommentClassifyTag) => Boolean(c.id && c.name))
      : [];
    const hotwords: CommentHotwordTag[] = Array.isArray(b.hot_word_list)
      ? b.hot_word_list
          .map((w: any) => ({
            word: String(typeof w === 'string' ? w : w?.word ?? w?.hot_word ?? w?.name ?? '').trim(),
            count: Number(w?.count ?? w?.num ?? 0) || undefined,
          }))
          .filter((w: CommentHotwordTag) => Boolean(w.word))
      : [];
    const total = Number(b.count ?? comments.length) || 0;
    return {
      comments,
      total,
      hasMore: mainList.length >= pagesize && page * pagesize < Math.max(total, page * pagesize + 1),
      specialId,
      classifies,
      hotwords,
    };
  },

  async getSongCommentsByClassify(
    mixSongId: number,
    typeId: string,
    sort: 1 | 2 = 1,
    page = 1,
    pagesize = 25,
  ): Promise<SongCommentsPage> {
    const res = await callKugouRoute('/comment/music/classify', {
      mixsongid: mixSongId,
      type_id: typeId,
      sort,
      page,
      pagesize,
    });
    const b = res?.body?.data && Array.isArray(res?.body?.data?.list) ? res.body.data : res?.body ?? {};
    const specialId = String(b.special_id ?? b.childrenid ?? '').trim() || undefined;
    const mainList: any[] = Array.isArray(b.list) ? b.list : [];
    const comments = mainList.map((raw) => normalizeCommentItem(raw, specialId || ''));
    const total = Number(b.count ?? comments.length) || 0;
    return {
      comments,
      total,
      hasMore: mainList.length >= pagesize,
      specialId,
      classifies: [],
      hotwords: [],
    };
  },

  async getSongCommentsByHotword(
    mixSongId: number,
    hotWord: string,
    page = 1,
    pagesize = 25,
  ): Promise<SongCommentsPage> {
    const res = await callKugouRoute('/comment/music/hotword', {
      mixsongid: mixSongId,
      hot_word: hotWord,
      page,
      pagesize,
    });
    const b = res?.body?.data && Array.isArray(res?.body?.data?.list) ? res.body.data : res?.body ?? {};
    const specialId = String(b.special_id ?? b.childrenid ?? '').trim() || undefined;
    const mainList: any[] = Array.isArray(b.list) ? b.list : [];
    const comments = mainList.map((raw) => normalizeCommentItem(raw, specialId || ''));
    const total = Number(b.count ?? comments.length) || 0;
    return {
      comments,
      total,
      hasMore: mainList.length >= pagesize,
      specialId,
      classifies: [],
      hotwords: [],
    };
  },

  async getCommentFloorReplies(
    options: { specialId: string; tid: string; mixSongId?: number; page?: number; pagesize?: number },
  ): Promise<{ replies: SongComment[]; hasMore: boolean }> {
    const page = options.page || 1;
    const pagesize = options.pagesize || 20;
    const res = await callKugouRoute('/comment/floor', {
      special_id: options.specialId,
      tid: options.tid,
      mixsongid: options.mixSongId,
      page,
      pagesize,
    });
    const b = res?.body?.data && Array.isArray(res?.body?.data?.list) ? res.body.data : res?.body ?? {};
    const list: any[] = Array.isArray(b.list) ? b.list : [];
    const replies = list.map((raw) => normalizeCommentItem(raw, options.specialId));
    return { replies, hasMore: list.length >= pagesize };
  },

  async sendSongComment(options: {
    mixSongId?: number;
    specialId?: string;
    songName?: string;
    content: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const res = await callKugouRoute('/comment/music/send', {
      mixsongid: options.mixSongId,
      special_id: options.specialId,
      name: options.songName,
      content: options.content.trim(),
    });
    const b = res?.body ?? {};
    const ok = Number(b.status ?? 0) === 1 || Number(b.err_code ?? b.error_code ?? -1) === 0;
    return {
      ok,
      message: String(b.msg ?? b.error ?? b.errmsg ?? '').trim() || undefined,
    };
  },

  async sendFloorReply(options: {
    specialId: string;
    tid: string;
    songName?: string;
    content: string;
    replyUserName?: string;
    replyContent?: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const res = await callKugouRoute('/comment/floor/send', {
      special_id: options.specialId,
      tid: options.tid,
      name: options.songName,
      content: options.content.trim(),
      reply_user_name: options.replyUserName,
      reply_content: options.replyContent,
    });
    const b = res?.body ?? {};
    const ok = Number(b.status ?? 0) === 1 || Number(b.err_code ?? b.error_code ?? -1) === 0;
    return {
      ok,
      message: String(b.msg ?? b.error ?? b.errmsg ?? '').trim() || undefined,
    };
  },

  async getSongClimax(hash: string, durationMs = 0): Promise<SongClimaxRange | null> {
    if (!hash) return null;
    try {
      const res = await callKugouRoute('/song/climax', { hash });
      return normalizeClimaxRange(res?.body, durationMs);
    } catch {
      return null;
    }
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

  async getPlaylistTracksPaged(options: {
    globalCollectionId?: string;
    listId?: string;
    page?: number;
    pagesize?: number;
  }): Promise<{ songs: Song[]; total: number; hasMore: boolean; pageSizeReturned: number }> {
    const page = Math.max(1, Number(options.page || 1));
    const pagesize = Math.max(10, Math.min(300, Number(options.pagesize || 300)));

    // 1. Personal cloud playlist v3 API (supports `listid`, returns `fileid`, cover & up to 300/page!)
    if (options.listId) {
      try {
        const res = await callKugouRoute('/playlist/track/all/new', {
          listid: options.listId,
          page,
          pagesize,
        });
        const data = res?.body?.data ?? {};
        const list = data.songs ?? data.info ?? [];
        const total = Number(data.count ?? data.total ?? 0);
        if (Array.isArray(list) && (list.length > 0 || page > 1)) {
          const songs = list.map(normalizeSong);
          const hasMore = total > 0 ? page * pagesize < total && songs.length > 0 : songs.length >= Math.min(pagesize, 50);
          return { songs, total, hasMore, pageSizeReturned: songs.length };
        }
      } catch {
        // fallback to public collection endpoint
      }
    }

    // 2. Public / collected playlist endpoint using `global_collection_id`
    const targetId = options.globalCollectionId || options.listId || '';
    if (!targetId) {
      return { songs: [], total: 0, hasMore: false, pageSizeReturned: 0 };
    }
    const res = await callKugouRoute('/playlist/track/all', { id: targetId, page, pagesize });
    const data = res?.body?.data ?? {};
    const list = data.songs ?? data.info ?? [];
    const total = Number(data.count ?? data.total ?? 0);
    const songs = Array.isArray(list) ? list.map(normalizeSong) : [];
    const hasMore = total > 0 ? page * pagesize < total && songs.length > 0 : songs.length >= Math.min(pagesize, 50);
    return { songs, total, hasMore, pageSizeReturned: songs.length };
  },

  async getPlaylistTracks(globalCollectionId: string, page = 1, pagesize = 100, listId?: string): Promise<Song[]> {
    const res = await this.getPlaylistTracksPaged({ globalCollectionId, listId, page, pagesize });
    return res.songs;
  },

  async fetchAllPlaylistTracks(
    options: {
      globalCollectionId?: string;
      listId?: string;
      expectedCount?: number;
      maxPages?: number;
      signal?: { aborted: boolean };
      onProgress?: (accumulated: Song[], total: number, done: boolean) => void;
    },
  ): Promise<{ songs: Song[]; total: number }> {
    const pageSize = 200;
    const maxPages = options.maxPages ?? 25; // up to 5,000 tracks safely
    const accumulated: Song[] = [];
    const seenKeys = new Set<string>();
    let total = Math.max(0, options.expectedCount ?? 0);

    for (let page = 1; page <= maxPages; page += 1) {
      if (options.signal?.aborted) break;
      const res = await this.getPlaylistTracksPaged({
        globalCollectionId: options.globalCollectionId,
        listId: options.listId,
        page,
        pagesize: pageSize,
      });
      if (options.signal?.aborted) break;

      if (res.total > total) total = res.total;
      let addedInPage = 0;
      for (const s of res.songs) {
        const key = s.fileId ? `f:${s.fileId}` : s.hash ? `h:${s.hash.toLowerCase()}` : `i:${s.id}:${s.title}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        accumulated.push(s);
        addedInPage += 1;
      }

      const reachedTotal = total > 0 && accumulated.length >= total;
      const isDone =
        res.songs.length === 0 ||
        addedInPage === 0 ||
        reachedTotal ||
        (!res.hasMore && (total === 0 || accumulated.length >= total)) ||
        page === maxPages;

      options.onProgress?.([...accumulated], Math.max(total, accumulated.length), isDone);
      if (isDone) break;
    }

    return { songs: accumulated, total: Math.max(total, accumulated.length) };
  },

  async addTracksToPlaylist(listid: string, songs: Song[]) {
    const data = songs
      .map((s) => `${encodeURIComponent(s.title)}|${s.hash}|${s.albumId || 0}|${s.mixSongId || 0}`)
      .join(',');
    return callKugouRoute('/playlist/tracks/add', { listid, data });
  },

  async removeTracksFromPlaylist(listid: string, fileids: number[]) {
    const clean = fileids.filter((id) => Number.isFinite(id) && id > 0);
    if (!clean.length) return null;
    return callKugouRoute('/playlist/tracks/del', { listid, fileids: clean.join(',') });
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
