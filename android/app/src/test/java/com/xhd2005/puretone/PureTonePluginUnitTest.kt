package com.xhd2005.puretone

import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.plugins.EchoHttpPlugin
import com.xhd2005.puretone.plugins.EchoSystemPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

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
    fun computeNextTriggerMillis_alwaysReturnsFutureTimestamp() {
        val cal = Calendar.getInstance().apply {
            set(2026, Calendar.NOVEMBER, 26, 10, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val now = cal.timeInMillis

        val nextPast = EchoSystemPlugin.computeNextTriggerMillis(9, 0, now)
        assertTrue(nextPast > now)
        val pastCal = Calendar.getInstance().apply { timeInMillis = nextPast }
        assertEquals(27, pastCal.get(Calendar.DAY_OF_MONTH))
        assertEquals(9, pastCal.get(Calendar.HOUR_OF_DAY))

        val nextToday = EchoSystemPlugin.computeNextTriggerMillis(21, 30, now)
        assertTrue(nextToday > now)
        val todayCal = Calendar.getInstance().apply { timeInMillis = nextToday }
        assertEquals(26, todayCal.get(Calendar.DAY_OF_MONTH))
        assertEquals(21, todayCal.get(Calendar.HOUR_OF_DAY))
        assertEquals(30, todayCal.get(Calendar.MINUTE))
    }

    @Test
    fun computeEqBandGains_producesExpectedCurvesForPresets() {
        val freqs = intArrayOf(60, 230, 910, 3600, 14000)
        val flat = EchoPlaybackService.computeEqBandGains("flat", freqs)
        assertTrue(flat.all { it == 0 })

        val bass = EchoPlaybackService.computeEqBandGains("bass", freqs)
        assertTrue(bass[0] > bass[2])

        val vocal = EchoPlaybackService.computeEqBandGains("vocal", freqs)
        assertTrue(vocal[2] > vocal[0])

        val night = EchoPlaybackService.computeEqBandGains("night", freqs)
        assertTrue(night[4] < 0 && night[0] > 0)
    }

    @Test
    fun selectNotificationAccentRgb_extractsDarkenedRichAccentAndAvoidsWashout() {
        val brightBlue = listOf(Triple(50, 180, 255), Triple(40, 160, 240))
        val (r, g, b) = EchoPlaybackService.selectNotificationAccentRgb(brightBlue)
        assertTrue(b > r && b <= 185)
    }
}
