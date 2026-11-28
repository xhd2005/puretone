import type { IconifyIcon } from '@iconify/vue';
import iconCalendarCheck from '@iconify/icons-tabler/calendar-check';
import iconUsersGroup from '@iconify/icons-tabler/users-group';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconMusic from '@iconify/icons-tabler/music';
import iconWaveSine from '@iconify/icons-tabler/wave-sine';
import iconPuzzle from '@iconify/icons-tabler/puzzle';
import iconTool from '@iconify/icons-tabler/tool';
import iconMoon from '@iconify/icons-tabler/moon';
import iconWand from '@iconify/icons-tabler/wand';
import type { MelunePermission, MelunePluginManifest } from './types';

export interface PluginVisualIdentity {
  icon: IconifyIcon;
  gradientClass: string;
  categoryLabel: string;
}

export function resolvePluginVisual(manifest: Pick<MelunePluginManifest, 'icon' | 'category'>): PluginVisualIdentity {
  const iconKey = String(manifest.icon || '').toLowerCase();
  const cat = manifest.category || 'utility';

  if (iconKey === 'calendar-check') {
    return {
      icon: iconCalendarCheck,
      gradientClass: 'from-[#3456be] to-[#5d82ff]',
      categoryLabel: '账号工具',
    };
  }
  if (iconKey === 'users-group') {
    return {
      icon: iconUsersGroup,
      gradientClass: 'from-[#ff6b4a] to-[#ff375f]',
      categoryLabel: '账号工具',
    };
  }
  if (iconKey === 'moon') {
    return {
      icon: iconMoon,
      gradientClass: 'from-[#312e81] to-[#6366f1]',
      categoryLabel: '实用工具',
    };
  }
  if (iconKey === 'wand' || cat === 'lyrics') {
    return {
      icon: iconKey === 'wand' ? iconWand : iconSparkles,
      gradientClass: 'from-[#8b5cf6] to-[#ec4899]',
      categoryLabel: '歌词增强',
    };
  }
  if (iconKey === 'sparkles' || iconKey === 'wave-sine' || iconKey === 'music' || cat === 'audio') {
    return {
      icon: iconKey === 'wave-sine' ? iconWaveSine : iconKey === 'music' ? iconMusic : iconSparkles,
      gradientClass: 'from-[#0ea5e9] to-[#3456be]',
      categoryLabel: '音频扩展',
    };
  }
  if (cat === 'account') {
    return {
      icon: iconUsersGroup,
      gradientClass: 'from-[#3456be] to-[#6366f1]',
      categoryLabel: '账号工具',
    };
  }
  return {
    icon: iconKey === 'tool' ? iconTool : iconPuzzle,
    gradientClass: 'from-[#10b981] to-[#0d9488]',
    categoryLabel: '实用工具',
  };
}

export const PLUGIN_CATEGORIES = [
  { id: 'all' as const, labelKey: 'plugins.cat.all' as const },
  { id: 'account' as const, labelKey: 'plugins.cat.account' as const },
  { id: 'audio' as const, labelKey: 'plugins.cat.audio' as const },
  { id: 'lyrics' as const, labelKey: 'plugins.cat.lyrics' as const },
  { id: 'utility' as const, labelKey: 'plugins.cat.utility' as const },
] as const;

export const PLUGIN_PERMISSION_META: Record<MelunePermission, { label: string; desc: string }> = {
  storage: { label: '隔离本地存储', desc: '仅可读写该扩展专属沙盒配置，无法读取账号凭证' },
  network: { label: 'HTTPS 网络请求', desc: '允许通过应用网络层访问外部公开接口' },
  'kugou.api': { label: '曲库接口调用', desc: '允许调用白名单曲库与活动查询接口' },
  'kugou.auth': { label: '账号摘要与代签', desc: '读取当前账号昵称/状态并由宿主安全代理调用（不暴露明文 Token）' },
  'audio.resolver': { label: '音频源解析扩展', desc: '提供备用候选音源检索与单曲锁定能力' },
  'lyric.filter': { label: '歌词净化过滤', desc: '在展示前对歌词文本执行过滤或排版增强' },
  'ui.panel': { label: '扩展控制面板', desc: '在扩展中心展示声明式控制卡片（禁止原始 HTML 注入）' },
  'lifecycle.launch': { label: '启动与登录事件', desc: '允许按扩展内用户开关响应应用启动或登录完成事件' },
  'player.control': { label: '播放状态与定时暂停', desc: '只读当前播放曲目并在助眠到点时暂停播放（不接触账号）' },
};
