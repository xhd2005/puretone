package com.xhd2005.puretone.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.widget.RemoteViews
import com.xhd2005.puretone.MainActivity
import com.xhd2005.puretone.R
import com.xhd2005.puretone.player.EchoPlaybackService
import kotlin.math.roundToInt

class PureToneWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val fallbackTitle = lastTitle.ifBlank { context.getString(R.string.app_name) }
        val fallbackArtist = lastArtist.ifBlank { context.getString(R.string.widget_idle_subtitle) }
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(
                id,
                buildRemoteViews(
                    context,
                    fallbackTitle,
                    fallbackArtist,
                    lastIsPlaying,
                    lastIsFavorite,
                    lastAccentColor,
                    lastArtwork,
                ),
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
            ACTION_FAV -> {
                val svc = EchoPlaybackService.activeService
                if (svc != null) {
                    svc.handleWidgetToggleFav()
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
        const val ACTION_FAV = "com.xhd2005.puretone.widget.ACTION_FAV"

        private const val DEFAULT_ACCENT = 0xFF1A2D70.toInt()

        @Volatile
        private var lastTitle: String = ""

        @Volatile
        private var lastArtist: String = ""

        @Volatile
        private var lastIsPlaying: Boolean = false

        @Volatile
        private var lastIsFavorite: Boolean = false

        @Volatile
        private var lastAccentColor: Int = DEFAULT_ACCENT

        @Volatile
        private var lastArtwork: Bitmap? = null

        fun updateAll(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?,
            accentColor: Int = DEFAULT_ACCENT,
            isFavorite: Boolean = false,
        ) {
            lastTitle = title.ifBlank { context.getString(R.string.app_name) }
            lastArtist = artist.ifBlank { context.getString(R.string.widget_idle_subtitle) }
            lastIsPlaying = isPlaying
            lastIsFavorite = isFavorite
            lastAccentColor = accentColor
            lastArtwork = artwork?.let { createRoundedCoverBitmap(it, 220, 32f) }

            try {
                val mgr = AppWidgetManager.getInstance(context)
                val ids = mgr.getAppWidgetIds(ComponentName(context, PureToneWidgetProvider::class.java))
                if (ids.isEmpty()) return
                val views = buildRemoteViews(
                    context,
                    lastTitle,
                    lastArtist,
                    lastIsPlaying,
                    lastIsFavorite,
                    lastAccentColor,
                    lastArtwork,
                )
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
            isFavorite: Boolean,
            accentColor: Int,
            artwork: Bitmap?,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_puretone_player)
            val appName = context.getString(R.string.app_name)
            val statusBadge = if (isPlaying) {
                "$appName · ${context.getString(R.string.widget_playing_badge)}"
            } else {
                "$appName · ${context.getString(R.string.widget_paused_badge)}"
            }
            views.setTextViewText(R.id.widget_status, statusBadge)
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_artist, artist)
            views.setImageViewResource(
                R.id.widget_btn_play,
                if (isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
            )
            views.setImageViewResource(
                R.id.widget_btn_fav,
                if (isFavorite) R.drawable.ic_widget_heart_filled else R.drawable.ic_widget_heart,
            )

            createLiquidBackdropBitmap(accentColor)?.let { bgBmp ->
                views.setImageViewBitmap(R.id.widget_backdrop, bgBmp)
            }

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
            views.setOnClickPendingIntent(R.id.widget_btn_fav, broadcastAction(context, ACTION_FAV, 1005))

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

        private fun createLiquidBackdropBitmap(accentColor: Int): Bitmap? {
            return try {
                val w = 480
                val h = 216
                val radius = 44f
                val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(out)
                val rect = RectF(0f, 0f, w.toFloat(), h.toFloat())

                val r = Color.red(accentColor)
                val g = Color.green(accentColor)
                val b = Color.blue(accentColor)
                val topColor = Color.argb(
                    244,
                    (r * 0.72f + 16f).roundToInt().coerceIn(14, 155),
                    (g * 0.72f + 20f).roundToInt().coerceIn(18, 155),
                    (b * 0.72f + 34f).roundToInt().coerceIn(28, 180),
                )
                val bottomColor = Color.argb(
                    250,
                    (r * 0.24f + 8f).roundToInt().coerceIn(8, 52),
                    (g * 0.24f + 10f).roundToInt().coerceIn(10, 56),
                    (b * 0.28f + 22f).roundToInt().coerceIn(18, 78),
                )

                val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    shader = LinearGradient(
                        0f,
                        0f,
                        w.toFloat(),
                        h.toFloat(),
                        topColor,
                        bottomColor,
                        Shader.TileMode.CLAMP,
                    )
                }
                canvas.drawRoundRect(rect, radius, radius, fillPaint)

                // Subtle Liquid Glass specular rim stroke
                val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    style = Paint.Style.STROKE
                    strokeWidth = 2.5f
                    color = Color.argb(46, 255, 255, 255)
                }
                canvas.drawRoundRect(RectF(1.5f, 1.5f, w - 1.5f, h - 1.5f), radius - 1f, radius - 1f, strokePaint)
                out
            } catch (_: Exception) {
                null
            }
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
