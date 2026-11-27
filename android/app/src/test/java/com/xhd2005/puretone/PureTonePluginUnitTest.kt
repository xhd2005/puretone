package com.xhd2005.puretone

import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.player.MeluneIslandController
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
    fun meluneIslandHelpers_enforceZeroIntrusionVisibilityAndBounds() {
        // Hidden when disabled or missing overlay permission
        assertFalse(MeluneIslandController.shouldShowIsland(false, true, false, true, false))
        assertFalse(MeluneIslandController.shouldShowIsland(true, false, false, true, false))
        // Hidden while MELUNE is in foreground unless explicit preview is active
        assertFalse(MeluneIslandController.shouldShowIsland(true, true, true, true, false))
        assertTrue(MeluneIslandController.shouldShowIsland(true, true, true, false, true))
        // Visible in background only when actively playing
        assertTrue(MeluneIslandController.shouldShowIsland(true, true, false, true, false))
        assertFalse(MeluneIslandController.shouldShowIsland(true, true, false, false, false))

        assertEquals(-8, MeluneIslandController.clampOffsetYDp(-40))
        assertEquals(28, MeluneIslandController.clampOffsetYDp(99))
        assertEquals(10, MeluneIslandController.clampOffsetYDp(10))

        assertEquals(140, MeluneIslandController.computeCompactWidthDp(false))
        assertEquals(226, MeluneIslandController.computeCompactWidthDp(true))

        assertEquals("0:00", MeluneIslandController.formatIslandTime(0L))
        assertEquals("3:45", MeluneIslandController.formatIslandTime(225_000L))
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
}
