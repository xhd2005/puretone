package com.xhd2005.puretone

import android.content.Intent
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.plugins.EchoHttpPlugin
import com.xhd2005.puretone.plugins.EchoPlayerPlugin
import com.xhd2005.puretone.plugins.EchoSystemPlugin

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EchoHttpPlugin::class.java)
        registerPlugin(EchoPlayerPlugin::class.java)
        registerPlugin(EchoSystemPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Edge-to-edge layout for iOS 26 Liquid Glass full-bleed bars
        WindowCompat.setDecorFitsSystemWindows(window, false)

        handleLaunchIntent(intent, isColdStart = true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!EchoSystemPlugin.dispatchHardwareBack()) {
                    moveTaskToBack(true)
                }
            }
        })
    }

    override fun onPause() {
        super.onPause()
        // Keep lightweight WebView JS timers alive while music is actively playing in background
        // (e.g. screen-off pocket playback during cycling) so upcoming tracks keep pre-resolving.
        if (EchoPlaybackService.isActivelyPlaying()) {
            try {
                bridge?.webView?.resumeTimers()
            } catch (_: Exception) {
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent, isColdStart = false)
    }

    private fun handleLaunchIntent(intent: Intent?, isColdStart: Boolean) {
        if (intent == null) return
        if (intent.getBooleanExtra("autoClaim", false)) {
            if (isColdStart) EchoSystemPlugin.pendingAutoClaim = true
            else EchoSystemPlugin.dispatchAutoClaimIntent()
        }
        if (intent.getBooleanExtra("openNowPlaying", false)) {
            if (isColdStart) EchoSystemPlugin.pendingOpenNowPlaying = true
            else EchoSystemPlugin.dispatchOpenNowPlayingIntent()
        }
    }
}
