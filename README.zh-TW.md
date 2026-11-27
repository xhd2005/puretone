<div align="center">

<img src="./docs/melune-icon.png" width="108" height="108" alt="MELUNE Logo" style="border-radius: 26px;" />

# 彌音 · MELUNE

[简体中文](./README.md) | [English](./README.en.md) | **繁體中文**

**音樂終會停止，餘音卻可以綿延。**  
*Where Music Becomes Memory.*

極簡無廣告 · iOS 26 Liquid Glass 美學 · 原生 Media3 息屏連播與 2 GB 可調離線快取 · 簡/繁/英三語開源 Android 音樂用戶端

[![Release](https://img.shields.io/github/v/release/xhd2005/puretone?style=flat-square&color=3456be)](https://github.com/xhd2005/puretone/releases/latest)
[![Android CI](https://img.shields.io/github/actions/workflow/status/xhd2005/puretone/android-apk.yml?branch=main&style=flat-square&label=Android%20APK%20CI)](https://github.com/xhd2005/puretone/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-2fb350?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Android-10%20~%2017-1a2d70?style=flat-square)](#)

[📥 下載最新正式版 APK](https://github.com/xhd2005/puretone/releases/latest) · [✨ 核心亮點](#-核心亮點) · [🙏 特別鳴謝](#-特別鳴謝) · [👤 作者介紹](#-作者介紹) · [⚖️ 合規與免責聲明](#%EF%B8%8F-合規與完整免責聲明)

</div>

---

## 🌙 品牌寓意

> **彌**，是綿延，是充盈，也是聲音穿越時間後的餘韻。  
> **音**，是旋律，是情感，也是每個人獨一無二的精神世界。  
> 彌音，希望讓每一段旋律都擁有自己的空間，讓每一種情緒都能找到共鳴。  
> **MELUNE**（*Melody* × *Lune*）—— **音樂終會停止，餘音卻可以綿延。**

---

## ✨ 核心亮點

### 🎧 原生息屏連播、絲滑歌曲過渡與零爆音 DSP
- **原生 3 曲前瞻播放佇列**：自動將後續曲目預解析寫入 Jetpack Media3 `ExoPlayer` 原生播放清單，鎖屏騎行、藍牙耳機切歌（0ms 響應）與戶外弱網均不斷播。
- **絲滑歌曲過渡（Track Fade）**：單引擎餘弦曲線曲末淡出 + 新曲柔和淡入（關閉 / `1.5s` / `3s` / `5s`），暫停與恢復亦具備柔和微淡入淡出。
- **響度均衡（Volume Leveling）與無削波減法均衡器（EQ）**：5 檔調音（原聲 / 人聲 / 低音 / 深夜 / 現場）嚴格遵循 `<= 0 dB` 減法曲線，切檔無爆鳴。

### 💾 2 GB 可調本機智慧快取、離線直放與歌單 0 秒秒開
- **5 檔可調音訊快取 + 弱網離線直放**：預設 **2 GB**（支援 `500 MB / 1 GB / 2 GB / 4 GB / 無上限` 即時熱調節，調低上限自動按 LRU 淘汰最久未聽曲目）；地鐵弱網或飛航模式自動直放本機已快取歌曲，零流量零報錯。
- **歌單智慧版本校驗與原地增量快照**：本機 SQLite 快照自動比對雲端 `totalVer` 與曲目數，未變動時 **0 網路請求瞬間開啟「我喜歡的音樂」與全部歌單**；本機點紅心或加歌原地增量寫入快照，不再觸發全量重拉；同步支援主頁每日推薦與歌單目錄秒開及儲存空間分項清理。
- **Android 16/17 官方 Live Updates** 與 **4×2 動態取色桌面小工具**（含紅心聯動）。

### 🎵 零閃爍播放頁、逐字 KRC 歌詞與深度互動
- **單常駐封面層 + 單調時鐘逐字歌詞**：徹底消除頁面切換與歌詞播放閃爍；支援 3 檔字號、單曲記憶詞軸微調（`±0.5s` / `±1s`）與副歌高潮（`song_climax`）進度條標記及一鍵跳轉。
- **120fps 直繪 5 模板歌詞海報工坊**：月夜玻璃 / 黑膠唱片 / 拍立得 / 電影字幕 / 彌音月色，LRU 封面快取 + 離屏柔焦，1080P 高清儲存或系統分享。
- **歌曲詳情與 4 模式評論系統**：推薦 / 最熱 / 最新 / 熱詞切換、樓中樓智慧清洗、百餘種表情原生 Emoji 映射，以及已登入帳號即時按讚與回覆。
- **雲端歌單全套管理 & 底部批次接管列**：新建、編輯、刪除、收藏/取消收藏與批次操作；結合歌手主頁、專輯詳情與多榜單熱搜暢聽全庫。

### 🚀 啟動自動檢查更新、多路鏡像加速與舊機型相容
- **冷啟動自動檢查更新**：每次開啟應用於開屏退場後靜默偵測新版並平滑彈出更新卡片，明確區分「稍後提醒」與「忽略此版本」，內建多路鏡像加速與 SHA-256 完整性校驗。
- **Android 11 / ColorOS 11.1 舊版 WebView 全量相容管線**：自動化靜態樣式門禁確保新舊裝置皆流暢精緻，全面支援簡 / 繁 / 英三語與日夜自適應。

---

## 📥 安裝與無損覆蓋升級

1. 前往 [GitHub Releases](https://github.com/xhd2005/puretone/releases/latest) 下載 **`MELUNE-v2.4.9-release.apk`**（底層永久保留包名 `com.xhd2005.puretone` 與 50 年正式簽章憑證，舊版可直接**無損覆蓋安裝，免重新登入、資料 100% 保留**）。
2. 為確保息屏連播與鎖屏播控體驗，請於系統設定中為「彌音 · MELUNE」開啟**允許通知**並關閉電池背景限制。
3. **關於部分客製 ROM 頂部音樂原子島說明**：如 vivo OriginOS 等系統對頂部音樂膠囊實施硬編碼商業包名白名單，彌音堅持 100% 開源合規絕不偽裝他人包名；推薦加入「**彌音 4×2 動態桌面小工具**」獲得動態取色快捷播控。

---

## 🙏 特別鳴謝

彌音 · MELUNE 的誕生與持續進化，離不開以下優秀開源專案、設計靈感與熱心夥伴的支持：

| 致謝對象 | 貢獻與啟發 |
| --- | --- |
| [**MakcRe/KuGouMusicApi**](https://github.com/MakcRe/KuGouMusicApi) | 提供完整詳盡的酷狗概念版端側介面協定與加密簽章技術參考，是本專案純端側直連架構的重要基石。 |
| [**EchoMusic**](https://github.com/EchoMusicApp) | 帶來極具啟發的行動端播放器互動思路、歌手主頁編排與極簡音樂產品美學靈感。 |
| **核心開源技術社群** | 感謝 [Android Jetpack Media3](https://developer.android.com/media/media3)、[Capacitor](https://capacitorjs.com/)、[Vue 3](https://vuejs.org/)、[Pinia](https://pinia.vuejs.org/)、[Tailwind CSS](https://tailwindcss.com/)、[Iconify](https://iconify.design/)、[OkHttp](https://square.github.io/okhttp/) 與 [Vitest](https://vitest.dev/) 維護者們的卓越工程基建。 |
| **真機測試夥伴與早期用戶** | 衷心感謝每一位協助在 **Android 11 / ColorOS 11.1**、**vivo OriginOS**、**小米 HyperOS** 等多款真機上反覆實測、截圖定位閃爍/卡頓/評論與原子島細節並提出寶貴建議的朋友與用戶！ |

---

## 👤 作者介紹

**Hayden Xue（[@xhd2005](https://github.com/xhd2005)）**  
獨立開發者 & 音樂與互動美學愛好者。秉持克制、純粹、無廣告的設計信條，專注打磨流暢優雅的行動端音訊體驗與開放原始碼實踐。

---

## 🛠️ 技術棧與本機建置

- **前端與跨端**：Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS v4 + Capacitor 7
- **原生音訊層**：Kotlin + Android Jetpack Media3（`ExoPlayer` 1.5.1 + `MediaSessionService` + 動態可調 2 GB 預設 LRU 磁碟快取 + `Equalizer` / `LoudnessEnhancer`）
- **本機建置指令**：
  ```bash
  pnpm install
  pnpm typecheck && pnpm test && pnpm build
  npx cap sync android
  cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease
  ```

---

## ⚖️ 合規與完整免責聲明

> **請在使用或下載本軟體前完整閱讀以下 7 條聲明（本軟體在首次啟動及每次版本更新後均會強制呈現並要求確認）：**

1. **開源學習與絕對非商業定位**：彌音 · MELUNE 由獨立開發者 Hayden Xue（@xhd2005）基於 GNU GPL-3.0 協議開源發布，僅供行動端音訊工程、Jetpack Media3 與 Liquid Glass 互動美學技術學習交流。本軟體永久無廣告、無任何付費牆或商業變現，嚴禁任何個人或組織將其或其衍生品用於商業營利與收費分發。
2. **純端側直連與零資源託管聲明**：本軟體為完全執行於本機裝置的純用戶端工具，開發者不架設、不營運任何音樂中轉或資源伺服器，亦不儲存、快取、上傳、分發或提供任何受著作權保護的音訊、歌詞或封面檔案。所有網路請求均由使用者裝置直接發起。
3. **智慧財產權歸屬與支持正版原則**：軟體內檢索、展示與播放的曲目音訊、歌詞文本、專輯封面、評論及平台會員權益，其全部智慧財產權均歸屬於原音樂平台、唱片公司及合法著作權人所有。請尊重音樂人創作成果、支持正版音樂服務，並在下載測試後於 24 小時內從個人裝置中清除測試產物。
4. **第三方介面與實驗性功能風險自負**：登入第三方音樂帳號、發表評論、關注歌手及使用實驗性音源配對或簽到相關功能均由使用者自主操作觸發。因第三方平台介面變更、服務條款限制、風控策略調整或使用者自身不當使用所引發的帳號異常、服務中斷或其他後果，均由使用者自行承擔。
5. **隱私保護與本機資料邊界**：彌音 · MELUNE 絕不蒐集、上報或追蹤任何使用者個人資訊、登入憑證或聽歌行為日誌。您的帳號工作階段、本機歌單快照與聽歌統計完全隔離儲存於本機應用沙盒中；匯出的 JSON 備份亦嚴格排除所有登入 Cookie 與 Token。
6. **GPL-3.0 開源授權與「按原樣提供」免責**：本軟體按 GNU GPL-3.0 授權條款「按原樣（AS-IS）」提供，不附帶任何明示或默示的適銷性、特定用途適用性或不侵權擔保。在適用法律允許的最大範圍內，作者及貢獻者不對使用本軟體產生的任何直接、間接、附帶或衍生損害承擔法律責任。
7. **版權權利人通知與 24 小時快速下架通道**：我們高度重視智慧財產權保護。若任何音樂平台、著作權人或第三方認為本專案的程式碼引用、介面適配或文件內容侵犯了您的合法權益，請攜帶權屬證明透過 [GitHub Issues](https://github.com/xhd2005/puretone/issues) 或公開聯絡管道通知作者，我們將在核實後的 **24 小時內** 立即刪除或下架相關內容。
