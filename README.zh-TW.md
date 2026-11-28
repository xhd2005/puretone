# 彌音 · MELUNE

<p align="center">
  <img src="docs/melune-icon.png" width="128" height="128" alt="彌音 · MELUNE Logo">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <strong>繁體中文</strong>
</p>

<p align="center">
  <strong>彌音 · MELUNE</strong> —— 一個專為 Android 打造的簡約、精緻、純端側無廣告第三方音樂播放器。<em>音樂終會停止，餘音卻可以綿延。</em>
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

- **極致美學**：採用 iOS 26 Liquid Glass 質感設計，支援淺色 / 深色 / 跟隨系統自適應（配備自動化 `.dark` 根節點可見性門禁）、專輯封面動態流體取色、零閃屏月夜開屏與簡/繁/英三語介面。
- **資料路徑透明**：100% 純端側直連，所有協定請求與本機資料均由裝置直接完成；不架設任何音訊中轉伺服器，不提供雲端帳號託管，永久無廣告。
- **音樂推薦**：支援每日推薦、精選歌單與個人化探索，首頁內容支援本機 SQLite 快照秒開。
- **多維探索**：支援歌曲、歌手、專輯、歌單 4 頁籤全庫搜尋與多分類熱搜榜，快速觸達心儀曲目。
- **歌手與專輯檔案**：提供高清歌手主頁（作品/專輯/粉絲統計、簡介彈窗、關注/取消關注、熱門與最新篩選、合唱多歌手選擇器）與完整專輯詳情頁。
- **進階播放**：基於 Jetpack Media3 原生 2 曲前瞻佇列，支援佇列置頂/移除、播放模式切換、倍速播放、餘弦淡入淡出切歌（關閉 / `1.5s` / `3s` / `5s`），並在 seek 短暫緩衝期維持播放態穩定，徹底消除封面縮放抽搐與進度條回彈。
- **零中斷自癒與試聽攔截**：每首曲目獨立綁定 HTTP 請求標頭，徹底隔離預載下一首報錯；全鏈路攔截 30s / 60s 試聽片段與提前 EOF 截斷流，異常時按多級原地精確秒數續播，絕不中途自動切歌。
- **「彌音唱片台」三模式橫螢幕 & 3-Slot 環形切歌**：橫螢幕內建黑膠唱片台（擬真唱臂落針/抬臂動畫 + 旋轉微溝槽唱片）、3D 封面牆與巨幕歌詞影院三大沉浸模式，嚴格適配 `340dp+` 矮橫螢幕零裁切；直螢幕封面切歌採用 Direct-DOM 3-Slot 環形槽位與 120Hz 物理彈簧，零卡頓、零反向回彈。
- **原創 `melune-ext/v1` 沙盒擴充生態**：主程式核心保持 100% 純淨合規，不包含內建自動化任務或第三方音源爬蟲；`v2.5.1+` 預置官方社群擴充源 [`xhd2005/melune-plugins`](https://github.com/xhd2005/melune-plugins)（冷啟動零請求、首次切入擴充頁按需同步、絕不自動安裝），提供統一原生 iOS 26 擴充中心、獨立控制與診斷抽屜、最近 20 條沙盒日誌、Semver 無損更新、一鍵清資料、檔案頁置頂直達、`melune://ext/install` 深鏈安裝與強制 SHA-256 校驗。
- **私人 FM**：智慧推薦個人化電台，並於播放接近佇列尾端時提前續載，息屏不斷流。
- **雲端歌單與秒開快照**：支援雲端歌單新建、編輯、隱私設定、刪除、收藏與底部接管式批次加歌/移歌；本機 SQLite 快照透過雲端版本號 `totalVer` 校驗，未變動時 0 網路請求秒開「我喜歡的音樂」與千首大歌單，本機紅心/增刪原地增量更新。
- **本機智慧快取與離線直放**：基於 `DynamicLruCacheEvictor` + Media3 `SimpleCache`，支援 `500 MB / 1 GB / 2 GB（預設）/ 4 GB / 無上限` 五檔熱調，按「曲目 + 音質 + 音源」分桶隔離（試聽片段不落盤），弱網與飛航模式自動本機直放，音訊快取與歌單快照獨立透明清理。
- **歌曲詳情與評論**：支援檢視多音質規格檔案，以及推薦 / 最熱 / 最新 / 熱詞 4 模式評論、樓中樓清洗去重、百餘種原生 Emoji 映射、即時按讚與回覆。
- **零閃爍逐字歌詞與海報工坊**：內建「酷狗 KRC 逐字 + 譯文 → 網易雲雙語 LRC → LRCLIB」三級回退引擎，純字形圖集直繪（零 Skia `SaveLayer` 瓦片閃爍），支援 120Hz 彈簧捲動、3 檔字號、單曲記憶詞軸微調、副歌高潮標記跳轉與 5 模板 1080P 歌詞海報工坊。
- **音訊增強**：內建 32-bit Float 自研 `PureToneDspAudioProcessor`（5 檔零爆音切檔均衡器 + 響度提升與透明軟限幅器）及真實 Hi-Res / FLAC / OGG 320 解析。
- **系統媒體控制與小工具**：原生整合 `MediaSessionService` 鎖屏/藍牙播控與 Android 16/17 官方 Live Updates，配套 4×2 封面動態取色桌面播控小工具（含紅心聯動）。
- **多帳號與聽歌洞察**：支援 Android Keystore AES-256-GCM 硬體加密儲存工作階段、多帳號切換以及 iOS 螢幕使用時間風格的本機聽歌統計圖表。
- **持久化與遷移備份**：全量偏好、佇列、歷史與快照由原生 SQLite 持久化儲存；支援匯出/還原純文字 JSON 備份（嚴格排除所有登入 Cookie 與 Token）。
- **全機型相容**：內建建置期 CSS 相容降級外掛，自動為 Android 11 / Chromium 80+ 舊版 WebView 展開現代語法，老機型與旗艦機同樣流暢。
- **應用內自動更新**：冷啟動靜默偵測新版本（區分「稍後提醒」與「忽略此版本」），內建多路加速鏡像、jsDelivr CDN、自訂鏡像前綴與端側 APK SHA-256 強制校驗。
- **持續整合**：完善的 GitHub Actions 流水線，自動完成型別檢查、雙端單元測試、永久簽章建置、Release 發布與 `updates` 分支清單同步。

## 🧩 擴充外掛生態（`melune-ext/v1`）

彌音主程式保持極簡與合規，不內建簽到腳本、自動組隊或第三方音源爬蟲。所有可選進階能力均透過原創的 **`melune-ext/v1`** 沙盒擴充體系承載：

- **預設官方社群源**：[`xhd2005/melune-plugins`](https://github.com/xhd2005/melune-plugins)。冷啟動零額外請求，僅在開啟 **我的 → 擴充外掛** 時按需拉取，隨時可移除或恢復，**絕不自動安裝**。
- **硬核安全與統一體驗**：強制 UTF-8 SHA-256 校驗、零明文 Token 暴露（宿主安全代簽）、`ext.data.<id>:*` 隔離儲存、宣告式原生 Liquid Glass 面板（零 `v-html`）、最近 20 條執行日誌、無損更新、檔案頁置頂直達與一鍵安全模式。
- **外掛開發與協定文件**：詳見 👉 **[`docs/PLUGIN_SPEC.md`](docs/PLUGIN_SPEC.md)**。

## 🛠️ 技術棧

- **Mobile Runtime**: [Capacitor](https://capacitorjs.com/) 7.6
- **Frontend**: [Vue 3.5](https://vuejs.org/) + [TypeScript 5.8](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vite.dev/) 6（含自研舊版 WebView CSS 相容外掛）
- **State Management**: [Pinia](https://pinia.vuejs.org/) 3 + 原生 SQLite KV 持久化
- **CSS**: [Tailwind CSS](https://tailwindcss.com/) v4.1
- **Routing**: [Vue Router](https://router.vuejs.org/) 4
- **Package Manager**: [pnpm](https://pnpm.io/) 9+
- **Native Audio Engine**: [Android Jetpack Media3](https://github.com/androidx/media) 1.5.1（`ExoPlayer` + `MediaSessionService` + `SimpleCache`）
- **Native Network & System**: [Kotlin](https://kotlinlang.org/) + [OkHttp](https://square.github.io/okhttp/) 4.12 + `kotlinx.coroutines` 1.9 + Android AppWidget
- **Protocol Engine**: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)（`server` 子模組，端側零中轉直連）
- **Testing**: [Vitest](https://vitest.dev/) 3（112 項前端測試）+ JUnit 4（Android 原生單測）

## 🚀 快速開始

### 前置需求

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [JDK 21](https://adoptium.net/)（建議 Temurin，Android 專案指定 `JavaVersion.VERSION_21`）
- Android SDK 35（`platforms;android-35`、`build-tools;35.0.0`）

請確認目前終端機已設定 `JAVA_HOME` 與 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）：

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

### 本機開發

1. **複製倉庫（含 `server` 子模組）**

   ```bash
   git clone https://github.com/xhd2005/puretone.git
   cd puretone
   git submodule update --init --recursive
   ```

2. **安裝相依套件**

   ```bash
   pnpm install
   ```

3. **前端開發、型別檢查與全量單元測試**

   ```bash
   pnpm dev
   pnpm typecheck
   pnpm test
   ```

4. **原生 Kotlin 模組一覽**

   Android 原生層位於 `android/app/src/main/java/com/xhd2005/puretone/`，負責音訊播放、磁碟快取、零 CORS 網路與系統整合：

   | 模組檔案 | 用途 |
   | --- | --- |
   | `player/EchoPlaybackService.kt` | Media3 `ExoPlayer` 前景播放服務、每曲獨立請求標頭、2 曲前瞻佇列、預載錯誤隔離、60s 試聽/提前 EOF 偵測、`DynamicLruCacheEvictor`（預設 2 GB）、餘弦淡入淡出、無削波減法 EQ、響度均衡與 Live Updates |
   | `plugins/EchoPlayerPlugin.kt` | Capacitor 播放控制橋接外掛（載入、續播定位、`syncUpcomingTracks`、`playbackRecovery` 事件與單曲/全域快取管理） |
   | `plugins/EchoHttpPlugin.kt` | 基於 OkHttp 4.12 的零 CORS 原生 HTTP 外掛（完整保留多條 `Set-Cookie` 與二進位串流） |
   | `plugins/EchoSystemPlugin.kt` | SQLite KV 儲存、多路鏡像 SHA-256 校驗更新下載與安裝、安全區、觸感回饋與相簿存圖/系統分享 |
   | `widget/PureToneWidgetProvider.kt` | 4×2 封面動態取色桌面播控小工具（播放/切歌/紅心聯動） |

5. **建置前端、同步 Android 並執行原生單測與除錯打包**

   ```bash
   pnpm build
   npx cap sync android
   cd android
   ./gradlew :app:testDebugUnitTest :app:assembleDebug
   ```

   **常見問題：**
   - **`server/` 目錄為空導致建置失敗**：於倉庫根目錄執行 `git submodule update --init --recursive` 拉取 `KuGouMusicApi` 子模組。
   - **Gradle 報 JVM 版本不符**：確認 `JAVA_HOME` 指向 JDK 21，且 `java -version` 輸出 21.x。
   - **本機編譯 Release 正式簽章包**：於 `android/keystore.properties` 設定 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`；未設定時可正常編譯臨時簽章的 Debug 包，但無法直接覆蓋安裝正式 Release 包。
   - **修改前端或原生程式碼後生效**：前端改動需重新執行 `pnpm build && npx cap sync android` 後再打包 APK。

## 🏗️ 編譯發布

專案使用 GitHub Actions（[android-build.yml](.github/workflows/android-build.yml)）進行自動化建置。每次推送 `main` 或手動觸發 `workflow_dispatch` 時會自動執行型別檢查、112 項前端測試、Android 原生單元測試並上傳 APK CI 產物；每當推送 `v*` 格式的 Tag 時，還會使用永久發布憑證自動簽章建置、校驗指紋、產生 `latest.json`、建立 GitHub Release 並同步更新 `updates` 分支與 jsDelivr CDN 快取。

**手動編譯正式包：**

```bash
pnpm typecheck && pnpm test && pnpm build
npx cap sync android
cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease --no-daemon
```

## 📦 打包產物

- **正式安裝包**：`MELUNE-vX.Y.Z-release.apk`（位於 GitHub Releases 與 CI Artifact `MELUNE-Release-APK`）
- **除錯安裝包**：`app-debug.apk`（位於 CI Artifact `MELUNE-Debug-APK`）
- **更新清單**：`latest.json`（隨 Release 及 `updates` 分支同步發布，包含版本號、檔案大小與 APK SHA-256 摘要）

### 🔐 永久簽章與無損升級

彌音永久固定應用套件名稱 `com.xhd2005.puretone` 與 50 年期正式發布簽章憑證（SHA-256：`89c6ca074542578f6faf341ad1a8f57cbac72f1c89e954fbd3f15756d203a723`）。任意舊版本彌音 / PureTone 均可直接覆蓋安裝新版本，帳號登入態、歌單快照、聽歌統計、EQ 與本機音訊快取 100% 無損保留。

## 💬 回饋與作者

- **問題回饋與建議**：[GitHub Issues](https://github.com/xhd2005/puretone/issues)
- **正式版下載與日誌**：[GitHub Releases](https://github.com/xhd2005/puretone/releases/latest)
- **作者**：Hayden Xue（[@xhd2005](https://github.com/xhd2005)）

## 🙏 鳴謝

感謝以下開源專案及其貢獻者與實測夥伴提供的支持（完整授權清單見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）：

- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) - 酷狗概念版端側介面協定與加密簽章技術參考
- [Android Jetpack Media3](https://github.com/androidx/media) - 原生 ExoPlayer、MediaSessionService 與 SimpleCache 音視訊基礎設施
- [Capacitor](https://github.com/ionic-team/capacitor) - 現代 Web-to-Native 跨端容器與 Kotlin 原生橋接框架
- [OkHttp](https://github.com/square/okhttp) - 高效能零 CORS 原生 HTTP 用戶端與下載器引擎
- [Kotlin](https://github.com/JetBrains/kotlin) & [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) - Android 原生服務與非同步協程支撐
- [AndroidX](https://github.com/androidx/androidx) & [Google Guava](https://github.com/google/guava) - 系統相容性、SplashScreen 與 MediaSession 非同步原語
- [Vue 3](https://github.com/vuejs/core)、[Vue Router](https://github.com/vuejs/router) & [Pinia](https://github.com/vuejs/pinia) - 前端響應式檢視、路由與狀態管理生態
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) & [TypeScript](https://github.com/microsoft/TypeScript) - 原子化 Liquid Glass 樣式系統與靜態型別保障
- [Vite](https://github.com/vitejs/vite) & [Vitest](https://github.com/vitest-dev/vitest) - 生產建置管線、自訂 CSS 門禁外掛與自動化回歸測試
- [Iconify](https://github.com/iconify/iconify) & [Tabler Icons](https://github.com/tabler/tabler-icons) - 統一按需打包的線性圖示體系
- [LRCLIB](https://github.com/tranxuanthang/lrclib) - 開放免費的社群同步歌詞兜底資料來源
- [pako](https://github.com/nodeca/pako)、[crypto-js](https://github.com/brix/crypto-js)、[node-forge](https://github.com/digitalbazaar/forge)、[node-qrcode](https://github.com/soldair/node-qrcode)、[big-integer](https://github.com/peterolson/BigInteger.js) & [Axios](https://github.com/axios/axios) - KRC 歌詞解壓、加解密運算、QR Code 產生與 HTTP 適配
- [GitHub Actions](https://github.com/features/actions)、[jsDelivr](https://github.com/jsdelivr/jsdelivr) 與開源鏡像節點 - 自動化簽章發布與多路加速更新分發
- 所有在 **Android 11 / ColorOS 11.1**、**vivo OriginOS**、**小米 HyperOS** 等真機上反覆實測並回饋體驗細節的社群夥伴

## 💡 靈感來源

本專案的設計、互動與工程文件結構受到以下開源專案的啟發：

- [EchoMusic](https://github.com/hoowhoami/EchoMusic) - 一個簡約、精緻、功能強大的跨平台第三方音樂播放器
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server) - 多源併發候選評分與無感換源配對思路啟發
- [SPlayer](https://github.com/imsyy/SPlayer) - 一個簡約的開源音樂播放器
- [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic) - 一款開源簡潔高顏值的酷狗第三方用戶端

## 📄 免責聲明

本專案是基於公開 API 介面開發的純端側第三方音樂用戶端，僅供個人學習和技術研究使用。

- **資料來源**：所有音樂、歌詞、封面與評論資料均由裝置直接向公開介面取得，本專案不架設中轉伺服器，不儲存、不傳播任何音訊檔案
- **版權聲明**：音樂內容及相關權益歸原平台、唱片公司及合法版權方所有，請尊重智慧財產權，支持正版音樂，測試後請於 24 小時內刪除測試產物
- **隱私邊界**：本軟體不蒐集、不上報任何個人資訊與行為日誌，帳號工作階段與本機快取僅保存在裝置沙盒內；JSON 備份嚴格排除所有登入 Cookie 與 Token
- **使用限制**：禁止將本專案或其衍生品用於任何商業用途、收費分發或違法行為
- **責任聲明**：因第三方介面變動、帳號風控或不當使用本專案產生的任何法律糾紛或損失，均由使用者自行承擔
- **爭議處理**：如任何版權方認為本專案侵犯其合法權益，請攜帶權屬證明透過 [GitHub Issues](https://github.com/xhd2005/puretone/issues) 聯繫，我們將在核實後 **24 小時內** 立即刪除或下架相關內容

**本專案不接受任何商業合作、廣告或捐贈。**

## ⚖️ 開源協議

基於 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html) 協議發布，完整協議文本見 [LICENSE](LICENSE)。

第三方相依套件與授權說明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
