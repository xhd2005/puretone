/**
 * Clean formatting utilities for KuGou song comments & floor replies:
 * - Maps KuGou/WeChat Chinese `[玫瑰]`/`[撇嘴]` emoticon tags to crisp native Unicode emojis.
 * - Strips redundant `//@parentUser:parentComment` walls appended to every KuGou floor reply,
 *   while preserving authentic sub-thread `replyToUser` + compact 1-line quote when replying
 *   to another commenter inside the floor.
 * - Compacts verbose `YYYY-MM-DD HH:mm:ss` timestamps so usernames never get crushed.
 */

const KUGOU_EMOTICON_MAP: Record<string, string> = {
  微笑: '😊',
  撇嘴: '😒',
  色: '😍',
  发呆: '😳',
  得意: '😎',
  流泪: '😢',
  害羞: '☺️',
  闭嘴: '🤐',
  睡: '😴',
  大哭: '😭',
  尴尬: '😅',
  发怒: '😡',
  调皮: '😜',
  呲牙: '😁',
  龇牙: '😁',
  惊讶: '😮',
  难过: '😔',
  酷: '😎',
  冷汗: '😰',
  抓狂: '😫',
  吐: '🤮',
  偷笑: '🤭',
  可爱: '🥰',
  白眼: '🙄',
  傲慢: '😤',
  饥饿: '🤤',
  困: '😪',
  惊恐: '😱',
  流汗: '😓',
  憨笑: '😄',
  悠闲: '😌',
  奋斗: '💪',
  咒骂: '🤬',
  疑问: '🤔',
  嘘: '🤫',
  晕: '😵',
  折磨: '😣',
  衰: '😩',
  骷髅: '💀',
  敲打: '🔨',
  再见: '👋',
  擦汗: '😅',
  抠鼻: '😏',
  鼓掌: '👏',
  糗大了: '😳',
  坏笑: '😏',
  左哼哼: '😤',
  右哼哼: '😤',
  哈欠: '🥱',
  鄙视: '😒',
  委屈: '🥺',
  快哭了: '🥹',
  阴险: '😈',
  亲亲: '😘',
  吓: '😨',
  可怜: '🥺',
  菜刀: '🔪',
  西瓜: '🍉',
  啤酒: '🍺',
  篮球: '🏀',
  乒乓: '🏓',
  咖啡: '☕',
  饭: '🍚',
  猪头: '🐷',
  玫瑰: '🌹',
  凋谢: '🥀',
  示爱: '💋',
  爱心: '❤️',
  心碎: '💔',
  蛋糕: '🎂',
  闪电: '⚡',
  炸弹: '💣',
  刀: '🗡️',
  足球: '⚽',
  瓢虫: '🐞',
  便便: '💩',
  月亮: '🌙',
  太阳: '☀️',
  礼物: '🎁',
  拥抱: '🤗',
  强: '👍',
  弱: '👎',
  握手: '🤝',
  胜利: '✌️',
  抱拳: '🙏',
  勾引: '😉',
  拳头: '✊',
  差劲: '👎',
  爱你: '🤟',
  NO: '🙅',
  OK: '👌',
  赞: '👍',
  合十: '🙏',
  破涕为笑: '😂',
  笑哭: '😂',
  捂脸: '🤦',
  机智: '🤓',
  耶: '✌️',
  奸笑: '😏',
  皱眉: '😟',
  狗头: '🐶',
  旺柴: '🐶',
  加油: '💪',
  星星: '✨',
  音乐: '🎵',
  音符: '🎶',
  花: '🌸',
  心: '❤️',
  给力: '🔥',
  火: '🔥',
};

const EMOTICON_REGEX = /\[([^\[\]]{1,6})\]/g;

export function replaceKugouEmoticons(raw: string): string {
  if (!raw || !raw.includes('[')) return raw || '';
  return raw.replace(EMOTICON_REGEX, (full, key: string) => {
    const emoji = KUGOU_EMOTICON_MAP[key];
    return emoji ?? full;
  });
}

