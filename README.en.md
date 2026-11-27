<div align="center">

<img src="./docs/melune-icon.png" width="108" height="108" alt="MELUNE Logo" style="border-radius: 26px;" />

# MELUNE · 弥音

[简体中文](./README.md) | **English** | [繁體中文](./README.zh-TW.md)

**Music fades in time, yet echoes linger on.**  
*Where Music Becomes Memory.*

Minimalist & Ad-Free · iOS 26 Liquid Glass Craftsmanship · Native Media3 Background Playback · Built-in MELUNE Dynamic Island · Trilingual Open-Source Android Music Client

[![Release](https://img.shields.io/github/v/release/xhd2005/puretone?style=flat-square&color=3456be)](https://github.com/xhd2005/puretone/releases/latest)
[![Android CI](https://img.shields.io/github/actions/workflow/status/xhd2005/puretone/android-apk.yml?branch=main&style=flat-square&label=Android%20APK%20CI)](https://github.com/xhd2005/puretone/actions)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-2fb350?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Platform](https://img.shields.io/badge/Android-10%20~%2017-1a2d70?style=flat-square)](#)

[📥 Download Latest APK](https://github.com/xhd2005/puretone/releases/latest) · [✨ Highlights](#-highlights) · [🙏 Special Thanks](#-special-thanks) · [👤 Author](#-author) · [⚖️ Compliance & Disclaimer](#%EF%B8%8F-compliance--full-legal-disclaimer)

</div>

---

## 🌙 Brand Philosophy

> **Mi (弥)** is lingering resonance — fullness and sound rippling quietly beyond time.  
> **Yin (音)** is melody and emotion — a private sanctuary uniquely your own.  
> MELUNE hopes to give every melody a space of its own, where every emotion finds resonance.  
> **MELUNE** (*Melody* × *Lune*) — **Music fades in time, yet echoes linger on.**

---

## ✨ Highlights

### 🎧 Native Background Media3 Engine, Smooth Transitions & Zero-Clip DSP
- **3-Track Native Lookahead Queue**: Automatically pre-resolves upcoming tracks directly into Jetpack Media3 `ExoPlayer` with a 300MB LRU audio cache for zero-drop screen-off playback and instant Bluetooth headset skipping.
- **Cosine Track Transition Fade**: Single-engine fade-out & gentle entry (`Off` / `1.5s` / `3s` / `5s`) plus soft pause/resume volume ramps.
- **Volume Leveling & Subtractive Zero-Clip EQ**: 5 studio-safe presets (`Flat`, `Vocal`, `Bass`, `Night`, `Live`) strictly kept `<= 0 dB` with duck-and-ramp switching so tracks never clip or pop.

### 🏝️ Built-in "MELUNE Dynamic Island" & Android 16/17 Live Updates
- **Universal Stock Android Support**: A 100% native Kotlin floating capsule built on standard `SYSTEM_ALERT_WINDOW` — works out-of-the-box on stock unrooted vivo OriginOS, ColorOS, HyperOS, OneUI, and Pixel with zero root, zero Shizuku, and zero package spoofing.
- **Dual Modes & Dynamic Album-Colored Card**: Defaults to a sleek **dual-wing punch-hole capsule** (circular cover + centered cutout gap + animated 3-bar waveform), with an optional **live single-line lyric capsule** toggle, vertical Y-offset alignment, and a 4-second live preview right inside Settings. Tap to expand into full playback controls; automatically hides when returning to MELUNE or pausing.
- **Fixed Android 16/17 Official Live Updates** (properly separating `EXTRA_COLORIZED` from `requestPromotedOngoing`) plus a **4×2 Dynamic Album-Colored Home Widget**.

### 🎵 Zero-Flicker Player, Word-by-Word KRC Lyrics & Deep Discovery
- **Persistent Artwork Stage & Monotonic Lyric Clock**: Zero playback flicker during word-by-word karaoke sweep; 3 font sizes, per-song lyric sync offset (`±0.5s` / `±1s`), and chorus highlight (`song_climax`) markers on the scrub bar.
- **120fps Direct-Canvas Lyric Poster Studio**: 5 curated 1080p templates (*Glass*, *Vinyl*, *Polaroid*, *Cinema*, *Moonlit*) with LRU cover caching, smooth offscreen blur, translation toggle, date stamp, gallery save, and native share.
- **Track Details & 4-Mode Comments**: Featured / Top / Latest / Hotword tabs, clean floor-reply threads with 100+ native emoji mappings, real-time comment likes, and signed-in replies.
- **Full Cloud Playlist Management & Bottom Takeover Dock**: Create, edit, delete, collect/uncollect, and batch-manage tracks alongside rich Artist Profiles, Album pages, and Trending Charts.

### 🚀 Cold-Start Auto-Update, Multi-Mirror Acceleration & Legacy WebView Support
- **Automatic Cold-Start Update Prompt**: Silently checks on launch after the splash finishes, clearly distinguishing **"Later"** (remind next launch) vs **"Ignore vX.Y.Z"**, backed by multi-mirror failover and SHA-256 verification.
- **Full Android 11 / ColorOS 11.1 Legacy WebView Compatibility**: Automated CSS compatibility gates ensure crisp rendering across both legacy and flagship Android devices, with full Simplified Chinese, Traditional Chinese, and English support.

---

## 📥 Installation & Lossless Overwrite Upgrade

1. Download **`MELUNE-v2.4.8-release.apk`** from [GitHub Releases](https://github.com/xhd2005/puretone/releases/latest). The permanent `com.xhd2005.puretone` package ID and 50-year release certificate ensure **100% lossless overwrite upgrades** from any earlier release without re-logging in.
2. Enable **Notifications** and disable aggressive battery restriction in Android settings for reliable screen-off playback.
3. **Enabling MELUNE Dynamic Island**: Open *Account & Settings → Preferences → **MELUNE Dynamic Island***, toggle it on, grant the standard overlay permission, and use the `- / +` offset & 4s preview to hug your camera cutout seamlessly.

---

## 🙏 Special Thanks

MELUNE exists and keeps improving thanks to these remarkable open-source foundations, inspirations, and community testers:

| Credit | Contribution & Inspiration |
| --- | --- |
| [**MakcRe/KuGouMusicApi**](https://github.com/MakcRe/KuGouMusicApi) | Comprehensive client-side KuGou Concept API protocol and signing references that make our pure on-device direct architecture possible. |
| [**EchoMusic**](https://github.com/EchoMusicApp) | Inspiring mobile player ergonomics, artist profile layouts, and restrained audio-first product aesthetics. |
| **Open-Source Core Stack** | Deep gratitude to the maintainers of [Android Jetpack Media3](https://developer.android.com/media/media3), [Capacitor](https://capacitorjs.com/), [Vue 3](https://vuejs.org/), [Pinia](https://pinia.vuejs.org/), [Tailwind CSS](https://tailwindcss.com/), [Iconify](https://iconify.design/), [OkHttp](https://square.github.io/okhttp/), and [Vitest](https://vitest.dev/). |
| **Real-Device Testers & Early Users** | Heartfelt thanks to every friend and early user who tested builds on real **Android 11 / ColorOS 11.1**, **vivo OriginOS**, and **Xiaomi HyperOS** devices, shared screenshots, and helped polish flicker, animations, comments, and Dynamic Island behavior. |

---

## 👤 Author

**Hayden Xue ([@xhd2005](https://github.com/xhd2005))**  
Indie developer and enthusiast of music & interaction aesthetics, committed to building pure, restrained, ad-free mobile audio software in the open.

---

## 🛠️ Tech Stack & Local Build

- **Frontend & Cross-Platform**: Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS v4 + Capacitor 7
- **Native Audio & Overlay**: Kotlin + Android Jetpack Media3 (`ExoPlayer` 1.5.1 + `MediaSessionService` + 300MB LRU disk cache + `Equalizer` / `LoudnessEnhancer`) + native `WindowManager` Dynamic Island controller
- **Build Commands**:
  ```bash
  pnpm install
  pnpm typecheck && pnpm test && pnpm build
  npx cap sync android
  cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease
  ```

---

## ⚖️ Compliance & Full Legal Disclaimer

> **Please read all 7 articles carefully before downloading or using this software (also presented and confirmed on first launch and after every version update):**

1. **Educational & Strictly Non-Commercial Purpose**: MELUNE (弥音) is open-sourced by indie developer Hayden Xue (@xhd2005) under GNU GPL-3.0 solely for personal study of mobile audio engineering, Jetpack Media3, and Liquid Glass UI craftsmanship. It is permanently ad-free with zero paywalls or monetization; commercial use or paid redistribution is strictly prohibited.
2. **Pure On-Device Client & Zero Content Hosting**: MELUNE runs exclusively on your device. The author operates no relay or media servers and never stores, caches, uploads, distributes, or provides copyrighted audio, lyrics, or artwork. All network requests originate directly from your device.
3. **Intellectual Property & Support Official Platforms**: All audio streams, lyrics, cover artwork, comments, and membership entitlements belong strictly to their respective music platforms, record labels, and copyright holders. Please respect artists, support legitimate music services, and remove test builds within 24 hours after evaluation.
4. **Third-Party APIs & Experimental Features At Your Own Risk**: Signing into third-party music accounts, posting comments, following artists, and using experimental audio matching or check-in features are entirely user-initiated. Users assume full responsibility for compliance with third-party Terms of Service, account standing, or service disruptions.
5. **Privacy & Local Data Boundary**: MELUNE never collects, uploads, or tracks personal information, credentials, or listening analytics. Sessions, playlist snapshots, and listening statistics stay strictly inside your device sandbox; JSON exports explicitly exclude all cookies and tokens.
6. **GNU GPL-3.0 & "AS-IS" Limitation of Liability**: This software is provided "AS-IS" under GNU GPL-3.0 without warranties of any kind, express or implied. To the maximum extent permitted by applicable law, the author and contributors shall not be liable for any direct, indirect, incidental, or consequential damages.
7. **Copyright Takedown & 24-Hour Response Channel**: We respect intellectual property rights. If any rights holder or platform believes any code reference, adapter, or documentation infringes legitimate rights, please submit proof of ownership via [GitHub Issues](https://github.com/xhd2005/puretone/issues) or our public contact channel and we will remove the material within **24 hours**.
