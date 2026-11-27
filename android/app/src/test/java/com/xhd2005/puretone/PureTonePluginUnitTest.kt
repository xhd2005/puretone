package com.xhd2005.puretone

import androidx.media3.common.Player
import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.plugins.EchoHttpPlugin
import com.xhd2005.puretone.plugins.EchoSystemPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PureTonePluginUnitTest {

    @Test
    fun extractHeaderValues_isCaseInsensitiveAndPreservesMultiCookies() {
        val headers = listOf(
            "Set-Cookie" to "dfid=abc; Path=/",
            "content-type" to "application/json",
            "set-cookie" to "token=xyz; HttpOnly",
        )
        val cookies = EchoHttpPlugin.extractHeaderValues(headers, "Set-Cookie")
        assertEquals(listOf("dfid=abc; Path=/", "token=xyz; HttpOnly"), cookies)
    }

    @Test
    fun apkVerificationHelpers_validateZipMagicAndSha256() {
        val validApkHeader = byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00)
        val htmlProxyError = "<!DOCTYPE html><html>403</html>".toByteArray()
        assertTrue(EchoSystemPlugin.isValidApkHeader(validApkHeader))
        assertFalse(EchoSystemPlugin.isValidApkHeader(htmlProxyError))
        assertFalse(EchoSystemPlugin.isValidApkHeader(byteArrayOf(0x50, 0x4B)))

        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            EchoSystemPlugin.sha256Hex("abc".toByteArray()),
        )
    }

    @Test
    fun computeEqBandGains_producesZeroClippingSubtractiveCurvesForPresets() {
        val freqs = intArrayOf(60, 230, 910, 3600, 14000)
        for (preset in listOf("flat", "vocal", "bass", "night", "live")) {
            val gains = EchoPlaybackService.computeEqBandGains(preset, freqs)
            assertTrue("Preset $preset must never exceed 0 mB to prevent digital clipping", gains.all { it <= 0 })
        }

        val flat = EchoPlaybackService.computeEqBandGains("flat", freqs)
        assertTrue(flat.all { it == 0 })

        val bass = EchoPlaybackService.computeEqBandGains("bass", freqs)
        assertTrue(bass[0] > bass[2])

        val vocal = EchoPlaybackService.computeEqBandGains("vocal", freqs)
        assertTrue(vocal[2] > vocal[0] && vocal[2] == 0)

        val night = EchoPlaybackService.computeEqBandGains("night", freqs)
        assertTrue(night[4] < night[0] && night[4] <= -450)
    }

    @Test
    fun selectNotificationAccentRgb_extractsDarkenedRichAccentAndAvoidsWashout() {
        val brightBlue = listOf(Triple(50, 180, 255), Triple(40, 160, 240))
        val (r, g, b) = EchoPlaybackService.selectNotificationAccentRgb(brightBlue)
        assertTrue(b > r && b <= 185)
    }

    @Test
    fun computeTrackFadeFactor_smoothlyTapersWithinWindowAndClampsBounds() {
        assertEquals(1.0f, EchoPlaybackService.computeTrackFadeFactor(4000L, 3000L), 0.001f)
        assertEquals(1.0f, EchoPlaybackService.computeTrackFadeFactor(1000L, 0L), 0.001f)
        val mid = EchoPlaybackService.computeTrackFadeFactor(1500L, 3000L)
        assertTrue("Midpoint fade should be roughly half volume ($mid)", mid in 0.45f..0.60f)
        val tail = EchoPlaybackService.computeTrackFadeFactor(0L, 3000L)
        assertEquals(0.08f, tail, 0.001f)
    }

    @Test
    fun audioCacheLimitHelpers_defaultTo2GbAndValidateAllTiers() {
        assertEquals(2048, EchoPlaybackService.DEFAULT_AUDIO_CACHE_MAX_MB)
        assertEquals(500, EchoPlaybackService.sanitizeAudioCacheMaxMb(500))
        assertEquals(1024, EchoPlaybackService.sanitizeAudioCacheMaxMb(1024))
        assertEquals(2048, EchoPlaybackService.sanitizeAudioCacheMaxMb(2048))
        assertEquals(4096, EchoPlaybackService.sanitizeAudioCacheMaxMb(4096))
        assertEquals(0, EchoPlaybackService.sanitizeAudioCacheMaxMb(0))
        assertEquals(2048, EchoPlaybackService.sanitizeAudioCacheMaxMb(777))

        assertEquals(0L, EchoPlaybackService.audioCacheMbToBytes(0))
        assertEquals(2048L * 1024L * 1024L, EchoPlaybackService.audioCacheMbToBytes(2048))
        assertEquals(4096L * 1024L * 1024L, EchoPlaybackService.audioCacheMbToBytes(4096))
    }

    @Test
    fun liveUpdatesPromotion_avoidsMutualExclusionOnAndroid16Plus() {
        assertFalse(EchoPlaybackService.shouldUsePromotedLiveUpdate(35, true))
        assertFalse(EchoPlaybackService.shouldUsePromotedLiveUpdate(36, false))
        assertTrue(EchoPlaybackService.shouldUsePromotedLiveUpdate(36, true))
        assertTrue(EchoPlaybackService.shouldUsePromotedLiveUpdate(37, true))

        assertEquals("月光奏鸣曲", EchoPlaybackService.formatShortCriticalTitle("  月光奏鸣曲  "))
        val longTitle = "A Very Long Track Title That Exceeds Status Chip Width"
        val shortened = EchoPlaybackService.formatShortCriticalTitle(longTitle)
        assertEquals(18, shortened.length)
        assertTrue(shortened.endsWith("…"))
    }

    @Test
    fun perItemHeaderResolution_isolatesRefererAndPreservesCustomUserAgent() {
        val biliHeaders = EchoPlaybackService.resolveRequestHeaders(
            existingHeaders = emptyMap(),
            itemHeaders = mapOf(
                "Referer" to "https://www.bilibili.com/",
                "User-Agent" to "CustomMobileUA/1.0",
            ),
        )
        assertEquals("https://www.bilibili.com/", biliHeaders["Referer"])
        assertEquals("CustomMobileUA/1.0", biliHeaders["User-Agent"])

        // KuGou official track gets default UA and zero leaked Bilibili Referer
        val kugouHeaders = EchoPlaybackService.resolveRequestHeaders(
            existingHeaders = emptyMap(),
            itemHeaders = emptyMap(),
        )
        assertFalse(kugouHeaders.containsKey("Referer"))
        assertEquals(EchoPlaybackService.DEFAULT_USER_AGENT, kugouHeaders["User-Agent"])
    }

    @Test
    fun isUpcomingPreloadError_accuratelyIsolatesTrackBFailuresAtFourFifths() {
        // Explicit DataSpec mismatch (Track B failed at 4/5 of Track A) -> MUST isolate!
        assertTrue(
            EchoPlaybackService.isUpcomingPreloadError(
                failingUri = "https://cdn.bilibili.com/trackB.m4s",
                failingKey = "v2:hash:b:320:bilibili",
                activeUri = "https://trackercdn.kugou.com/trackA.flac",
                activeKey = "v2:hash:a:flac:official",
                hasUpcomingItems = true,
                alreadyIsolated = false,
                savedPositionMs = 192_000L,
                knownStreamDurationMs = 240_000L,
            ),
        )

        // Explicit DataSpec match proves Track A itself failed -> do NOT misclassify as upcoming
        assertFalse(
            EchoPlaybackService.isUpcomingPreloadError(
                failingUri = "https://trackercdn.kugou.com/trackA.flac",
                failingKey = "v2:hash:a:flac:official",
                activeUri = "https://trackercdn.kugou.com/trackA.flac",
                activeKey = "v2:hash:a:flac:official",
                hasUpcomingItems = true,
                alreadyIsolated = false,
                savedPositionMs = 192_000L,
                knownStreamDurationMs = 240_000L,
            ),
        )

        // Non-HTTP ParserException while upcoming items exist & not yet isolated -> isolate once
        assertTrue(
            EchoPlaybackService.isUpcomingPreloadError(
                failingUri = null,
                failingKey = null,
                activeUri = "https://trackercdn.kugou.com/trackA.flac",
                activeKey = "v2:hash:a:flac:official",
                hasUpcomingItems = true,
                alreadyIsolated = false,
                savedPositionMs = 185_000L,
                knownStreamDurationMs = 240_000L,
            ),
        )

        // Already isolated once -> treat subsequent error as Track A error
        assertFalse(
            EchoPlaybackService.isUpcomingPreloadError(
                failingUri = null,
                failingKey = null,
                activeUri = "https://trackercdn.kugou.com/trackA.flac",
                activeKey = "v2:hash:a:flac:official",
                hasUpcomingItems = true,
                alreadyIsolated = true,
                savedPositionMs = 185_000L,
                knownStreamDurationMs = 240_000L,
            ),
        )
    }

    @Test
    fun shortTrialAndPrematureEofGuards_catchChorusAndFourFifthsCutoffsWithoutFalsePositives() {
        // 60s VIP trial snippet on a 4-minute song -> detected immediately at STATE_READY!
        assertTrue(EchoPlaybackService.isUnexpectedShortStream(60_000L, 240_000L, false))
        // 30s preview on a 3-minute song -> detected
        assertTrue(EchoPlaybackService.isUnexpectedShortStream(30_000L, 180_000L, false))
        // Legitimate 3:35 radio edit vs 4:00 album version -> NOT misclassified as trial
        assertFalse(EchoPlaybackService.isUnexpectedShortStream(215_000L, 240_000L, false))
        // Short 45s interlude track -> NOT misclassified
        assertFalse(EchoPlaybackService.isUnexpectedShortStream(45_000L, 50_000L, false))
        // Already a recovery reload -> never loops
        assertFalse(EchoPlaybackService.isUnexpectedShortStream(60_000L, 240_000L, true))

        // 4/5 truncated EOF (192s / 240s) -> triggers recovery!
        assertTrue(EchoPlaybackService.shouldTriggerPrematureEndRecovery(192_000L, 240_000L, 240_000L, false))
        // Chorus 60s sneaky trial EOF -> triggers recovery!
        assertTrue(EchoPlaybackService.shouldTriggerPrematureEndRecovery(60_000L, 60_000L, 240_000L, false))
        // Normal end-of-song (238s / 240s) -> does NOT trigger recovery
        assertFalse(EchoPlaybackService.shouldTriggerPrematureEndRecovery(238_000L, 240_000L, 240_000L, false))
        // Already recovered once -> does NOT loop
        assertFalse(EchoPlaybackService.shouldTriggerPrematureEndRecovery(192_000L, 240_000L, 240_000L, true))
    }

    @Test
    fun computeEffectiveIsPlaying_staysTrueDuringSeekBufferingWithoutCoverTwitch() {
        // Playing normally
        assertTrue(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = true,
                playWhenReady = true,
                playbackState = Player.STATE_READY,
            ),
        )
        // Transient seek rebuffer while playWhenReady == true -> MUST stay true (no pause flash / cover shrink!)
        assertTrue(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = false,
                playWhenReady = true,
                playbackState = Player.STATE_BUFFERING,
                playbackSuppressionReason = Player.PLAYBACK_SUPPRESSION_REASON_NONE,
            ),
        )
        // Seeking while paused (playWhenReady == false) -> MUST remain false
        assertFalse(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = false,
                playWhenReady = false,
                playbackState = Player.STATE_BUFFERING,
            ),
        )
        // Transient audio focus loss during buffering -> MUST drop to false
        assertFalse(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = false,
                playWhenReady = true,
                playbackState = Player.STATE_BUFFERING,
                playbackSuppressionReason = Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS,
            ),
        )
        // Playback ended or idle -> MUST be false
        assertFalse(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = false,
                playWhenReady = true,
                playbackState = Player.STATE_ENDED,
            ),
        )
        assertFalse(
            EchoPlaybackService.computeEffectiveIsPlaying(
                isPlaying = false,
                playWhenReady = true,
                playbackState = Player.STATE_IDLE,
            ),
        )
    }
}
