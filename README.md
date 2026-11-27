<div align="center">

<img src="./docs/melune-icon.png" width="108" height="108" alt="MELUNE Logo" style="border-radius: 26px;" />

# 弥音 · MELUNE

**简体中文** | [English](./README.en.md) | [繁體中文](./README.zh-TW.md)

**音乐终会停止，余音却可以绵延。**  
*Where Music Becomes Memory.*

极简无广告 · iOS 26 Liquid Glass 美学 · 原生 Media3 息屏连播与 2 GB 可调离线缓存 · 简/繁/英三语开源 Android 音乐客户端

[![Release](https://img.shields.io/github/v/release/xhd2005/puretone?style=flat-square&color=3456be)](https://github.com/xhd2005/puretone/releases/latest)
[![Android CI](https://img.shields.io/github/actions/workflow/status/xhd2005/puretone/android-apk.yml?branch=main&style=flat-square&label=Android%20APK%20CI)](https://github.com/xhd2005/puretone/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-2fb350?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Android-10%20~%2017-1a2d70?style=flat-square)](#)

[📥 下载最新正式版 APK](https://github.com/xhd2005/puretone/releases/latest) · [✨ 核心特性](#-核心特性) · [🙏 特别鸣谢](#-特别鸣谢) · [👤 作者介绍](#-作者介绍) · [⚖️ 合规与免责声明](#%EF%B8%8F-合规与完整免责声明)

</div>

---

## 🌙 品牌寓意

> **弥**，是绵延，是充盈，也是声音穿越时间后的余韵。  
> **音**，是旋律，是情感，也是每个人独一无二的精神世界。  
> 弥音，希望让每一段旋律都拥有自己的空间，让每一种情绪都能找到共鸣。  
> **MELUNE**（*Melody* × *Lune*）—— **音乐终会停止，余音却可以绵延。**

---

## ✨ 核心特性

### 🎧 原生息屏连播、丝滑歌曲过渡与零爆音 DSP
- **原生 3 曲前瞻播放队列**：自动将后续曲目预解析写入 Jetpack Media3 `ExoPlayer` 原生播放列表，锁屏骑行、蓝牙耳机切歌（0ms 响应）与户外弱网抖动均不断播。
- **丝滑歌曲过渡（Track Fade）**：单引擎余弦曲线曲末淡出 + 新曲柔和淡入（关闭 / `1.5s` / `3s` / `5s`），暂停与恢复同样具备微淡入淡出。
- **响度均衡（Volume Leveling）与专业减法均衡器（EQ）**：5 档调音（原声 / 人声 / 低音 / 深夜 / 现场）严格遵循 `<= 0 dB` 无削波减法曲线，切档柔降零爆鸣。

### 💾 2 GB 可调本地智能缓存、离线直放与歌单 0 秒秒开
- **5 档可调音频缓存 + 弱网离线直放**：默认 **2 GB**（支持 `500 MB / 1 GB / 2 GB / 4 GB / 无上限` 实时热调节，调低上限自动按 LRU 淘汰最久未听曲目）；地铁弱网或飞行模式下自动直放本地已缓存歌曲，零流量零报错。
- **歌单智能版本校验与原地增量快照**：本地 SQLite 快照自动比对云端 `totalVer` 与曲目数，未变动时 **0 网络请求瞬间打开「我喜欢」与全部歌单**；本机点红心或加歌原地增量写入快照，不再触发全量重拉；同时支持首页每日推荐与歌单目录持久化秒开与存储空间分项透明清理。
- **Android 16/17 官方 Live Updates** 与 **4×2 动态取色桌面小组件**（含红心联动）。

### 🎵 零闪烁播放页、逐字 KRC 歌词与深度互动
- **单常驻封面层 + 单调时钟逐字歌词**：彻底消除页面切换与歌词播放闪烁；支持 3 档字号、单曲记忆词轴微调（`±0.5s` / `±1s`）与副歌高潮（`song_climax`）进度条微光标记及一键跳转。
- **120fps 直绘 5 模板歌词海报工坊**：月夜玻璃 / 黑胶唱片 / 拍立得 / 电影字幕 / 弥音月色，LRU 封面缓存 + 离屏柔焦，滑动与换模如丝般顺滑，1080P 高清保存或系统分享。
- **歌曲详情与 4 模式评论系统**：支持推荐 / 最热 / 最新 / 热词筛选、楼中楼智能去重清洗、百余种酷狗表情原生 Emoji 映射，以及已登录账号实时点赞与回复。
- **云端歌单全套管理 & 底部批量接管栏**：新建、编辑、删除、收藏/取消收藏、批量加歌与批量移出；配合歌手主页、专辑详情与多榜单热搜畅听全库。

### 🚀 自动检查更新、大陆多路加速与旧机型全兼容
- **冷启动自动检查更新**：每次打开应用在开屏退场后静默检测新版并平滑弹出更新卡片，明确区分「稍后提醒」与「忽略此版本」，内置多组大陆加速节点与 SHA-256 完整性校验。
- **Android 11 / ColorOS 11.1 旧版 WebView 全量兼容管线**：全链静态样式门禁消除老版本 Chrome 内核渲染异常，简 / 繁 / 英三语与日夜主题自然自适应。

---

## 📥 安装与无损覆盖升级

1. 前往 [GitHub Releases](https://github.com/xhd2005/puretone/releases/latest) 下载 **`MELUNE-v2.4.9-release.apk`**（底层永久保留包名 `com.xhd2005.puretone` 与 50 年正式签名证书，旧版本可**直接无损覆盖安装，免重新登录、数据 100% 保留**）。
2. 为保证息屏连播与锁屏播控体验，请在系统设置中为「弥音 · MELUNE」开启**允许通知**并关闭电池后台限制。
3. **关于部分定制 ROM 顶部音乐原子岛说明**：如 vivo OriginOS 等系统对顶部音乐胶囊实行硬编码商业包名白名单，弥音坚持 100% 开源合规绝不伪装他人包名；推荐添加「**弥音 4×2 动态桌面小组件**」获取随封面取色的快捷播控。

---

## 🙏 特别鸣谢

弥音 · MELUNE 的诞生与持续打磨，离不开以下优秀开源项目、设计灵感与热心伙伴的支持：

| 致谢对象 | 贡献与启发 |
| --- | --- |
| [**MakcRe/KuGouMusicApi**](https://github.com/MakcRe/KuGouMusicApi) | 提供完整详尽的酷狗概念版端侧接口协议与加密签名技术参考，是本项目纯端侧直连架构的重要基石。 |
| [**EchoMusic**](https://github.com/EchoMusicApp) | 带来极具启发的移动端播放器交互思路、歌手主页编排与极简音乐产品美学灵感。 |
| **核心开源技术社区** | 感谢 [Android Jetpack Media3](https://developer.android.com/media/media3)、[Capacitor](https://capacitorjs.com/)、[Vue 3](https://vuejs.org/)、[Pinia](https://pinia.vuejs.org/)、[Tailwind CSS](https://tailwindcss.com/)、[Iconify](https://iconify.design/)、[OkHttp](https://square.github.io/okhttp/) 与 [Vitest](https://vitest.dev/) 维护者们的卓越工程基建。 |
| **真机测试伙伴与早期用户** | 衷心感谢每一位协助在 **Android 11 / ColorOS 11.1**、**vivo OriginOS**、**小米 HyperOS** 等多款真机上反复实测、截图定位闪烁/卡顿/评论与原子岛细节并提出宝贵建议的朋友与用户，每一次迭代都凝聚着大家的真实反馈！ |

---

## 👤 作者介绍

**Hayden Xue（[@xhd2005](https://github.com/xhd2005)）**  
独立开发者 & 音乐与交互美学爱好者。秉持克制、纯粹、无广告的设计信条，专注打磨流畅优雅的移动端音频体验与开放源代码实践。

---

## 🛠️ 技术栈与本地构建

- **前端与跨端**：Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS v4 + Capacitor 7
- **原生音频层**：Kotlin + Android Jetpack Media3（`ExoPlayer` 1.5.1 + `MediaSessionService` + 动态可调 2 GB 默认 LRU 磁盘缓存 + `Equalizer` / `LoudnessEnhancer`）
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
