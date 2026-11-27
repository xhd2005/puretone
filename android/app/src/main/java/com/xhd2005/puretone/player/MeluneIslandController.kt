package com.xhd2005.puretone.player

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.xhd2005.puretone.MainActivity
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

interface IslandCallbacks {
    fun onTogglePlay()
    fun onNext()
    fun onPrev()
    fun onToggleFavorite()
    fun onOffsetYChanged(offsetYDp: Int)
}

/**
 * Built-in compliant native Floating Dynamic Island ("弥音灵动岛") using standard Android
 * SYSTEM_ALERT_WINDOW (TYPE_APPLICATION_OVERLAY).
 *
 * Works out-of-the-box on stock unrooted vivo OriginOS, ColorOS, HyperOS, OneUI, and Pixel
 * with zero root, zero Shizuku, and zero third-party package spoofing.
 *
 * Visibility rule:
 *   Shows ONLY when enabled && overlay permission granted && ((!appInForeground && isPlaying) || previewActive).
 *   Automatically hides inside MELUNE foreground or when paused/stopped.
 */
class MeluneIslandController(
    private val context: Context,
    private val callbacks: IslandCallbacks,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val density = context.resources.displayMetrics.density.coerceAtLeast(1f)

    private var enabled: Boolean = prefs.getBoolean(KEY_ENABLED, false)
    private var showLyric: Boolean = prefs.getBoolean(KEY_SHOW_LYRIC, false)
    private var offsetYDp: Int = clampOffsetYDp(prefs.getInt(KEY_OFFSET_Y, DEFAULT_OFFSET_Y_DP))

    private var appInForeground: Boolean = true
    private var isPlaying: Boolean = false
    private var previewActive: Boolean = false
    private var expanded: Boolean = false

    private var trackTitle: String = "弥音 · MELUNE"
    private var trackArtist: String = "余音绵延，音乐无界"
    private var liveLyric: String = ""
    private var artworkBitmap: Bitmap? = null
    private var accentColor: Int = DEFAULT_ACCENT
    private var isFavorite: Boolean = false
    private var positionMs: Long = 0L
    private var durationMs: Long = 0L

    private var rootFrame: FrameLayout? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var isAttached: Boolean = false

    // Compact views
    private var compactPill: LinearLayout? = null
    private var compactCoverImg: ImageView? = null
    private var compactCoverFallback: TextView? = null
    private var compactSpacer: View? = null
    private var compactLyricView: TextView? = null
    private var compactWave: IslandWaveformView? = null

    // Expanded views
    private var expandedCard: LinearLayout? = null
    private var expandedCoverImg: ImageView? = null
    private var expandedCoverFallback: TextView? = null
    private var expandedTitleView: TextView? = null
    private var expandedArtistView: TextView? = null
    private var expandedLyricView: TextView? = null
    private var expandedHeartBtn: IslandGlyphButton? = null
    private var expandedPlayBtn: IslandGlyphButton? = null
    private var expandedProgress: IslandProgressView? = null
    private var expandedPosText: TextView? = null
    private var expandedDurText: TextView? = null

    private val autoCollapseRunnable = Runnable {
        if (expanded) {
            setExpanded(false)
        }
    }

    private val endPreviewRunnable = Runnable {
        previewActive = false
        syncVisibility()
    }

    fun updateConfig(enabled: Boolean, showLyric: Boolean, offsetYDp: Int) {
        mainHandler.post {
            val clampedY = clampOffsetYDp(offsetYDp)
            this.enabled = enabled
            this.showLyric = showLyric
            this.offsetYDp = clampedY
            prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putBoolean(KEY_SHOW_LYRIC, showLyric)
                .putInt(KEY_OFFSET_Y, clampedY)
                .apply()
            if (!enabled) {
                previewActive = false
                mainHandler.removeCallbacks(endPreviewRunnable)
                expanded = false
            }
            applyStyleAndData()
            syncVisibility()
        }
    }

    fun triggerPreview(durationMs: Long = 4200L) {
        mainHandler.post {
            if (!hasOverlayPermission()) return@post
            previewActive = true
            mainHandler.removeCallbacks(endPreviewRunnable)
            mainHandler.postDelayed(endPreviewRunnable, durationMs.coerceIn(1500L, 8000L))
            syncVisibility()
        }
    }

    fun setAppInForeground(foreground: Boolean) {
        mainHandler.post {
            if (appInForeground == foreground) return@post
            appInForeground = foreground
            if (foreground && !previewActive) {
                expanded = false
            }
            syncVisibility()
        }
    }

    fun updateTrack(
        title: String,
        artist: String,
        artwork: Bitmap?,
        accentColor: Int,
        isPlaying: Boolean,
        isFavorite: Boolean,
        durationMs: Long,
    ) {
        mainHandler.post {
            this.trackTitle = title.ifBlank { "弥音 · MELUNE" }
            this.trackArtist = artist.ifBlank { "未知歌手" }
            this.artworkBitmap = artwork
            this.accentColor = accentColor
            this.isPlaying = isPlaying
            this.isFavorite = isFavorite
            if (durationMs > 0L) this.durationMs = durationMs
            applyStyleAndData()
            syncVisibility()
        }
    }

    fun updatePlaybackState(playing: Boolean) {
        mainHandler.post {
            if (isPlaying == playing) return@post
            isPlaying = playing
            if (!playing && !previewActive) {
                expanded = false
            }
            applyStyleAndData()
            syncVisibility()
        }
    }

    fun updateFavorite(favorite: Boolean) {
        mainHandler.post {
            isFavorite = favorite
            expandedHeartBtn?.setTint(if (favorite) COLOR_HEART_ACTIVE else COLOR_HEART_INACTIVE)
            expandedHeartBtn?.setGlyph(if (favorite) GlyphType.HEART_FILLED else GlyphType.HEART_OUTLINE)
        }
    }

    fun updateLiveLyric(line: String) {
        mainHandler.post {
            val clean = line.trim()
            if (clean == liveLyric) return@post
            liveLyric = clean
            if (isAttached) {
                updateLyricTexts()
            }
        }
    }

    fun updateProgress(posMs: Long, durMs: Long) {
        mainHandler.post {
            positionMs = posMs.coerceAtLeast(0L)
            if (durMs > 0L) durationMs = durMs
            if (isAttached && expanded) {
                val frac = if (durationMs > 0L) (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) else 0f
                expandedProgress?.setProgress(frac)
                expandedPosText?.text = formatIslandTime(positionMs)
                expandedDurText?.text = formatIslandTime(durationMs)
            }
        }
    }

    fun destroy() {
        mainHandler.post {
            mainHandler.removeCallbacks(autoCollapseRunnable)
            mainHandler.removeCallbacks(endPreviewRunnable)
            compactWave?.setPlaying(false)
            detachWindow()
            rootFrame = null
            compactPill = null
            expandedCard = null
        }
    }

    private fun hasOverlayPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
    }

    private fun dp(value: Int): Int = (value * density).roundToInt()

    private fun dpF(value: Float): Float = value * density

    private fun syncVisibility() {
        val visible = shouldShowIsland(
            enabled = enabled || previewActive,
            hasOverlayPermission = hasOverlayPermission(),
            appInForeground = appInForeground,
            isPlaying = isPlaying,
            previewActive = previewActive,
        )
        if (visible) {
            ensureViewsCreated()
            attachOrUpdateWindow()
            applyStyleAndData()
            compactWave?.setPlaying((isPlaying || previewActive) && !expanded)
        } else {
            expanded = false
            mainHandler.removeCallbacks(autoCollapseRunnable)
            compactWave?.setPlaying(false)
            detachWindow()
        }
    }

    private fun ensureViewsCreated() {
        if (rootFrame != null) return

        val root = object : FrameLayout(context) {
            override fun onTouchEvent(event: MotionEvent): Boolean {
                if (event.action == MotionEvent.ACTION_OUTSIDE && expanded) {
                    setExpanded(false)
                    return true
                }
                return super.onTouchEvent(event)
            }
        }
        root.clipChildren = false
        root.clipToPadding = false

        val pill = buildCompactPill()
        val card = buildExpandedCard()
        card.visibility = View.GONE

        root.addView(
            pill,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.CENTER_HORIZONTAL,
            ),
        )
        root.addView(
            card,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.CENTER_HORIZONTAL,
            ),
        )

        rootFrame = root
        compactPill = pill
        expandedCard = card
    }

    private fun buildCompactPill(): LinearLayout {
        val pill = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(7), dp(4), dp(8), dp(4))
            elevation = dpF(6f)
        }

        val coverSize = dp(22)
        val coverBox = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(coverSize, coverSize)
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setOval(0, 0, view.width, view.height)
                }
            }
            clipToOutline = true
        }
        val fallback = TextView(context).apply {
            text = "♪"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF4F7CFF.toInt(), 0xFF1F327A.toInt()),
            )
        }
        val img = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
        }
        coverBox.addView(fallback, FrameLayout.LayoutParams(coverSize, coverSize))
        coverBox.addView(img, FrameLayout.LayoutParams(coverSize, coverSize))

        val spacer = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, dp(1), 1f)
        }

        val lyricTv = TextView(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(8)
                marginEnd = dp(8)
            }
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.MARQUEE
            marqueeRepeatLimit = -1
            isSelected = true
            isHorizontalFadingEdgeEnabled = true
            setFadingEdgeLength(dp(12))
            gravity = Gravity.CENTER
            setTextColor(0xF2FFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            visibility = View.GONE
        }

        val wave = IslandWaveformView(context).apply {
            layoutParams = LinearLayout.LayoutParams(dp(20), dp(15))
        }

        pill.addView(coverBox)
        pill.addView(spacer)
        pill.addView(lyricTv)
        pill.addView(wave)

        // Tap to expand; gentle vertical drag nudges offsetYDp to hug any punch-hole cutout
        var downRawY = 0f
        var startOffsetY = offsetYDp
        var dragged = false
        val touchSlopPx = dpF(8f)

        pill.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawY = event.rawY
                    startOffsetY = offsetYDp
                    dragged = false
                    v.animate().scaleX(0.96f).scaleY(0.96f).setDuration(90L).start()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dy = event.rawY - downRawY
                    if (!dragged && abs(dy) > touchSlopPx) {
                        dragged = true
                    }
                    if (dragged) {
                        val nextDp = clampOffsetYDp(startOffsetY + (dy / density).roundToInt())
                        if (nextDp != offsetYDp) {
                            offsetYDp = nextDp
                            updateWindowPositionOnly()
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(140L).start()
                    if (dragged) {
                        prefs.edit().putInt(KEY_OFFSET_Y, offsetYDp).apply()
                        callbacks.onOffsetYChanged(offsetYDp)
                    } else if (event.actionMasked == MotionEvent.ACTION_UP) {
                        setExpanded(true)
                    }
                    true
                }
                else -> false
            }
        }

        compactCoverImg = img
        compactCoverFallback = fallback
        compactSpacer = spacer
        compactLyricView = lyricTv
        compactWave = wave
        return pill
    }

    private fun buildExpandedCard(): LinearLayout {
        val screenWidthPx = context.resources.displayMetrics.widthPixels
        val cardWidthPx = min(dp(328), screenWidthPx - dp(24))

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            elevation = dpF(14f)
            layoutParams = FrameLayout.LayoutParams(cardWidthPx, FrameLayout.LayoutParams.WRAP_CONTENT)
        }

        // Top row: cover + track meta + favorite + collapse
        val topRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
        }

        val coverSize = dp(48)
        val coverRadius = dpF(12f)
        val coverBox = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(coverSize, coverSize)
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, coverRadius)
                }
            }
            clipToOutline = true
            setOnClickListener {
                openNowPlayingActivity()
                setExpanded(false)
            }
        }
        val coverFallback = TextView(context).apply {
            text = "♪"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF4F7CFF.toInt(), 0xFF1A2D70.toInt()),
            )
        }
        val coverImg = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
        }
        coverBox.addView(coverFallback, FrameLayout.LayoutParams(coverSize, coverSize))
        coverBox.addView(coverImg, FrameLayout.LayoutParams(coverSize, coverSize))

        val metaCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(12)
                marginEnd = dp(8)
            }
            setOnClickListener {
                openNowPlayingActivity()
                setExpanded(false)
            }
        }
        val titleTv = TextView(context).apply {
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.END
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }
        val artistTv = TextView(context).apply {
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.END
            setTextColor(0xB8DCE8FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        val expLyricTv = TextView(context).apply {
            setSingleLine(true)
            ellipsize = TextUtils.TruncateAt.END
            setTextColor(0xDDE8F1FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setPadding(0, dp(2), 0, 0)
            visibility = View.GONE
        }
        metaCol.addView(titleTv)
        metaCol.addView(artistTv)
        metaCol.addView(expLyricTv)

        val heartBtn = IslandGlyphButton(context, GlyphType.HEART_OUTLINE, COLOR_HEART_INACTIVE, 0x1AFFFFFF).apply {
            layoutParams = LinearLayout.LayoutParams(dp(34), dp(34)).apply { marginEnd = dp(6) }
            setOnClickListener {
                resetAutoCollapseTimer()
                callbacks.onToggleFavorite()
            }
        }
        val closeBtn = IslandGlyphButton(context, GlyphType.CHEVRON_UP, 0xCCFFFFFF.toInt(), 0x1AFFFFFF).apply {
            layoutParams = LinearLayout.LayoutParams(dp(30), dp(30))
            setOnClickListener { setExpanded(false) }
        }

        topRow.addView(coverBox)
        topRow.addView(metaCol)
        topRow.addView(heartBtn)
        topRow.addView(closeBtn)

        // Progress bar + timestamps
        val progress = IslandProgressView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(4),
            ).apply {
                topMargin = dp(12)
            }
        }
        val timeRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dp(4)
            }
        }
        val posTv = TextView(context).apply {
            text = "0:00"
            setTextColor(0x99FFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val durTv = TextView(context).apply {
            text = "0:00"
            gravity = Gravity.END
            setTextColor(0x99FFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        timeRow.addView(posTv)
        timeRow.addView(durTv)

        // Transport buttons row
        val controlsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dp(8)
            }
        }

        val prevBtn = IslandGlyphButton(context, GlyphType.PREV, Color.WHITE, 0x1CFFFFFF).apply {
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(20) }
            setOnClickListener {
                resetAutoCollapseTimer()
                callbacks.onPrev()
            }
        }
        val playBtn = IslandGlyphButton(context, GlyphType.PAUSE, 0xFF0C1222.toInt(), Color.WHITE).apply {
            layoutParams = LinearLayout.LayoutParams(dp(46), dp(46))
            setOnClickListener {
                resetAutoCollapseTimer()
                callbacks.onTogglePlay()
            }
        }
        val nextBtn = IslandGlyphButton(context, GlyphType.NEXT, Color.WHITE, 0x1CFFFFFF).apply {
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(20) }
            setOnClickListener {
                resetAutoCollapseTimer()
                callbacks.onNext()
            }
        }
        controlsRow.addView(prevBtn)
        controlsRow.addView(playBtn)
        controlsRow.addView(nextBtn)

        card.addView(topRow)
        card.addView(progress)
        card.addView(timeRow)
        card.addView(controlsRow)

        expandedCoverImg = coverImg
        expandedCoverFallback = coverFallback
        expandedTitleView = titleTv
        expandedArtistView = artistTv
        expandedLyricView = expLyricTv
        expandedHeartBtn = heartBtn
        expandedPlayBtn = playBtn
        expandedProgress = progress
        expandedPosText = posTv
        expandedDurText = durTv
        return card
    }

    private fun setExpanded(next: Boolean) {
        if (expanded == next) return
        expanded = next
        mainHandler.removeCallbacks(autoCollapseRunnable)

        val pill = compactPill ?: return
        val card = expandedCard ?: return

        if (expanded) {
            compactWave?.setPlaying(false)
            pill.visibility = View.GONE
            card.visibility = View.VISIBLE
            card.alpha = 0f
            card.scaleX = 0.88f
            card.scaleY = 0.88f
            card.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(220L)
                .setInterpolator(OvershootInterpolator(0.7f))
                .start()
            resetAutoCollapseTimer()
        } else {
            card.visibility = View.GONE
            pill.visibility = View.VISIBLE
            pill.alpha = 0f
            pill.scaleX = 0.92f
            pill.scaleY = 0.92f
            pill.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(180L)
                .setInterpolator(DecelerateInterpolator())
                .start()
            compactWave?.setPlaying(isPlaying || previewActive)
        }
        attachOrUpdateWindow()
        applyStyleAndData()
    }

    private fun resetAutoCollapseTimer() {
        mainHandler.removeCallbacks(autoCollapseRunnable)
        mainHandler.postDelayed(autoCollapseRunnable, AUTO_COLLAPSE_MS)
    }

    private fun applyStyleAndData() {
        val brightAccent = brightenAccentForDarkSurface(accentColor)

        compactPill?.let { pill ->
            val targetW = dp(computeCompactWidthDp(showLyric))
            val targetH = dp(if (showLyric) 34 else 32)
            val lp = pill.layoutParams as? FrameLayout.LayoutParams
            if (lp != null && (lp.width != targetW || lp.height != targetH)) {
                lp.width = targetW
                lp.height = targetH
                pill.layoutParams = lp
            }
            pill.background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dpF(20f)
                setColor(0xF6090D18.toInt())
                setStroke(dp(1), withAlpha(brightAccent, 0x45))
            }
        }

        compactSpacer?.visibility = if (showLyric) View.GONE else View.VISIBLE
        compactLyricView?.visibility = if (showLyric) View.VISIBLE else View.GONE
        compactWave?.setAccentColor(brightAccent)

        val bmp = artworkBitmap
        if (bmp != null && !bmp.isRecycled) {
            compactCoverImg?.setImageBitmap(bmp)
            compactCoverImg?.visibility = View.VISIBLE
            compactCoverFallback?.visibility = View.GONE
            expandedCoverImg?.setImageBitmap(bmp)
            expandedCoverImg?.visibility = View.VISIBLE
            expandedCoverFallback?.visibility = View.GONE
        } else {
            compactCoverImg?.visibility = View.GONE
            compactCoverFallback?.visibility = View.VISIBLE
            expandedCoverImg?.visibility = View.GONE
            expandedCoverFallback?.visibility = View.VISIBLE
        }

        expandedCard?.let { card ->
            val cardBg = blendColors(0xFF0E1322.toInt(), accentColor, 0.22f)
            card.background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dpF(26f)
                setColor(withAlpha(cardBg, 0xF5))
                setStroke(dp(1), withAlpha(brightAccent, 0x55))
            }
        }

        expandedTitleView?.text = trackTitle
        expandedArtistView?.text = trackArtist
        expandedLyricView?.setTextColor(withAlpha(brightAccent, 0xE6))
        expandedProgress?.setAccentColor(brightAccent)
        val frac = if (durationMs > 0L) (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) else 0f
        expandedProgress?.setProgress(frac)
        expandedPosText?.text = formatIslandTime(positionMs)
        expandedDurText?.text = formatIslandTime(durationMs)

        expandedHeartBtn?.setTint(if (isFavorite) COLOR_HEART_ACTIVE else COLOR_HEART_INACTIVE)
        expandedHeartBtn?.setGlyph(if (isFavorite) GlyphType.HEART_FILLED else GlyphType.HEART_OUTLINE)
        expandedPlayBtn?.setGlyph(if (isPlaying) GlyphType.PAUSE else GlyphType.PLAY)

        updateLyricTexts()
    }

    private fun updateLyricTexts() {
        val compactText = if (liveLyric.isNotBlank()) liveLyric else "$trackTitle · $trackArtist"
        compactLyricView?.let { tv ->
            if (tv.text?.toString() != compactText) {
                tv.text = compactText
                tv.isSelected = true
            }
        }
        expandedLyricView?.let { tv ->
            if (liveLyric.isNotBlank()) {
                tv.text = liveLyric
                tv.visibility = View.VISIBLE
            } else {
                tv.visibility = View.GONE
            }
        }
    }

    private fun buildWindowParams(): WindowManager.LayoutParams {
        val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (expanded) {
            flags = flags or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
        }
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            windowType,
            flags,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(offsetYDp)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }

    private fun attachOrUpdateWindow() {
        val root = rootFrame ?: return
        val params = buildWindowParams()
        layoutParams = params
        try {
            if (!isAttached) {
                windowManager.addView(root, params)
                isAttached = true
            } else {
                windowManager.updateViewLayout(root, params)
            }
        } catch (_: Exception) {
            // Permission revoked or window token invalid — degrade silently
            isAttached = false
        }
    }

    private fun updateWindowPositionOnly() {
        val root = rootFrame ?: return
        val params = layoutParams ?: return
        if (!isAttached) return
        params.y = dp(offsetYDp)
        try {
            windowManager.updateViewLayout(root, params)
        } catch (_: Exception) {
        }
    }

    private fun detachWindow() {
        val root = rootFrame ?: return
        if (!isAttached) return
        try {
            windowManager.removeViewImmediate(root)
        } catch (_: Exception) {
            try {
                windowManager.removeView(root)
            } catch (_: Exception) {
            }
        } finally {
            isAttached = false
        }
    }

    private fun openNowPlayingActivity() {
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("openNowPlaying", true)
            }
            context.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private enum class GlyphType { PREV, PLAY, PAUSE, NEXT, HEART_FILLED, HEART_OUTLINE, CHEVRON_UP }

    private inner class IslandWaveformView(ctx: Context) : View(ctx) {
        private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = DEFAULT_BRIGHT_ACCENT
            style = Paint.Style.FILL
        }
        private var phase = 0f
        private val rect = RectF()
        private var animator: ValueAnimator? = null

        fun setAccentColor(color: Int) {
            barPaint.color = color
            invalidate()
        }

        fun setPlaying(active: Boolean) {
            if (active) {
                if (animator?.isRunning == true) return
                animator = ValueAnimator.ofFloat(0f, (Math.PI * 2.0).toFloat()).apply {
                    duration = 1100L
                    repeatCount = ValueAnimator.INFINITE
                    interpolator = LinearInterpolator()
                    addUpdateListener {
                        phase = it.animatedValue as Float
                        invalidate()
                    }
                    start()
                }
            } else {
                animator?.cancel()
                animator = null
                phase = 0f
                invalidate()
            }
        }

        override fun onDetachedFromWindow() {
            animator?.cancel()
            animator = null
            super.onDetachedFromWindow()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w <= 0f || h <= 0f) return
            val barW = dpF(2.6f)
            val gap = dpF(2.8f)
            val totalW = barW * 3f + gap * 2f
            val startX = (w - totalW) / 2f
            val offsets = floatArrayOf(0f, 2.05f, 4.1f)
            for (i in 0..2) {
                val wave = if (animator?.isRunning == true) {
                    (sin((phase + offsets[i]).toDouble()).toFloat() * 0.5f + 0.5f)
                } else {
                    if (i == 1) 0.55f else 0.30f
                }
                val barH = (h * (0.28f + 0.68f * wave)).coerceIn(dpF(3f), h)
                val x = startX + i * (barW + gap)
                val top = (h - barH) / 2f
                rect.set(x, top, x + barW, top + barH)
                canvas.drawRoundRect(rect, barW / 2f, barW / 2f, barPaint)
            }
        }
    }

    private inner class IslandProgressView(ctx: Context) : View(ctx) {
        private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0x29FFFFFF
            style = Paint.Style.FILL
        }
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = DEFAULT_BRIGHT_ACCENT
            style = Paint.Style.FILL
        }
        private val rect = RectF()
        private var progress = 0f

        fun setAccentColor(color: Int) {
            fillPaint.color = color
            invalidate()
        }

        fun setProgress(value: Float) {
            progress = value.coerceIn(0f, 1f)
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w <= 0f || h <= 0f) return
            val r = h / 2f
            rect.set(0f, 0f, w, h)
            canvas.drawRoundRect(rect, r, r, trackPaint)
            if (progress > 0.005f) {
                rect.set(0f, 0f, (w * progress).coerceAtLeast(h), h)
                canvas.drawRoundRect(rect, r, r, fillPaint)
            }
        }
    }

    private inner class IslandGlyphButton(
        ctx: Context,
        private var glyph: GlyphType,
        tintColor: Int,
        bgColor: Int,
    ) : View(ctx) {
        private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = bgColor
            style = Paint.Style.FILL
        }
        private val fgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = tintColor
            style = Paint.Style.FILL
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val path = Path()
        private val rect = RectF()

        init {
            isClickable = true
        }

        fun setGlyph(next: GlyphType) {
            if (glyph != next) {
                glyph = next
                invalidate()
            }
        }

        fun setTint(color: Int) {
            if (fgPaint.color != color) {
                fgPaint.color = color
                invalidate()
            }
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> animate().scaleX(0.90f).scaleY(0.90f).setDuration(70L).start()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> animate().scaleX(1f).scaleY(1f).setDuration(120L).start()
            }
            return super.onTouchEvent(event)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val r = min(width, height) / 2f
            canvas.drawCircle(cx, cy, r, bgPaint)

            val s = r * 0.44f
            path.reset()
            when (glyph) {
                GlyphType.PLAY -> {
                    fgPaint.style = Paint.Style.FILL
                    val ox = s * 0.14f
                    path.moveTo(cx - s * 0.65f + ox, cy - s * 0.85f)
                    path.lineTo(cx + s * 0.95f + ox, cy)
                    path.lineTo(cx - s * 0.65f + ox, cy + s * 0.85f)
                    path.close()
                    canvas.drawPath(path, fgPaint)
                }
                GlyphType.PAUSE -> {
                    fgPaint.style = Paint.Style.FILL
                    val bw = s * 0.44f
                    val gap = s * 0.34f
                    val bh = s * 1.5f
                    rect.set(cx - gap / 2f - bw, cy - bh / 2f, cx - gap / 2f, cy + bh / 2f)
                    canvas.drawRoundRect(rect, bw / 2.4f, bw / 2.4f, fgPaint)
                    rect.set(cx + gap / 2f, cy - bh / 2f, cx + gap / 2f + bw, cy + bh / 2f)
                    canvas.drawRoundRect(rect, bw / 2.4f, bw / 2.4f, fgPaint)
                }
                GlyphType.PREV -> {
                    fgPaint.style = Paint.Style.FILL
                    val barW = s * 0.28f
                    rect.set(cx - s * 0.9f, cy - s * 0.72f, cx - s * 0.9f + barW, cy + s * 0.72f)
                    canvas.drawRoundRect(rect, barW / 2f, barW / 2f, fgPaint)
                    path.moveTo(cx + s * 0.85f, cy - s * 0.74f)
                    path.lineTo(cx - s * 0.45f, cy)
                    path.lineTo(cx + s * 0.85f, cy + s * 0.74f)
                    path.close()
                    canvas.drawPath(path, fgPaint)
                }
                GlyphType.NEXT -> {
                    fgPaint.style = Paint.Style.FILL
                    val barW = s * 0.28f
                    rect.set(cx + s * 0.9f - barW, cy - s * 0.72f, cx + s * 0.9f, cy + s * 0.72f)
                    canvas.drawRoundRect(rect, barW / 2f, barW / 2f, fgPaint)
                    path.moveTo(cx - s * 0.85f, cy - s * 0.74f)
                    path.lineTo(cx + s * 0.45f, cy)
                    path.lineTo(cx - s * 0.85f, cy + s * 0.74f)
                    path.close()
                    canvas.drawPath(path, fgPaint)
                }
                GlyphType.HEART_FILLED, GlyphType.HEART_OUTLINE -> {
                    fgPaint.style = if (glyph == GlyphType.HEART_FILLED) Paint.Style.FILL else Paint.Style.STROKE
                    fgPaint.strokeWidth = dpF(1.7f)
                    val hs = s * 0.92f
                    path.moveTo(cx, cy + hs * 0.82f)
                    path.cubicTo(cx - hs * 1.35f, cy + hs * 0.05f, cx - hs * 1.05f, cy - hs * 0.95f, cx, cy - hs * 0.28f)
                    path.cubicTo(cx + hs * 1.05f, cy - hs * 0.95f, cx + hs * 1.35f, cy + hs * 0.05f, cx, cy + hs * 0.82f)
                    path.close()
                    canvas.drawPath(path, fgPaint)
                }
                GlyphType.CHEVRON_UP -> {
                    fgPaint.style = Paint.Style.STROKE
                    fgPaint.strokeWidth = dpF(1.9f)
                    path.moveTo(cx - s * 0.72f, cy + s * 0.28f)
                    path.lineTo(cx, cy - s * 0.36f)
                    path.lineTo(cx + s * 0.72f, cy + s * 0.28f)
                    canvas.drawPath(path, fgPaint)
                }
            }
        }
    }

    companion object {
        private const val PREFS_NAME = "melune_island_prefs"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_SHOW_LYRIC = "show_lyric"
        private const val KEY_OFFSET_Y = "offset_y_dp"
        private const val DEFAULT_OFFSET_Y_DP = 4
        private const val AUTO_COLLAPSE_MS = 6000L
        private const val DEFAULT_ACCENT = 0xFF3456BE.toInt()
        private const val DEFAULT_BRIGHT_ACCENT = 0xFF7FA6FF.toInt()
        private const val COLOR_HEART_ACTIVE = 0xFFFF4D6D.toInt()
        private const val COLOR_HEART_INACTIVE = 0xCCFFFFFF.toInt()

        fun shouldShowIsland(
            enabled: Boolean,
            hasOverlayPermission: Boolean,
            appInForeground: Boolean,
            isPlaying: Boolean,
            previewActive: Boolean,
        ): Boolean {
            if (!enabled || !hasOverlayPermission) return false
            if (previewActive) return true
            return !appInForeground && isPlaying
        }

        fun clampOffsetYDp(offsetYDp: Int): Int = offsetYDp.coerceIn(-8, 28)

        fun computeCompactWidthDp(showLyric: Boolean): Int = if (showLyric) 226 else 140

        fun formatIslandTime(ms: Long): String {
            val totalSec = (ms.coerceAtLeast(0L) / 1000L).toInt()
            val mins = totalSec / 60
            val secs = totalSec % 60
            return "$mins:${secs.toString().padStart(2, '0')}"
        }

        fun brightenAccentForDarkSurface(color: Int): Int {
            val r = (color shr 16) and 0xFF
            val g = (color shr 8) and 0xFF
            val b = color and 0xFF
            val br = (r + (255 - r) * 0.42f).roundToInt().coerceIn(85, 245)
            val bg = (g + (255 - g) * 0.42f).roundToInt().coerceIn(85, 245)
            val bb = (b + (255 - b) * 0.42f).roundToInt().coerceIn(110, 255)
            return (0xFF shl 24) or (br shl 16) or (bg shl 8) or bb
        }

        private fun blendColors(base: Int, overlay: Int, ratio: Float): Int {
            val inv = 1f - ratio
            val r = (((base shr 16) and 0xFF) * inv + ((overlay shr 16) and 0xFF) * ratio).roundToInt().coerceIn(0, 255)
            val g = (((base shr 8) and 0xFF) * inv + ((overlay shr 8) and 0xFF) * ratio).roundToInt().coerceIn(0, 255)
            val b = ((base and 0xFF) * inv + (overlay and 0xFF) * ratio).roundToInt().coerceIn(0, 255)
            return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }

        private fun withAlpha(color: Int, alpha: Int): Int {
            return ((alpha and 0xFF) shl 24) or (color and 0x00FFFFFF)
        }
    }
}
