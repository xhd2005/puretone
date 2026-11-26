package com.xhd2005.puretone.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.widget.RemoteViews
import com.xhd2005.puretone.MainActivity
import com.xhd2005.puretone.R
import com.xhd2005.puretone.player.EchoPlaybackService

class PureToneWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(
                id,
                buildRemoteViews(context, lastTitle, lastArtist, lastIsPlaying, lastArtwork),
            )
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_TOGGLE -> {
                val svc = EchoPlaybackService.activeService
                if (svc != null) {
                    svc.handleWidgetTogglePlay()
                } else {
                    launchMainApp(context, openNowPlaying = true)
                }
            }
            ACTION_NEXT -> {
                val svc = EchoPlaybackService.activeService
                if (svc != null) {
                    svc.handleWidgetNext()
                } else {
                    launchMainApp(context, openNowPlaying = true)
                }
            }
            ACTION_PREV -> {
                val svc = EchoPlaybackService.activeService
                if (svc != null) {
                    svc.handleWidgetPrev()
                } else {
                    launchMainApp(context, openNowPlaying = true)
                }
            }
        }
    }

    private fun launchMainApp(context: Context, openNowPlaying: Boolean) {
        val i = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("openNowPlaying", openNowPlaying)
        }
        try {
            context.startActivity(i)
        } catch (_: Exception) {
            // ignore
        }
    }

    companion object {
        const val ACTION_TOGGLE = "com.xhd2005.puretone.widget.ACTION_TOGGLE"
        const val ACTION_NEXT = "com.xhd2005.puretone.widget.ACTION_NEXT"
        const val ACTION_PREV = "com.xhd2005.puretone.widget.ACTION_PREV"

        @Volatile
        private var lastTitle: String = "PureTone"

        @Volatile
        private var lastArtist: String = "轻触开始聆听"

        @Volatile
        private var lastIsPlaying: Boolean = false

        @Volatile
        private var lastArtwork: Bitmap? = null

        fun updateAll(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?,
        ) {
            lastTitle = title.ifBlank { context.getString(R.string.app_name) }
            lastArtist = artist.ifBlank { "轻触开始聆听" }
            lastIsPlaying = isPlaying
            lastArtwork = artwork?.let { createRoundedCoverBitmap(it, 200, 28f) }

            try {
                val mgr = AppWidgetManager.getInstance(context)
                val ids = mgr.getAppWidgetIds(ComponentName(context, PureToneWidgetProvider::class.java))
                if (ids.isEmpty()) return
                val views = buildRemoteViews(context, lastTitle, lastArtist, lastIsPlaying, lastArtwork)
                for (id in ids) {
                    mgr.updateAppWidget(id, views)
                }
            } catch (_: Exception) {
                // Non-fatal
            }
        }

        private fun buildRemoteViews(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_puretone_player)
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_artist, artist)
            views.setImageViewResource(
                R.id.widget_btn_play,
                if (isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
            )

            if (artwork != null && !artwork.isRecycled) {
                views.setImageViewBitmap(R.id.widget_cover, artwork)
            } else {
                views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher)
            }

            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("openNowPlaying", true)
            }
            val openPi = PendingIntent.getActivity(
                context,
                1001,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, openPi)
            views.setOnClickPendingIntent(R.id.widget_cover, openPi)

            views.setOnClickPendingIntent(R.id.widget_btn_prev, broadcastAction(context, ACTION_PREV, 1002))
            views.setOnClickPendingIntent(R.id.widget_btn_play, broadcastAction(context, ACTION_TOGGLE, 1003))
            views.setOnClickPendingIntent(R.id.widget_btn_next, broadcastAction(context, ACTION_NEXT, 1004))

            return views
        }

        private fun broadcastAction(context: Context, action: String, reqCode: Int): PendingIntent {
            val intent = Intent(context, PureToneWidgetProvider::class.java).apply {
                this.action = action
            }
            return PendingIntent.getBroadcast(
                context,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun createRoundedCoverBitmap(src: Bitmap, sizePx: Int, radiusPx: Float): Bitmap? {
            return try {
                val scaled = Bitmap.createScaledBitmap(src, sizePx, sizePx, true)
                val out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(out)
                val path = Path().apply {
                    addRoundRect(RectF(0f, 0f, sizePx.toFloat(), sizePx.toFloat()), radiusPx, radiusPx, Path.Direction.CW)
                }
                canvas.clipPath(path)
                canvas.drawBitmap(scaled, 0f, 0f, null)
                if (scaled !== src) scaled.recycle()
                out
            } catch (_: Exception) {
                null
            }
        }
    }
}
