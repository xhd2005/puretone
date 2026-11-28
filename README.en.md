# MELUNE · 弥音

<p align="center">
  <img src="docs/melune-icon.png" width="128" height="128" alt="MELUNE Logo">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <strong>MELUNE (弥音)</strong> — A minimalist, refined, ad-free, pure on-device third-party music player for Android. <em>Music fades in time, yet echoes linger on.</em>
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

## ✨ Core Features

- **Refined Aesthetics**: Crafted with iOS 26 Liquid Glass styling, adaptive Light / Dark / System theming (guarded by an automated `.dark` root visibility check), dynamic cover fluid palettes, zero-flash moonlit splash, and Simplified Chinese / Traditional Chinese / English localization.
- **Transparent Data Path**: 100% pure on-device direct client — all API calls and storage stay on your phone with zero developer relay servers, zero cloud credential hosting, and zero ads.
- **Music Discovery**: Personalized Daily Mix recommendations, curated playlists, and instant home hydration backed by local SQLite snapshots.
- **Multi-Dimensional Search**: 4-tab search across tracks, artists, albums, and playlists paired with multi-category Trending Charts.
- **Artist & Album Profiles**: Rich artist pages (track/album/follower stats, full bio modal, follow/unfollow, hot/latest filters, multi-artist picker) and complete paginated album views.
- **Advanced Playback**: Jetpack Media3 native 2-track lookahead queue with queue pinning/removal, play modes, playback speed, cosine-eased fade transitions (`Off` / `1.5s` / `3s` / `5s`), and seek-buffering state stability that prevents play-button flashes, cover scale twitch, and scrubber bounce.
- **Zero-Skip Self-Healing & Trial Guard**: Per-track isolated HTTP headers prevent cross-source pre-buffering collisions; full-pipeline 30s/60s trial snippet detection and premature EOF protection drive a 3-tier in-place timestamp recovery cascade (fresh URL → full-length unblock → stable bitrate fallback) without ever auto-skipping mid-song.
- **Smart Source Unblocking**: Built-in 4-channel concurrent candidate scoring for restricted or preview tracks, with manual auditioning and persistent per-track source pinning.
- **Personal FM**: Personalized radio queue with automatic lookahead replenishment for uninterrupted screen-off listening.
- **Cloud Playlists & 0ms Snapshots**: Full cloud playlist creation, editing, privacy controls, deletion, collection, and a bottom takeover batch dock; SQLite snapshots validate KuGou's cloud `totalVer` to open *Liked Songs* and 1,000+ track playlists in 0ms with zero network requests, plus in-place local updates on likes and edits.
- **Configurable Audio Cache & Offline Playback**: `DynamicLruCacheEvictor` + Media3 `SimpleCache` offering 5 live-adjustable limits (`500 MB / 1 GB / 2 GB (Default) / 4 GB / Unlimited`), quality- and source-scoped cache keys (trial clips never persisted), seamless offline/weak-network local playback, and independent audio vs. snapshot clearing.
- **Track Details & Comments**: Multi-quality audio metadata specs alongside Featured / Top / Latest / Hotword comments, deduplicated floor-reply threads, 100+ native emoji mappings, real-time likes, and signed-in replies.
- **Word-by-Word Lyrics & Poster Studio**: 3-tier fallback engine (*KuGou KRC + Translation → NetEase Bilingual LRC → LRCLIB*), flicker-free monotonic clock rendering, 3 font sizes, per-track sync offsets, scrub-bar chorus climax markers, and a 120fps 5-template 1080p Lyric Poster Studio.
- **Audio Enhancement**: 5 strictly subtractive (`<= 0 dB`) zero-clip EQ presets (*Flat / Vocal / Bass / Night / Live*) with soft duck/ramp preset switching, plus Android `LoudnessEnhancer` volume leveling.
- **System Media Controls & Home Widget**: Native `MediaSessionService` lock-screen/Bluetooth integration, Android 16/17 Live Updates compliance, and a dynamic album-colored 4×2 home widget with live heart syncing.
- **Multi-Account Check-in & Listening Insights**: Multi-account switcher, daily auto-claim check-in calendar, and iOS Screen-Time-style local listening statistics charts.
- **Persistence & Safe Backup**: All preferences, queues, history, and snapshots persist in local SQLite; plain JSON export/restore migrates stats and settings while strictly excluding all login cookies and tokens.
- **Broad Device Compatibility**: Build-time CSS downlevel plugin automatically unwraps modern CSS for Android 11 / Chromium 80+ legacy WebViews so older phones render as cleanly as flagships.
- **In-App Auto-Update**: Silent cold-start version check (with *Remind Later* vs. *Ignore Version*), multi-mirror failover, jsDelivr CDN, custom mirror prefixes, and mandatory on-device APK SHA-256 verification.
- **Continuous Integration**: Automated GitHub Actions workflow covering typechecking, dual-platform unit tests, permanent release signing, GitHub Releases, and `updates` manifest publishing.

## 🛠️ Tech Stack