export interface ParsedFloorReply {
  body: string;
  replyToUser?: string;
  quotedSnippet?: string;
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, '').trim().toLowerCase();
}

/**
 * Parses KuGou floor reply `content` cleanly:
 * - Removes the redundant `//@parentUser:parentComment` suffix when replying directly to the
 *   parent comment (matching by `pid === '0'`, matching username, or matching parent content prefix
 *   to gracefully handle renamed parent accounts).
 * - Preserves `replyToUser` + compact 1-line `quotedSnippet` when replying to another commenter
 *   inside the floor thread.
 */
export function parseFloorReplyContent(
  rawContent: string,
  options: {
    pid?: string;
    parentUserName?: string;
    parentContent?: string;
    explicitReplyTo?: string;
  } = {},
): ParsedFloorReply {
  const source = (rawContent || '').trim();
  if (!source) {
    return {
      body: '',
      replyToUser: options.explicitReplyTo?.trim() || undefined,
    };
  }

  const parts = source.split('//@');
  const mainRaw = (parts[0] || '').trim();
  const body = replaceKugouEmoticons(mainRaw || source);

  if (parts.length <= 1) {
    const explicit = options.explicitReplyTo?.trim();
    const isParentExplicit =
      Boolean(explicit && options.parentUserName) &&
      normalizeForCompare(explicit!) === normalizeForCompare(options.parentUserName!);
    return {
      body,
      replyToUser: explicit && !isParentExplicit ? explicit : undefined,
    };
  }

  // Parse the immediate first quoted segment: `targetUser:targetComment` (supports `:` and `：`)
  const firstSegment = parts[1] || '';
  const colonIdx = firstSegment.search(/[:：]/);
  const targetUser = colonIdx > 0 ? firstSegment.slice(0, colonIdx).trim() : '';
  const targetSnippetRaw = colonIdx > 0 ? firstSegment.slice(colonIdx + 1).trim() : firstSegment.trim();

  const pidClean = (options.pid ?? '').trim();
  const isRootReplyByPid = pidClean === '0' && parts.length === 2;
  const isSameAsParentUser =
    Boolean(targetUser && options.parentUserName) &&
    normalizeForCompare(targetUser) === normalizeForCompare(options.parentUserName!);

  const parentNorm = normalizeForCompare(options.parentContent || '');
  const snippetNorm = normalizeForCompare(targetSnippetRaw);
  const probeLen = Math.min(10, parentNorm.length, snippetNorm.length);
  const isSameAsParentContent =
    probeLen >= 6 &&
    (parentNorm.startsWith(snippetNorm.slice(0, probeLen)) ||
      snippetNorm.startsWith(parentNorm.slice(0, probeLen)));

  // Direct reply to the parent thread root -> drop redundant repeated quote completely!
  if (isRootReplyByPid || isSameAsParentUser || isSameAsParentContent) {
    return { body };
  }

  const replyToUser = targetUser || options.explicitReplyTo?.trim() || undefined;
  const cleanedSnippet = replaceKugouEmoticons(targetSnippetRaw);

  return {
    body,
    replyToUser,
    quotedSnippet: cleanedSnippet || undefined,
  };
}

/**
 * Formats KuGou timestamps (`2020-12-28 04:04:59`) into a concise, readable date:
 * - Current year: `MM-DD HH:mm`
 * - Earlier years: `YYYY-MM-DD`
 */
export function formatCommentTime(rawTime: string, nowDate: Date = new Date()): string {
  const clean = (rawTime || '').trim();
  if (!clean) return '';
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return clean;
  const [, yyyy, mm, dd, hh, min] = m;
  if (Number(yyyy) === nowDate.getFullYear() && hh && min) {
    return `${mm}-${dd} ${hh}:${min}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}
