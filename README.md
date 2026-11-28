# 弥音 · MELUNE

<p align="center">
  <img src="docs/melune-icon.png" width="128" height="128" alt="弥音 · MELUNE Logo">
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <strong>弥音 · MELUNE</strong> —— 一个专为 Android 打造的简约、精致、纯端侧无广告第三方音乐播放器。<em>音乐终会停止，余音却可以绵延。</em>
</p>

<p align="center">
  <a href="https://github.com/xhd2005/puretone/releases/latest"><img src="https://img.shields.io/github/v/release/xhd2005/puretone?label=Release&color=3456be" alt="Latest Release"></a>
  <a href="https://github.com/xhd2005/puretone/actions/workflows/android-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/xhd2005/puretone/android-build.yml?branch=main&label=Android%20CI" alt="Android CI"></a>
  <img src="https://img.shields.io/badge/Capacitor-7.6-119eff?logo=capacitor" alt="Capacitor">
  <img src="https://img.shields.io/badge/Vue-3.5-brightgreen?logo=vue.js" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Kotlin-Media3%201.5-7f52ff?logo=kotlin" alt="Kotlin Media3">
  <img src="https://img.shields.io/badge/Platform-Android%2010%20~%2017-brightgreen?logo=android" alt="Android 10 to 17">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-orange" alt="License GPLv3"></a>
</p>

---

## ✨ 核心特性

- **极致美学**：采用 iOS 26 Liquid Glass 质感设计，支持浅色 / 深色 / 跟随系统自适应（配备自动化 `.dark` 根节点可见性门禁）、专辑封面动态流体取色、零闪屏月夜开屏与简/繁/英三语界面。
- **数据路径透明**：100% 纯端侧直连，所有协议请求与本地数据均由设备直接完成；不架设任何音频中转服务器，不提供云端账号托管，永久无广告。
- **音乐推荐**：支持每日推荐、精选歌单与个性化发现，首页内容支持本地 SQLite 快照秒开。
- **多维探索**：支持歌曲、歌手、专辑、歌单 4 页签全库搜索与多分类热搜榜，快速触达心仪曲目。
- **歌手与专辑档案**：提供高清歌手主页（作品/专辑/粉丝统计、简介弹窗、关注/取关、热门与最新筛选、合唱多歌手选择器）与完整专辑详情页。
- **进阶播放**：基于 Jetpack Media3 原生 2 曲前瞻队列，支持队列置顶/移除、播放模式切换、倍速播放、余弦淡入淡出切歌（关闭 / `1.5s` / `3s` / `5s`），并在 seek 短暂缓冲期保持播放态稳定，彻底消除封面缩放抽搐与进度条回弹。
- **零中断自愈与试听拦截**：每首曲目独立绑定 HTTP 请求头，彻底隔离预加载下一首报错；全链路拦截 30s / 60s 试听片段与提前 EOF 截断流，异常时按「刷新直链 → 强制解灰完整源 → 稳流降级」3 级原地精确秒数续播，绝不中途自动切歌。
- **智能换源解灰**：内置 4 通道并发原唱候选评分匹配，支持单曲手动试听与永久锁定偏好音源。
- **私人 FM**：智能推荐个性化电台，并在播放接近队列尾部时提前续载，息屏不断流。
- **云端歌单与秒开快照**：支持云端歌单新建、编辑、隐私设置、删除、收藏与底部接管式批量加歌/移歌；本地 SQLite 快照通过云端版本号 `totalVer` 校验，未变动时 0 网络请求秒开「我喜欢」与千首大歌单，本机红心/增删原地增量更新。
- **本地智能缓存与离线直放**：基于 `DynamicLruCacheEvictor` + Media3 `SimpleCache`，支持 `500 MB / 1 GB / 2 GB（默认）/ 4 GB / 无上限` 五档热调，按「曲目 + 音质 + 音源」分桶隔离（试听片段不落盘），弱网与飞行模式自动本地直放，音频缓存与歌单快照独立透明清理。
- **歌曲详情与评论**：支持查看多音质规格档案，以及推荐 / 最热 / 最新 / 热词 4 模式评论、楼中楼清洗去重、百余种原生 Emoji 映射、实时点赞与回复。
- **逐字歌词与海报工坊**：内置「酷狗 KRC 逐字 + 译文 → 网易云双语 LRC → LRCLIB」三级回退引擎，单调时钟零闪烁渲染，支持 3 档字号、单曲记忆词轴微调、进度条副歌高潮（`song_climax`）标记跳转，以及 120fps 5 模板 1080P 歌词海报工坊。
- **音频增强**：内置 5 档严格 `<= 0 dB` 无削波减法均衡器（原声 / 人声 / 低音 / 深夜 / 现场，切档柔降无爆音）与 Android `LoudnessEnhancer` 响度均衡。
- **系统媒体控制与小组件**：原生集成 `MediaSessionService` 锁屏/蓝牙播控与 Android 16/17 官方 Live Updates，配套 4×2 封面动态取色桌面播控小组件（含红心联动）。
- **多账号签到与听歌洞察**：支持多账号切换、每日自动续期签到日历以及 iOS 屏幕时间风格的本地听歌统计图表。
- **持久化与迁移备份**：全量偏好、队列、历史与快照由原生 SQLite 持久化存储；支持导出/恢复纯文本 JSON 备份（严格排除所有登录 Cookie 与 Token）。
- **全机型兼容**：内置构建期 CSS 兼容降级插件，自动为 Android 11 / Chromium 80+ 旧版 WebView 展开现代语法，老机型与旗舰机同样流畅。
- **应用内自动更新**：冷启动静默检测新版本（区分「稍后提醒」与「忽略此版本」），内置多路国内加速镜像、jsDelivr CDN、自定义镜像前缀与端侧 APK SHA-256 强制校验。
- **持续集成**：完善的 GitHub Actions 流水线，自动完成类型检查、双端单元测试、永久签名构建、Release 发布与 `updates` 分支清单同步。

