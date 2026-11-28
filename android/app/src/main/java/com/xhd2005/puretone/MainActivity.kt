package com.xhd2005.puretone

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.plugins.EchoHttpPlugin
import com.xhd2005.puretone.plugins.EchoPlayerPlugin
import com.xhd2005.puretone.plugins.EchoSystemPlugin

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Strictly allow WebView remote debugging in Debug builds only (never leak tokens in Release)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        registerPlugin(EchoHttpPlugin::class.java)
        registerPlugin(EchoPlayerPlugin::class.java)
        registerPlugin(EchoSystemPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Edge-to-edge layout for iOS 26 Liquid Glass full-bleed bars
        WindowCompat.setDecorFitsSystemWindows(window, false)
        requestHighRefreshRate()

        handleLaunchIntent(intent, isColdStart = true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!EchoSystemPlugin.dispatchHardwareBack()) {
                    moveTaskToBack(true)
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        requestHighRefreshRate()
    }

    /**
     * Unlocks 90Hz / 120Hz / 144Hz LTPO high-refresh rendering for WebView animations and lyrics
     * on Android devices (OriginOS / ColorOS / HyperOS / OneUI) that otherwise throttle to 60Hz.
     */
    private fun requestHighRefreshRate() {
        try {
            val activeDisplay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                display
            } else {
                @Suppress("DEPRECATION")
                windowManager.defaultDisplay
            } ?: return
            val currentMode = activeDisplay.mode ?: return
            val bestMode = activeDisplay.supportedModes
                ?.filter {
                    it.physicalWidth == currentMode.physicalWidth &&
                        it.physicalHeight == currentMode.physicalHeight
                }
                ?.maxByOrNull { it.refreshRate }
                ?: return
            val params = window.attributes
            if (params.preferredDisplayModeId != bestMode.modeId) {
                params.preferredDisplayModeId = bestMode.modeId
                window.attributes = params
            }
        } catch (_: Exception) {
            // Non-fatal on exotic displays
        }
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
        if (intent.getBooleanExtra("openNowPlaying", false)) {
            if (isColdStart) EchoSystemPlugin.pendingOpenNowPlaying = true
            else EchoSystemPlugin.dispatchOpenNowPlayingIntent()
        }
        val uriStr = intent.dataString?.trim().orEmpty()
        if (EchoSystemPlugin.isAllowedMeluneDeepLink(uriStr)) {
            if (isColdStart) EchoSystemPlugin.pendingDeepLink = uriStr
            else EchoSystemPlugin.dispatchDeepLink(uriStr)
        }
    }
}
