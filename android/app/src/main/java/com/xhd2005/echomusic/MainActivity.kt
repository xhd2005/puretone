package com.xhd2005.echomusic

import android.content.Intent
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import com.xhd2005.echomusic.plugins.EchoHttpPlugin
import com.xhd2005.echomusic.plugins.EchoPlayerPlugin
import com.xhd2005.echomusic.plugins.EchoSystemPlugin

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EchoHttpPlugin::class.java)
        registerPlugin(EchoPlayerPlugin::class.java)
        registerPlugin(EchoSystemPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Edge-to-edge layout for Apple Music full-bleed frosted bars
        WindowCompat.setDecorFitsSystemWindows(window, false)

        if (intent?.getBooleanExtra("autoClaim", false) == true) {
            EchoSystemPlugin.pendingAutoClaim = true
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!EchoSystemPlugin.dispatchHardwareBack()) {
                    moveTaskToBack(true)
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("autoClaim", false)) {
            EchoSystemPlugin.dispatchAutoClaimIntent()
        }
    }
}