- **Mobile Runtime**: [Capacitor](https://capacitorjs.com/) 7.6
- **Frontend**: [Vue 3.5](https://vuejs.org/) + [TypeScript 5.8](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vite.dev/) 6 (with custom legacy WebView CSS compatibility plugin)
- **State Management**: [Pinia](https://pinia.vuejs.org/) 3 + Native SQLite KV persistence
- **CSS**: [Tailwind CSS](https://tailwindcss.com/) v4.1
- **Routing**: [Vue Router](https://router.vuejs.org/) 4
- **Package Manager**: [pnpm](https://pnpm.io/) 9+
- **Native Audio Engine**: [Android Jetpack Media3](https://github.com/androidx/media) 1.5.1 (`ExoPlayer` + `MediaSessionService` + `SimpleCache`)
- **Native Network & System**: [Kotlin](https://kotlinlang.org/) + [OkHttp](https://square.github.io/okhttp/) 4.12 + `kotlinx.coroutines` 1.9 + Android AppWidget
- **Protocol Engine**: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) (`server` submodule, direct on-device execution)
- **Testing**: [Vitest](https://vitest.dev/) 3 (101 frontend tests) + JUnit 4 (Android native unit tests)

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [JDK 21](https://adoptium.net/) (Temurin recommended; Android build targets `JavaVersion.VERSION_21`)
- Android SDK 35 (`platforms;android-35`, `build-tools;35.0.0`)

Ensure `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) are set in your shell:

**macOS / Linux (Bash):**

```bash
export JAVA_HOME="/path/to/jdk-21"
export ANDROID_HOME="$HOME/Android/Sdk"
```

**Windows (PowerShell):**

```powershell
$env:JAVA_HOME = "C:\Android\jdk-21"
$env:ANDROID_HOME = "C:\Android\Sdk"
$env:ANDROID_SDK_ROOT = "C:\Android\Sdk"
```

### Local Development

1. **Clone the repository (including the `server` submodule)**

   ```bash
   git clone https://github.com/xhd2005/puretone.git
   cd puretone
   git submodule update --init --recursive
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Run dev server, typecheck, and full unit test suite**

   ```bash
   pnpm dev
   pnpm typecheck
   pnpm test
   ```

4. **Native Kotlin Modules Overview**

   All Android native modules live under `android/app/src/main/java/com/xhd2005/puretone/`:

   | Module | Responsibility |
   | --- | --- |
   | `player/EchoPlaybackService.kt` | Media3 `ExoPlayer` foreground service, per-track HTTP headers, 2-track lookahead queue, preload error isolation, 60s trial & premature EOF guard, `DynamicLruCacheEvictor` (2 GB default), cosine track fade, subtractive EQ, loudness leveling, and Live Updates |
   | `plugins/EchoPlayerPlugin.kt` | Capacitor playback bridge (`load` with `startPositionMs`, `syncUpcomingTracks`, `playbackRecovery` events, and per-track/global audio cache controls) |
   | `plugins/EchoHttpPlugin.kt` | Zero-CORS native HTTP client powered by OkHttp 4.12 (preserves multi-cookie headers and binary streams) |
   | `plugins/EchoSystemPlugin.kt` | SQLite KV store, multi-mirror SHA-256 verified APK updater & installer, edge-to-edge safe insets, haptics, and gallery export / native share |
   | `widget/PureToneWidgetProvider.kt` | 4×2 dynamic album-colored home screen playback widget with heart synchronization |

5. **Build web bundle, sync Android, and run native tests & debug APK build**

   ```bash
   pnpm build
   npx cap sync android
   cd android
   ./gradlew :app:testDebugUnitTest :app:assembleDebug
   ```

   **Troubleshooting:**
   - **Empty `server/` directory**: Run `git submodule update --init --recursive` from the repo root to populate `KuGouMusicApi`.
   - **Gradle JVM version mismatch**: Verify `JAVA_HOME` points to JDK 21 (`java -version` outputs 21.x).
   - **Local signed Release builds**: Provide `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` in `android/keystore.properties`. Without it, Debug APKs still build using an ephemeral debug key (cannot overwrite-install over official Release APKs).
   - **Applying web changes to Android**: Re-run `pnpm build && npx cap sync android` before rebuilding the APK.

## 🏗️ Build & Release

Automated builds run via GitHub Actions ([android-build.yml](.github/workflows/android-build.yml)). Pushes to `main` and manual `workflow_dispatch` triggers execute typechecking, all 101 frontend unit tests, Android native unit tests, and upload CI APK artifacts. Pushing a `v*` tag additionally signs the Release APK with the permanent keystore, verifies its certificate fingerprint, generates `latest.json`, publishes the GitHub Release, and updates the `updates` branch + jsDelivr CDN cache.

**Manual Release Build:**

```bash
pnpm typecheck && pnpm test && pnpm build
npx cap sync android
cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease --no-daemon
```

## 📦 Build Artifacts

- **Release APK**: `MELUNE-vX.Y.Z-release.apk` (GitHub Releases & CI artifact `MELUNE-Release-APK`)
- **Debug APK**: `app-debug.apk` (CI artifact `MELUNE-Debug-APK`)
- **Update Manifest**: `latest.json` (published to GitHub Releases & the `updates` branch with version metadata, byte size, and APK SHA-256 digest)

### 🔐 Permanent Signing & Lossless Upgrades

MELUNE permanently preserves its package ID (`com.xhd2005.puretone`) and 50-year release certificate (SHA-256: `89c6ca074542578f6faf341ad1a8f57cbac72f1c89e954fbd3f15756d203a723`). Any earlier MELUNE / PureTone build can overwrite-upgrade directly with 100% preservation of login sessions, snapshots, stats, EQ, and audio caches.

## 💬 Feedback & Author

- **Issues & Feature Requests**: [GitHub Issues](https://github.com/xhd2005/puretone/issues)
- **Releases & Changelogs**: [GitHub Releases](https://github.com/xhd2005/puretone/releases/latest)
- **Author**: Hayden Xue ([@xhd2005](https://github.com/xhd2005))

## 🙏 Acknowledgements

Deep thanks to the open-source projects, maintainers, and testers that make MELUNE possible (full license details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)):

- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) - Client-side KuGou Concept API protocol & signing reference
- [Android Jetpack Media3](https://github.com/androidx/media) - Native ExoPlayer, MediaSessionService, and SimpleCache media foundation
- [Capacitor](https://github.com/ionic-team/capacitor) - Modern Web-to-Native runtime and Kotlin plugin bridge
- [OkHttp](https://github.com/square/okhttp) - Zero-CORS native HTTP client and streaming/download engine
- [Kotlin](https://github.com/JetBrains/kotlin) & [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) - Android native services and structured concurrency
- [AndroidX](https://github.com/androidx/androidx) & [Google Guava](https://github.com/google/guava) - Platform compatibility, SplashScreen, and MediaSession async primitives
- [Vue 3](https://github.com/vuejs/core), [Vue Router](https://github.com/vuejs/router) & [Pinia](https://github.com/vuejs/pinia) - Reactive UI, routing, and state management ecosystem
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) & [TypeScript](https://github.com/microsoft/TypeScript) - Utility Liquid Glass design system and static type safety
- [Vite](https://github.com/vitejs/vite) & [Vitest](https://github.com/vitest-dev/vitest) - Production bundler, build-time CSS compatibility gates, and automated regression tests
- [Iconify](https://github.com/iconify/iconify) & [Tabler Icons](https://github.com/tabler/tabler-icons) - Crisp, tree-shaken stroke iconography
- [LRCLIB](https://github.com/tranxuanthang/lrclib) - Open community synced-lyrics fallback database
- [pako](https://github.com/nodeca/pako), [crypto-js](https://github.com/brix/crypto-js), [node-forge](https://github.com/digitalbazaar/forge), [node-qrcode](https://github.com/soldair/node-qrcode), [big-integer](https://github.com/peterolson/BigInteger.js) & [Axios](https://github.com/axios/axios) - KRC decompression, cryptography, QR generation, and HTTP adapter primitives
- [GitHub Actions](https://github.com/features/actions), [jsDelivr](https://github.com/jsdelivr/jsdelivr) & open-source mirror networks - Automated signed releases and multi-mirror manifest/APK delivery
- Real-device community testers on **Android 11 / ColorOS 11.1**, **vivo OriginOS**, and **Xiaomi HyperOS**

## 💡 Inspiration

MELUNE's design, ergonomics, and documentation draw inspiration from:

- [EchoMusic](https://github.com/hoowhoami/EchoMusic) - A minimalist, refined, feature-rich cross-platform third-party music player
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server) - Multi-source concurrent candidate scoring and fallback matching concepts
- [SPlayer](https://github.com/imsyy/SPlayer) - A clean, minimalist open-source music player
- [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic) - A clean, aesthetic open-source KuGou third-party client

## 📄 Disclaimer

This project is a pure on-device third-party music client built atop public APIs strictly for personal study and technical research.

- **Data Source**: All music, lyrics, artwork, and comments are fetched directly from public APIs by your device; this project operates no relay servers and neither stores nor distributes copyrighted audio files
- **Copyright**: All music content and entitlements belong to their original platforms, labels, and copyright holders; please respect intellectual property, support official music services, and remove evaluation builds within 24 hours
- **Privacy Boundary**: Zero telemetry, analytics, or credential collection; sessions and caches stay strictly inside the local app sandbox, and JSON backups exclude all cookies and tokens
- **Usage Restrictions**: Commercial use, paid redistribution, and unlawful usage of this project or its derivatives are strictly prohibited
- **Liability**: Users assume full responsibility for any legal disputes, account risks, or damages arising from third-party API changes or improper use
- **Takedown Requests**: If any rights holder believes this project infringes legitimate rights, please submit proof of ownership via [GitHub Issues](https://github.com/xhd2005/puretone/issues) and we will remove the material within **24 hours**

**This project does not accept any commercial partnerships, advertisements, or donations.**

## ⚖️ License

Released under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html). See [LICENSE](LICENSE) for the full license text.

Third-party dependencies and license notices are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
