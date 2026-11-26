# EchoMusic Mobile

**极简、绝对无广告、高度致敬 Apple Music 设计语言的 Android 音乐播放器 —— 内置本地酷狗概念版直连引擎与每日四步畅听 VIP 自动签到。**

## 核心特性

- **Apple Music 极简美学（零广告、零开屏、零社交噪音）**：
  - 手机端纯净 **3 Tab** 毛玻璃底栏（`主页` / `资料库` / `搜索`）+ 悬浮毛玻璃迷你播控条（左右滑切歌）；平板横屏自动切换为 iPadOS 风格半透明侧边栏。
  - 纯白浅色 & OLED 纯黑深色跟随系统，强调色随当前播放歌曲封面主色动态平滑过渡。
  - 原味 Apple Music 全屏播放页：封面动态四色流体渐变背景、播放弹起/暂停微缩大封面、**左对齐超大加粗 KRC 逐字高亮 + 双语翻译歌词**、半透明待播队列。
- **开箱即用，零外部服务器依赖**：
  - 通过 git submodule 内置 `MakcRe/KuGouMusicApi` 核心纯 JS 模块 + Kotlin **OkHttp 4** 零 CORS 适配器。
- **原生 Media3 (ExoPlayer) 后台与蓝牙播控**：
  - 前台 `MediaSessionService` 保证锁屏/后台持续播放，系统通知栏高清封面 + 进度条 + 上/下一曲，支持蓝牙耳机线控切歌、拔耳机自动暂停、音频焦点管理与 FLAC 无损直解。
- **右上角头像 Sheet · 每日 VIP 签到与多账号**：
  - 启动 App 自动后台静默完成四步打卡（基础 VIP + 特权升级 + 广告打卡 + 四通道听歌上报链），支持多账号保存一键切换、一键全号轮签、当月打卡日历网格与可选每日定时通知提醒。
- **内置轻量灰歌自动解灰**：
  - 遇到无版权灰歌或试听片段时自动从酷狗同曲异版 / 多平台聚合源无感解灰，也支持单曲手动换源与锁定。

## 本地开发与构建 APK

```bash
# 安装依赖
pnpm install

# 前端类型检查、单元测试与生产构建
pnpm typecheck
pnpm test
pnpm build

# 同步至 Capacitor Android 工程并编译 Debug APK
npx cap sync android
cd android
./gradlew testDebugUnitTest assembleDebug
```

产物位于：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 许可证

GPL-3.0-only
