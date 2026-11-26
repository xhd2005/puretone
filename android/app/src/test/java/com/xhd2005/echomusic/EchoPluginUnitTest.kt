package com.xhd2005.echomusic

import com.xhd2005.echomusic.plugins.EchoHttpPlugin
import com.xhd2005.echomusic.plugins.EchoSystemPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class EchoPluginUnitTest {

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

        // 09:00 is already in the past -> must schedule for tomorrow 09:00
        val nextPast = EchoSystemPlugin.computeNextTriggerMillis(9, 0, now)
        assertTrue(nextPast > now)
        val pastCal = Calendar.getInstance().apply { timeInMillis = nextPast }
        assertEquals(27, pastCal.get(Calendar.DAY_OF_MONTH))
        assertEquals(9, pastCal.get(Calendar.HOUR_OF_DAY))

        // 21:30 is later today -> must schedule for today 21:30
        val nextToday = EchoSystemPlugin.computeNextTriggerMillis(21, 30, now)
        assertTrue(nextToday > now)
        val todayCal = Calendar.getInstance().apply { timeInMillis = nextToday }
        assertEquals(26, todayCal.get(Calendar.DAY_OF_MONTH))
        assertEquals(21, todayCal.get(Calendar.HOUR_OF_DAY))
        assertEquals(30, todayCal.get(Calendar.MINUTE))
    }
}
