<div align="center">

<img src="./docs/melune-icon.png" width="108" height="108" alt="MELUNE Logo" style="border-radius: 26px;" />

# 弥音 · MELUNE

**余音绵延，音乐无界。**  
*Where Music Becomes Memory.*

极简无广告 · iOS 26 Liquid Glass 美学 · 原生 Media3 息屏连播与歌曲过渡 · 简/繁/英三语开源 Android 音乐客户端

[![Release](https://img.shields.io/github/v/release/xhd2005/puretone?style=flat-square&color=3456be)](https://github.com/xhd2005/puretone/releases/latest)
[![Android CI](https://img.shields.io/github/actions/workflow/status/xhd2005/puretone/android-apk.yml?branch=main&style=flat-square&label=Android%20APK%20CI)](https://github.com/xhd2005/puretone/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-2fb350?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Android-10%20~%2017-1a2d70?style=flat-square)](#)

[📥 下载最新正式版 APK](https://github.com/xhd2005/puretone/releases/latest) · [✨ 核心特性](#-核心特性) · [👤 作者介绍](#-作者介绍) · [⚖️ 合规与免责声明](#%EF%B8%8F-合规与完整免责声明)

</div>

---

## 🌙 品牌寓意

> **弥**，是绵延，是充盈，也是声音穿越时间后的余韵。  
> **音**，是旋律，是情感，也是每个人独一无二的精神世界。  
> **MELUNE**（*Melody* × *Lune*）象征月亮、时间与记忆——**音乐终会停止，余音却可以绵延。**

---

## ✨ 核心特性

### 🎧 原生息屏连播、丝滑歌曲过渡与零爆音 DSP
- **原生 3 曲前瞻播放队列**：自动将后续曲目预解析写入 Jetpack Media3 `ExoPlayer` 原生播放列表，锁屏骑行、蓝牙耳机切歌（0ms 响应）与户外弱网抖动均不断播。
- **丝滑歌曲过渡（Track Fade）**：单引擎余弦曲线曲末淡出 + 新曲柔和淡入（可选关闭 / `1.5s` / `3s` / `5s`），暂停与恢复同样具备 220ms 微淡入淡出，零耗电增量。
- **响度均衡（Volume Leveling）**：内置 Android `LoudnessEnhancer`，温和拉平不同年代曲目的音量落差，骑行戴耳机无需反复调音量。
- **专业减法均衡器（Zero-Clip Subtractive EQ）**：全部 5 档（原声 / 人声 / 低音 / 深夜 / 现场）严格遵循 `<= 0 dB` 减法调音，搭配 70ms 柔降 / 120ms 淡入，彻底消除播放中切档爆鸣。

### 🎵 深度音乐探索与互动
- **EchoMusic 风格歌手主页与专辑详情**：高清歌手头像、作品/专辑/粉丝统计、生日、完整简介弹窗、关注/取消关注、热门/最新单曲（支持页内实时筛选）、专辑网格及专辑详情页；支持合唱多歌手选择器。
- **歌曲「详情 / 评论」双页签面板**：实时评论数角标、全部评论 / 分类评论 / 热词评论三级切换、原地展开楼中楼回复，并支持已登录账号发表评论与回复。
- **多榜单热搜榜 + 4 页签搜索**：搜索空态呈现 Top 20 多分类热搜榜卡片；搜索结果支持「单曲 / 歌手 / 专辑 / 歌单」4 页签一键直达。
- **逐字 KRC 歌词 + 时间轴微调 + 副歌标记**：3 档歌词字号、单曲记忆 ±0.5s 词轴微调，以及基于 `song_climax` 的进度条副歌高潮微光标记与一键跳转。

### 💎 iOS 26 Liquid Glass 交互与海报工坊
- **月夜流光无缝开屏页**：Android 12–17 系统底色 `#0B1336` 与应用内月光晕开动画零闪屏衔接，并行水合、轻点即跳。
- **5 套策展级 1080P 分享海报工坊**：月夜玻璃 / 黑胶唱片（同心纹路与唱针）/ 拍立得留白 / 电影字幕 / 弥音月色，100% 所见即所得 Canvas 渲染、支持双语翻译与日期戳开关。
- **简中 / 繁中 / 英文三语全量适配**：动态 `<html lang>` 与三语专属字族栈、双行防溢出设置布局、全本地化 iOS 屏幕时间风格听歌统计图表。
- **Android 16/17 官方 Live Updates 与动态 4×2 桌面小组件**：遵循 Media3 与 `POST_PROMOTED_NOTIFICATIONS` 标准，并附带随封面动态取色的 4×2 桌面播控小组件（含红心联动）。

---

## 📥 安装与无损覆盖升级

1. 前往 [GitHub Releases](https://github.com/xhd2005/puretone/releases/latest) 下载 **`PureTone-v2.4.0-release.apk`**（底层保留包名 `com.xhd2005.puretone` 与永久正式签名证书，已安装 `v2.2.1` / `v2.3.0` 的设备可**直接覆盖安装，免重新登录、数据 100% 保留**）。
2. 为保证息屏骑行连播与锁屏播控体验，请在系统设置中为「弥音 / MELUNE」开启**允许通知**并关闭电池后台限制。
3. **关于部分定制 ROM 顶部音乐原子岛说明**：如 OriginOS 等系统对顶部音乐原子岛实行硬编码商业包名白名单，弥音坚持 100% 开源合规绝不伪装他人包名；推荐添加「**弥音 4×2 动态桌面小组件**」以获得同样精致的桌面快捷播控。

---

## 👤 作者介绍

**Hayden Xue（[@xhd2005](https://github.com/xhd2005)）**  
独立开发者 & 音乐与交互美学爱好者。秉持克制、纯粹、无广告的设计信条，专注打磨流畅优雅的移动端音频体验与开放源代码实践。

---

## 🛠️ 技术栈与本地构建

- **前端与跨端**：Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS v4 + Capacitor 7
- **原生音频层**：Kotlin + Android Jetpack Media3 (`ExoPlayer` 1.5.1 + `MediaSessionService` + 300MB LRU 磁盘缓存 + `Equalizer` / `LoudnessEnhancer`)
- **本地构建命令**：
  ```bash
  pnpm install
  pnpm typecheck && pnpm test && pnpm build
  npx cap sync android
  cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease
  ```

---

## ⚖️ 合规与完整免责声明

> **请在使用或下载本软件前完整阅读以下 7 条声明（本软件在首次启动及每次版本更新后均会强制呈现并要求确认）：**

1. **开源学习与绝对非商业定位**：弥音 · MELUNE 由独立开发者 Hayden Xue（@xhd2005）基于 GNU GPL-3.0 协议开源发布，仅面向移动端音频工程、Jetpack Media3 与 Liquid Glass 交互美学技术学习交流。本软件永久无广告、无任何付费墙、引流或商业化变现，严禁任何个人或组织将其或其衍生品用于商业盈利与收费分发。
2. **纯端侧直连与零资源托管声明**：本软件为完全运行于本地设备的纯客户端工具，开发者不架设、不运营任何音乐中转或资源服务器，亦不存储、缓存、上传、分发或提供任何受著作权保护的音频、歌词或封面文件。所有网络请求均由用户设备直接发起。
3. **知识产权归属与支持正版原则**：软件内检索、展示与播放的曲目音频、歌词文本、专辑封面、评论及平台会员权益，其全部知识产权均归属于原音乐平台、唱片公司及合法著作权人所有。请尊重音乐人创作成果、支持正版音乐服务，并在下载测试后于 24 小时内从个人设备中清除测试产物。
4. **第三方接口与实验性功能风险自担**：登录第三方音乐账号、发表评论、关注歌手及使用实验性音源匹配或签到相关功能均由用户自主操作触发。因第三方平台接口变更、服务条款限制、风控策略调整或用户自身不当使用所引发的账号异常、服务中断或其它后果，均由使用者自行承担。
5. **隐私保护与本地数据边界**：弥音 · MELUNE 绝不收集、上报或追踪任何用户个人信息、登录凭据或听歌行为日志。您的账号会话、本地歌单快照与听歌统计完全隔离存储于本机应用沙盒中；导出的 JSON 备份亦严格排除所有登录 Cookie 与 Token。
6. **GPL-3.0 开源许可与“按原样提供”免责**：本软件按 GNU GPL-3.0 许可证“按原样（AS-IS）”提供，不附带任何明示或默示的适销性、特定用途适用性或不侵权担保。在适用法律允许的最大范围内，作者及贡献者不对使用本软件产生的任何直接、间接、附带或衍生损害承担法律责任。
7. **版权权利人通知与 24 小时快速下架通道**：我们高度重视知识产权保护。若任何音乐平台、著作权人或第三方认为本项目的代码引用、接口适配或文档内容侵犯了您的合法权益，请携带权属证明通过 [GitHub Issues](https://github.com/xhd2005/puretone/issues) 或公开联系渠道通知作者，我们将在核实后的 **24 小时内** 立即删除或下架相关内容。