## 🛠️ 技术栈

- **Mobile Runtime**: [Capacitor](https://capacitorjs.com/) 7.6
- **Frontend**: [Vue 3.5](https://vuejs.org/) + [TypeScript 5.8](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vite.dev/) 6（含自研旧版 WebView CSS 兼容插件）
- **State Management**: [Pinia](https://pinia.vuejs.org/) 3 + 原生 SQLite KV 持久化
- **CSS**: [Tailwind CSS](https://tailwindcss.com/) v4.1
- **Routing**: [Vue Router](https://router.vuejs.org/) 4
- **Package Manager**: [pnpm](https://pnpm.io/) 9+
- **Native Audio Engine**: [Android Jetpack Media3](https://github.com/androidx/media) 1.5.1（`ExoPlayer` + `MediaSessionService` + `SimpleCache`）
- **Native Network & System**: [Kotlin](https://kotlinlang.org/) + [OkHttp](https://square.github.io/okhttp/) 4.12 + `kotlinx.coroutines` 1.9 + Android AppWidget
- **Protocol Engine**: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)（`server` 子模块，端侧零中转直连）
- **Testing**: [Vitest](https://vitest.dev/) 3（101 项前端测试）+ JUnit 4（Android 原生单测）

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [JDK 21](https://adoptium.net/)（Temurin 推荐，Android 工程指定 `JavaVersion.VERSION_21`）
- Android SDK 35（`platforms;android-35`、`build-tools;35.0.0`）

请确保当前终端已配置 `JAVA_HOME` 与 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）：

**macOS / Linux（Bash）：**

```bash
export JAVA_HOME="/path/to/jdk-21"
export ANDROID_HOME="$HOME/Android/Sdk"
```

**Windows（PowerShell）：**

```powershell
$env:JAVA_HOME = "C:\Android\jdk-21"
$env:ANDROID_HOME = "C:\Android\Sdk"
$env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
```

### 本地开发

1. **克隆仓库（含 `server` 子模块）**

   ```bash
   git clone https://github.com/xhd2005/puretone.git
   cd puretone
   git submodule update --init --recursive
   ```

2. **安装依赖**

   ```bash
   pnpm install
   ```

3. **前端开发、类型检查与全量单元测试**

   ```bash
   pnpm dev
   pnpm typecheck
   pnpm test
   ```

4. **原生 Kotlin 模块一览**

   Android 原生层位于 `android/app/src/main/java/com/xhd2005/puretone/`，负责音频播放、磁盘缓存、零 CORS 网络与系统集成：

   | 模块文件 | 用途 |
   | --- | --- |
   | `player/EchoPlaybackService.kt` | Media3 `ExoPlayer` 前台播放服务、每曲独立请求头、2 曲前瞻队列、预加载错误隔离、60s 试听/提前 EOF 检测、`DynamicLruCacheEvictor`（默认 2 GB）、余弦淡入淡出、无削波减法 EQ、响度均衡与 Live Updates |
   | `plugins/EchoPlayerPlugin.kt` | Capacitor 播放控制桥接插件（加载、续播定位、`syncUpcomingTracks`、`playbackRecovery` 事件与单曲/全局缓存管理） |
   | `plugins/EchoHttpPlugin.kt` | 基于 OkHttp 4.12 的零 CORS 原生 HTTP 插件（完整保留多条 `Set-Cookie` 与二进制流） |
   | `plugins/EchoSystemPlugin.kt` | SQLite KV 存储、多路镜像 SHA-256 校验更新下载与安装、安全区、触感反馈与相册存图/系统分享 |
   | `widget/PureToneWidgetProvider.kt` | 4×2 封面动态取色桌面播控小组件（播放/切歌/红心联动） |

5. **构建前端、同步 Android 并运行原生单测与调试打包**

   ```bash
   pnpm build
   npx cap sync android
   cd android
   ./gradlew :app:testDebugUnitTest :app:assembleDebug
   ```

   **常见问题：**
   - **`server/` 目录为空导致构建报错**：在仓库根目录执行 `git submodule update --init --recursive` 拉取 `KuGouMusicApi` 子模块。
   - **Gradle 报 JVM 版本不匹配**：确认 `JAVA_HOME` 指向 JDK 21，且 `java -version` 输出 21.x。
   - **本地编译 Release 正式签名包**：在 `android/keystore.properties` 中配置 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`；未配置时可正常编译临时签名的 Debug 包，但无法直接覆盖安装正式 Release 包。
   - **修改前端或原生代码后生效**：前端改动需重新执行 `pnpm build && npx cap sync android` 后再打包 APK。

## 🏗️ 编译发布

项目使用 GitHub Actions（[android-build.yml](.github/workflows/android-build.yml)）进行自动化构建。每次推送 `main` 或手动触发 `workflow_dispatch` 时会自动运行类型检查、101 项前端测试、Android 原生单元测试并上传 APK CI 产物；每当推送 `v*` 格式的 Tag 时，还会使用永久发布证书自动签名构建、校验指纹、生成 `latest.json`、创建 GitHub Release 并同步刷新 `updates` 分支与 jsDelivr CDN 缓存。

**手动编译正式包：**

```bash
pnpm typecheck && pnpm test && pnpm build
npx cap sync android
cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease --no-daemon
```

## 📦 打包产物

- **正式安装包**：`MELUNE-vX.Y.Z-release.apk`（位于 GitHub Releases 与 CI Artifact `MELUNE-Release-APK`）
- **调试安装包**：`app-debug.apk`（位于 CI Artifact `MELUNE-Debug-APK`）
- **更新清单**：`latest.json`（随 Release 及 `updates` 分支同步发布，包含版本号、体积与 APK SHA-256 摘要）

### 🔐 永久签名与无损升级

弥音永久固定应用包名 `com.xhd2005.puretone` 与 50 年期正式发布签名证书（SHA-256：`89c6ca074542578f6faf341ad1a8f57cbac72f1c89e954fbd3f15756d203a723`）。任意旧版本弥音 / PureTone 均可直接覆盖安装新版本，账号登录态、歌单快照、听歌统计、EQ 与本地音频缓存 100% 无损保留。

## 💬 反馈与作者

- **问题反馈与建议**：[GitHub Issues](https://github.com/xhd2005/puretone/issues)
- **正式版下载与日志**：[GitHub Releases](https://github.com/xhd2005/puretone/releases/latest)
- **作者**：Hayden Xue（[@xhd2005](https://github.com/xhd2005)）

## 🙏 鸣谢

感谢以下开源项目及其贡献者与实测伙伴提供的支持（完整许可清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）：

- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) - 酷狗概念版端侧接口协议与加密签名技术参考
- [Android Jetpack Media3](https://github.com/androidx/media) - 原生 ExoPlayer、MediaSessionService 与 SimpleCache 音视频基础设施
- [Capacitor](https://github.com/ionic-team/capacitor) - 现代 Web-to-Native 跨端容器与 Kotlin 原生桥接框架
- [OkHttp](https://github.com/square/okhttp) - 高性能零 CORS 原生 HTTP 客户端与下载器引擎
- [Kotlin](https://github.com/JetBrains/kotlin) & [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) - Android 原生服务与异步协程支撑
- [AndroidX](https://github.com/androidx/androidx) & [Google Guava](https://github.com/google/guava) - 系统兼容性、SplashScreen 与 MediaSession 异步原语
- [Vue 3](https://github.com/vuejs/core)、[Vue Router](https://github.com/vuejs/router) & [Pinia](https://github.com/vuejs/pinia) - 前端响应式视图、路由与状态管理生态
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) & [TypeScript](https://github.com/microsoft/TypeScript) - 原子化 Liquid Glass 样式系统与静态类型保障
- [Vite](https://github.com/vitejs/vite) & [Vitest](https://github.com/vitest-dev/vitest) - 生产构建管线、自定义 CSS 门禁插件与自动化回归测试
- [Iconify](https://github.com/iconify/iconify) & [Tabler Icons](https://github.com/tabler/tabler-icons) - 统一按需打包的线性图标体系
- [LRCLIB](https://github.com/tranxuanthang/lrclib) - 开放免费的社区同步歌词兜底数据源
- [pako](https://github.com/nodeca/pako)、[crypto-js](https://github.com/brix/crypto-js)、[node-forge](https://github.com/digitalbazaar/forge)、[node-qrcode](https://github.com/soldair/node-qrcode)、[big-integer](https://github.com/peterolson/BigInteger.js) & [Axios](https://github.com/axios/axios) - KRC 歌词解压、加解密运算、二维码生成与 HTTP 适配
- [GitHub Actions](https://github.com/features/actions)、[jsDelivr](https://github.com/jsdelivr/jsdelivr) 与开源镜像节点 - 自动化签名发布与大陆多路加速更新分发
- 所有在 **Android 11 / ColorOS 11.1**、**vivo OriginOS**、**小米 HyperOS** 等真机上反复实测并反馈体验细节的社区伙伴

## 💡 灵感来源

本项目的设计、交互与工程文档结构受到以下开源项目的启发：

- [EchoMusic](https://github.com/hoowhoami/EchoMusic) - 一个简约、精致、功能强大的跨平台第三方音乐播放器
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server) - 多源并发候选评分与无感换源匹配思路启发
- [SPlayer](https://github.com/imsyy/SPlayer) - 一个简约的开源音乐播放器
- [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic) - 一款开源简洁高颜值的酷狗第三方客户端

## 📄 免责声明

本项目是基于公开 API 接口开发的纯端侧第三方音乐客户端，仅供个人学习和技术研究使用。

- **数据来源**：所有音乐、歌词、封面与评论数据均由设备直接向公开接口获取，本项目不架设中转服务器，不存储、不传播任何音频文件
- **版权声明**：音乐内容及相关权益归原平台、唱片公司及合法版权方所有，请尊重知识产权，支持正版音乐，测试后请于 24 小时内删除测试产物
- **隐私边界**：本软件不收集、不上报任何个人信息与行为日志，账号会话与本地缓存仅保存在设备沙盒内；JSON 备份严格排除所有登录 Cookie 与 Token
- **使用限制**：禁止将本项目或其衍生品用于任何商业用途、收费分发或违法行为
- **责任声明**：因第三方接口变动、账号风控或不当使用本项目产生的任何法律纠纷或损失，均由使用者自行承担
- **争议处理**：如任何版权方认为本项目侵犯其合法权益，请携带权属证明通过 [GitHub Issues](https://github.com/xhd2005/puretone/issues) 联系，我们将在核实后 **24 小时内** 立即删除或下架相关内容

**本项目不接受任何商业合作、广告或捐赠。**

## ⚖️ 开源协议

基于 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html) 协议发布，完整协议文本见 [LICENSE](LICENSE)。

第三方依赖与授权说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
