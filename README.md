# PureTone（纯音）

> 极简无广告的 iOS 26 液态玻璃美学 Android 音乐播放器 —— 内置酷狗概念版直连引擎、四通道免配置解灰与每日四步畅听 VIP 自动签到。

## 核心特性

- **iOS 26 液态玻璃（Liquid Glass）视觉体验**：悬浮液态玻璃胶囊底栏、滑动光斑指示器、退景缩放弹窗动效、封面取色流光背景，完美支持系统浅色 / OLED 纯黑深色自适应。
- **沉浸逐字歌词 & 直觉手势**：首帧瞬时定位、3 秒自动隐藏底部控件的 Apple Music 原味逐字歌词、指针捕获丝滑进度条、封面左右滑切歌、双击红心与睡眠定时柔和渐隐。
- **内置零服务器直连引擎**：内置 `KuGouMusicApi` 模块 + Android 原生 OkHttp 零跨域请求 + Media3 ExoPlayer 前台服务 + 300MB LRU 离线缓存 + 220ms 柔和淡入淡出 + 耳机断开防外放。
- **免配置四通道极速解灰**：酷我直连 320k 原唱、酷狗同曲异版、JOOX 320k 原唱与 B 站 DASH 纯音频流并行竞速校验。
- **千首大歌单极速体验**：酷狗 v3 分页流式拉满全部曲目 + SQLite 本地快照秒开 + 无封面歌单 2×2 四宫格拼图 + 歌单内秒搜 + 红心双向真取消收藏。
- **vivo OriginOS 深度适配**：标准 Media3 锁屏大封面进度条、原子岛播控状态、线性马达微触觉反馈与 4×2 Android 桌面播控小组件。
- **每日四步 VIP 自动签到**：支持多账号独立管理、启动静默签到、日历打卡记录与每日本地提醒。

## 本地构建

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
npx cap sync android
cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug
```
