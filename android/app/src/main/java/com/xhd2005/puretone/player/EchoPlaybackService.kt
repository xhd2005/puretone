package com.xhd2005.puretone.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.util.TreeSet
import java.util.concurrent.ConcurrentHashMap
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import okhttp3.ConnectionPool
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.xhd2005.puretone.MainActivity
import com.xhd2005.puretone.R
import com.xhd2005.puretone.widget.PureToneWidgetProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class TrackMetadataPayload(
    val title: String,
    val artist: String,
    val album: String,
    val coverUrl: String?,
    val durationMs: Long,
)

data class QueuedTrackEntry(
    val mediaId: String,
    val queueIndex: Int,
    val url: String,
    val headers: Map<String, String>,
    val metadata: TrackMetadataPayload,
    val cacheKey: String?,
)

interface PlayerBridgeListener {
    fun onTimeUpdate(currentTimeMs: Long, durationMs: Long, isPlaying: Boolean, trackSeq: Int)
    fun onStateChange(isPlaying: Boolean, isBuffering: Boolean, ended: Boolean, trackSeq: Int)
    fun onError(code: String, message: String, trackSeq: Int)
    fun onMediaCommand(command: String, positionMs: Long?)
    fun onNativeTrackAdvanced(queueIndex: Int, trackSeq: Int)
    fun onPlaybackRecoveryNeeded(
        reason: String,
        positionMs: Long,
        errorCode: String,
        message: String,
        trackSeq: Int,
    )
}

@OptIn(UnstableApi::class)
private class PureToneMediaNotificationProvider(
    private val context: Context,
    private val accentColorProvider: () -> Int,
    private val titleProvider: () -> String,
) : MediaNotification.Provider {

    private val delegate = DefaultMediaNotificationProvider.Builder(context)
        .setChannelId(EchoPlaybackService.MEDIA_CHANNEL_ID)
        .setChannelName(R.string.app_name)
        .build()
        .apply {
            setSmallIcon(R.drawable.ic_stat_puretone)
        }

    private fun canPostPromotedOngoing(): Boolean {
        if (Build.VERSION.SDK_INT < 36) return false
        return try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
            val method = nm.javaClass.getMethod("canPostPromotedNotifications")
            (method.invoke(nm) as? Boolean) == true
        } catch (_: Exception) {
            false
        }
    }

    override fun createNotification(
        mediaSession: MediaSession,
        customLayout: ImmutableList<CommandButton>,
        actionFactory: MediaNotification.ActionFactory,
        onNotificationChangedCallback: MediaNotification.Provider.Callback,
    ): MediaNotification {
        val mediaNotification = delegate.createNotification(
            mediaSession,
            customLayout,
            actionFactory,
            onNotificationChangedCallback,
        )
        val n = mediaNotification.notification
        n.color = accentColorProvider()
        n.visibility = Notification.VISIBILITY_PUBLIC
        n.category = Notification.CATEGORY_TRANSPORT

        // Android 16/17 (API 36+) Live Updates reject notifications when EXTRA_COLORIZED=true
        // is combined with requestPromotedOngoing=true. Apply strictly mutually-exclusive flags.
        if (EchoPlaybackService.shouldUsePromotedLiveUpdate(Build.VERSION.SDK_INT, canPostPromotedOngoing())) {
            n.flags = n.flags or Notification.FLAG_ONGOING_EVENT
            n.extras.putBoolean(Notification.EXTRA_COLORIZED, false)
            n.extras.putBoolean("android.requestPromotedOngoing", true)
            val shortTitle = EchoPlaybackService.formatShortCriticalTitle(titleProvider())
            if (shortTitle.isNotEmpty()) {
                n.extras.putCharSequence("android.shortCriticalText", shortTitle)
            }
        } else {
            n.extras.putBoolean(Notification.EXTRA_COLORIZED, true)
            n.extras.remove("android.requestPromotedOngoing")
        }
        return mediaNotification
    }

    override fun handleCustomCommand(session: MediaSession, action: String, extras: Bundle): Boolean {
        return delegate.handleCustomCommand(session, action, extras)
    }
}

private class PureToneAudioEffects {
    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var boundSessionId: Int = C.AUDIO_SESSION_ID_UNSET
    private var currentPreset: String = "flat"
    private var volumeLevelingEnabled: Boolean = false

    fun attachToSession(audioSessionId: Int) {
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId == 0) return
        if (boundSessionId == audioSessionId && equalizer != null) {
            applyPreset(currentPreset)
            applyVolumeLeveling(volumeLevelingEnabled)
            return
        }
        release()
        boundSessionId = audioSessionId
        try {
            equalizer = Equalizer(0, audioSessionId)
        } catch (_: Exception) {
            equalizer = null
        }
        try {
            bassBoost = BassBoost(0, audioSessionId)
        } catch (_: Exception) {
            bassBoost = null
        }
        try {
            loudnessEnhancer = LoudnessEnhancer(audioSessionId)
        } catch (_: Exception) {
            loudnessEnhancer = null
        }
        applyPreset(currentPreset)
        applyVolumeLeveling(volumeLevelingEnabled)
    }

    fun applyVolumeLeveling(enabled: Boolean) {
        volumeLevelingEnabled = enabled
        val le = loudnessEnhancer ?: return
        try {
            // Gentle 2.6 dB ceiling keeps older quiet tracks balanced with modern masters without clipping
            le.setTargetGain(if (enabled) 260 else 0)
            le.enabled = enabled
        } catch (_: Exception) {
            // OEM DSP restriction — keep playback unaffected
        }
    }

    fun applyPreset(preset: String) {
        currentPreset = preset
        val eq = equalizer
        val bass = bassBoost
        try {
            if (preset == "flat") {
                if (eq != null) {
                    val bandCount = eq.numberOfBands.toInt().coerceAtLeast(1)
                    for (i in 0 until bandCount) {
                        eq.setBandLevel(i.toShort(), 0)
                    }
                    eq.enabled = false
                }
                if (bass != null && bass.strengthSupported) {
                    bass.setStrength(0)
                    bass.enabled = false
                }
                return
            }
            if (eq != null) {
                val bandCount = eq.numberOfBands.toInt().coerceAtLeast(1)
                val range = eq.bandLevelRange
                val minLv = range[0].toInt()
                val maxLv = min(0, range[1].toInt())
                val centerFreqsHz = IntArray(bandCount) { idx ->
                    (eq.getCenterFreq(idx.toShort()) / 1000).coerceAtLeast(30)
                }
                val gainsMb = EchoPlaybackService.computeEqBandGains(preset, centerFreqsHz)
                for (i in 0 until bandCount) {
                    val target = gainsMb[i].coerceIn(minLv, maxLv).toShort()
                    eq.setBandLevel(i.toShort(), target)
                }
                eq.enabled = true
            }
            if (bass != null && bass.strengthSupported) {
                // Conservative BassBoost ceiling avoids sub-bass clipping on earbuds
                val strength: Short = when (preset) {
                    "bass" -> 200
                    "live" -> 110
                    else -> 0
                }
                bass.setStrength(strength)
                bass.enabled = strength > 0
            }
        } catch (_: Exception) {
            // Device OEM may restrict audio effects; keep playback unaffected
        }
    }

    fun release() {
        try {
            equalizer?.release()
        } catch (_: Exception) {
        }
        try {
            bassBoost?.release()
        } catch (_: Exception) {
        }
        try {
            loudnessEnhancer?.release()
        } catch (_: Exception) {
        }
        equalizer = null
        bassBoost = null
        loudnessEnhancer = null
        boundSessionId = C.AUDIO_SESSION_ID_UNSET
    }
}

@OptIn(UnstableApi::class)
private class DynamicLruCacheEvictor(initialMaxBytes: Long) : CacheEvictor {
    private val leastRecentlyUsed = TreeSet<CacheSpan> { lhs, rhs ->
        val d = lhs.lastTouchTimestamp - rhs.lastTouchTimestamp
        if (d == 0L) lhs.compareTo(rhs) else if (d < 0L) -1 else 1
    }

    @Volatile
    private var maxBytes: Long = initialMaxBytes.coerceAtLeast(0L)
    private var currentSize: Long = 0L

    override fun requiresCacheSpanTouches(): Boolean = true

    override fun onCacheInitialized() = Unit

    @Synchronized
    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
        if (length != C.LENGTH_UNSET.toLong()) {
            evictCache(cache, length)
        }
    }

    @Synchronized
    override fun onSpanAdded(cache: Cache, span: CacheSpan) {
        leastRecentlyUsed.add(span)
        currentSize += span.length
        evictCache(cache, 0L)
    }

    @Synchronized
    override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
        leastRecentlyUsed.remove(span)
        currentSize = (currentSize - span.length).coerceAtLeast(0L)
    }

    @Synchronized
    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
        onSpanRemoved(cache, oldSpan)
        onSpanAdded(cache, newSpan)
    }

    @Synchronized
    fun setMaxBytes(newMaxBytes: Long, cache: Cache?) {
        maxBytes = newMaxBytes.coerceAtLeast(0L)
        if (cache != null) {
            evictCache(cache, 0L)
        }
    }

    private fun evictCache(cache: Cache, requiredSpace: Long) {
        val limit = maxBytes
        // limit == 0L represents Unlimited cache mode
        if (limit <= 0L) return
        while (currentSize + requiredSpace > limit && leastRecentlyUsed.isNotEmpty()) {
            val oldest = leastRecentlyUsed.first()
            try {
                cache.removeSpan(oldest)
            } catch (_: Exception) {
                leastRecentlyUsed.remove(oldest)
                currentSize = (currentSize - oldest.length).coerceAtLeast(0L)
            }
        }
    }
}

@OptIn(UnstableApi::class)
private class PerItemHeaderDataSource(
    private val delegate: DataSource,
    private val headerLookup: (cacheKey: String?, uri: String?) -> Map<String, String>,
) : DataSource {
    override fun addTransferListener(transferListener: TransferListener) {
        delegate.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val merged = EchoPlaybackService.resolveRequestHeaders(
            existingHeaders = dataSpec.httpRequestHeaders,
            itemHeaders = headerLookup(dataSpec.key, dataSpec.uri.toString()),
        )
        val updated = dataSpec.buildUpon()
            .setHttpRequestHeaders(merged)
            .build()
        return delegate.open(updated)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        return delegate.read(buffer, offset, length)
    }

    override fun getUri(): Uri? = delegate.uri

    override fun getResponseHeaders(): Map<String, List<String>> = delegate.responseHeaders

    override fun close() = delegate.close()
}

@OptIn(UnstableApi::class)
private class ResilientAudioLoadErrorPolicy : DefaultLoadErrorHandlingPolicy(5) {
    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val ex = loadErrorInfo.exception
        if (ex is HttpDataSource.InvalidResponseCodeException) {
            // Do not waste seconds retrying expired/forbidden CDN URLs (403/404/410) —
            // fail fast so onPlayerError triggers immediate fresh-URL recovery at exact timestamp.
            if (ex.responseCode in setOf(401, 403, 404, 410, 416, 451)) {
                return C.TIME_UNSET
            }
        }
        if (loadErrorInfo.errorCount > 5) return C.TIME_UNSET
        return (loadErrorInfo.errorCount * 600L).coerceAtMost(3000L)
    }
}

@OptIn(UnstableApi::class)
class EchoPlaybackService : MediaSessionService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(4, 30, TimeUnit.SECONDS))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    // Thread-safe per-track HTTP header registry (keyed by "ck:<cacheKey>" and "uri:<url>") so
    // pre-buffering Track B (e.g. Bilibili Referer) NEVER collides with playing Track A (e.g. KuGou).
    private val itemHeadersByKey = ConcurrentHashMap<String, Map<String, String>>()
    private lateinit var exoPlayer: ExoPlayer
    private var mediaSession: MediaSession? = null
    private val audioEffects = PureToneAudioEffects()
    private var transitionWakeLock: PowerManager.WakeLock? = null

    private fun effectiveIsPlaying(): Boolean {
        if (!::exoPlayer.isInitialized) return false
        return computeEffectiveIsPlaying(
            isPlaying = exoPlayer.isPlaying,
            playWhenReady = exoPlayer.playWhenReady,
            playbackState = exoPlayer.playbackState,
            playbackSuppressionReason = exoPlayer.playbackSuppressionReason,
        )
    }

    private fun isCurrentlyActive(): Boolean {
        return try {
            ::exoPlayer.isInitialized && (exoPlayer.playWhenReady || exoPlayer.isPlaying)
        } catch (_: Exception) {
            false
        }
    }

    private var currentTrackSeq: Int = 0
    private var currentMetadata: TrackMetadataPayload? = null
    private var currentArtworkBytes: ByteArray? = null
    private var currentArtworkBitmap: Bitmap? = null
    private var currentAccentColor: Int = DEFAULT_NOTIFICATION_ACCENT
    private var currentLiveLyric: String = ""
    private var lastLiveLyricUpdatedAt: Long = 0L
    private var isCurrentFavorite: Boolean = false
    private var currentPlayMode: String = "sequence"
    private var targetVolume: Float = 1.0f
    private var transitionFadeMs: Long = 1500L
    private var autoFadeActiveForSeq: Int = -1
    private var fadeRunnable: Runnable? = null
    private var retryRunnable: Runnable? = null
    private var recoveryFallbackRunnable: Runnable? = null
    private var retriedCurrentError: Boolean = false
    private var isolatedUpcomingForSeq: Int = -1
    private var recoveredPrematureEofForSeq: Int = -1
    private var checkedShortTrialForSeq: Int = -1
    private var isCurrentLoadRecovery: Boolean = false
    private var lastPlayingPositionMs: Long = 0L
    private var lastKnownStreamDurationMs: Long = 0L
    private var originalCatalogDurationMs: Long = 0L
    private var isExplicitLoading: Boolean = false

    // Mirrors ExoPlayer's native playlist items (index 0..N-1) so screen-off transitions
    // update lock screen metadata, HD cover, and audio stream 100% natively without WebView JS.
    private val queuedTracks = mutableListOf<QueuedTrackEntry>()

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                mainHandler.post {
                    cancelFade()
                    if (::exoPlayer.isInitialized && exoPlayer.isPlaying) {
                        exoPlayer.pause()
                        exoPlayer.volume = targetVolume
                        bridgeListener?.onStateChange(false, false, false, currentTrackSeq)
                        bridgeListener?.onMediaCommand("pause", null)
                        syncWidgetState()
                    }
                }
            }
        }
    }

    private val timeTicker = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized && exoPlayer.isPlaying) {
                val pos = exoPlayer.currentPosition.coerceAtLeast(0L)
                val exoDur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
                val dur = exoDur.takeIf { it > 0L } ?: (currentMetadata?.durationMs ?: 0L)
                lastPlayingPositionMs = pos
                if (exoDur > 0L) {
                    lastKnownStreamDurationMs = exoDur
                }
                // Smooth single-engine track transition fade-out near track tail when next track is queued
                val fadeWin = transitionFadeMs
                if (fadeWin > 0L &&
                    fadeRunnable == null &&
                    exoPlayer.repeatMode != Player.REPEAT_MODE_ONE &&
                    exoPlayer.hasNextMediaItem() &&
                    dur > fadeWin + 4000L
                ) {
                    val remaining = dur - pos
                    if (remaining in 40L..fadeWin) {
                        val factor = computeTrackFadeFactor(remaining, fadeWin)
                        exoPlayer.volume = (targetVolume * factor).coerceIn(0f, 1f)
                        autoFadeActiveForSeq = currentTrackSeq
                    } else if (autoFadeActiveForSeq == currentTrackSeq && remaining > fadeWin + 400L) {
                        // User scrubbed back before fade window — restore volume smoothly
                        autoFadeActiveForSeq = -1
                        exoPlayer.volume = targetVolume
                    }
                }
                bridgeListener?.onTimeUpdate(pos, dur, true, currentTrackSeq)
            }
            mainHandler.postDelayed(this, 160L)
        }
    }

    private val sessionCallback = object : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val base = super.onConnect(session, controller)
            val cmds = base.availableSessionCommands.buildUpon()
                .add(CMD_TOGGLE_FAVORITE)
                .add(CMD_CYCLE_PLAY_MODE)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(cmds)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                ACTION_TOGGLE_FAVORITE -> {
                    isCurrentFavorite = !isCurrentFavorite
                    refreshCustomNotificationButtons()
                    bridgeListener?.onMediaCommand("toggleFavorite", null)
                }
                ACTION_CYCLE_PLAY_MODE -> {
                    bridgeListener?.onMediaCommand("cyclePlayMode", null)
                }
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    override fun onCreate() {
        super.onCreate()
        activeService = this

        ensureMediaNotificationChannel()
        setMediaNotificationProvider(
            PureToneMediaNotificationProvider(
                context = this,
                accentColorProvider = { currentAccentColor },
                titleProvider = { currentMetadata?.title ?: getString(R.string.app_name) },
            ),
        )

        val rawUpstreamFactory = OkHttpDataSource.Factory(okHttpClient)
        val perItemUpstreamFactory = DataSource.Factory {
            PerItemHeaderDataSource(rawUpstreamFactory.createDataSource(), ::lookupItemHeaders)
        }

        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(getOrCreateAudioCache(applicationContext))
            .setUpstreamDataSourceFactory(perItemUpstreamFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        val extractorsFactory = DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                20_000, // minBufferMs: rock-solid mobile buffering
                30_000, // maxBufferMs: keeps next-track pre-buffering fresher than 50s default
                1_500,  // bufferForPlaybackMs
                3_000,  // bufferForPlaybackAfterRebufferMs
            )
            .setBackBuffer(5_000, true)
            .build()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val mediaSourceFactory = DefaultMediaSourceFactory(cacheDataSourceFactory, extractorsFactory)
            .setLoadErrorHandlingPolicy(ResilientAudioLoadErrorPolicy())

        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        audioEffects.attachToSession(exoPlayer.audioSessionId)

        exoPlayer.addListener(object : Player.Listener {
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                audioEffects.attachToSession(audioSessionId)
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (isExplicitLoading || mediaItem == null) return
                val idx = exoPlayer.currentMediaItemIndex
                val matched = queuedTracks.firstOrNull { it.mediaId == mediaItem.mediaId }
                    ?: queuedTracks.getOrNull(idx)
                    ?: return

                // Guard against truncated stream / truncated cache / sneaky 60s trial hitting EOF early
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
                    shouldTriggerPrematureEndRecovery(
                        lastPositionMs = lastPlayingPositionMs,
                        knownStreamDurationMs = lastKnownStreamDurationMs,
                        catalogDurationMs = originalCatalogDurationMs,
                        alreadyRecovered = recoveredPrematureEofForSeq == currentTrackSeq,
                    )
                ) {
                    val prevEntry = queuedTracks.firstOrNull()
                    val resumePos = lastPlayingPositionMs.coerceAtLeast(0L)
                    val expectedSeq = currentTrackSeq
                    recoveredPrematureEofForSeq = expectedSeq
                    removeAudioCacheKey(applicationContext, prevEntry?.cacheKey)
                    cancelFade()
                    cancelRetry()
                    cancelRecoveryFallback()
                    exoPlayer.pause()
                    acquireBriefTransitionWakeLock()
                    bridgeListener?.onPlaybackRecoveryNeeded(
                        reason = "premature_eof",
                        positionMs = resumePos,
                        errorCode = "PREMATURE_EOF",
                        message = "音频流提前中断，正在原地续播",
                        trackSeq = expectedSeq,
                    )
                    // Deep-sleep safety net: NEVER auto-skip mid-song! Try 1 native reload on Track A (index 0)
                    // after purging bad cache; if still unrecoverable, pause cleanly on current track.
                    val fallback = Runnable {
                        if (expectedSeq != currentTrackSeq || !::exoPlayer.isInitialized) return@Runnable
                        if (!retriedCurrentError && exoPlayer.mediaItemCount > 0) {
                            retriedCurrentError = true
                            isExplicitLoading = true
                            try {
                                exoPlayer.seekTo(0, resumePos)
                                exoPlayer.prepare()
                                exoPlayer.play()
                            } catch (_: Exception) {
                            } finally {
                                isExplicitLoading = false
                            }
                            return@Runnable
                        }
                        exoPlayer.pause()
                        bridgeListener?.onError("PREMATURE_EOF", "音频流提前中断，已暂停在当前进度", expectedSeq)
                        syncWidgetState()
                    }
                    recoveryFallbackRunnable = fallback
                    mainHandler.postDelayed(fallback, RECOVERY_FALLBACK_TIMEOUT_MS)
                    return
                }

                commitNativeTransition(matched, idx)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                val buffering = exoPlayer.playbackState == Player.STATE_BUFFERING
                bridgeListener?.onStateChange(effectiveIsPlaying(), buffering, false, currentTrackSeq)
                syncWidgetState()
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                val state = exoPlayer.playbackState
                val buffering = state == Player.STATE_BUFFERING
                val effectivePlaying = computeEffectiveIsPlaying(
                    isPlaying = exoPlayer.isPlaying,
                    playWhenReady = playWhenReady,
                    playbackState = state,
                    playbackSuppressionReason = exoPlayer.playbackSuppressionReason,
                )
                bridgeListener?.onStateChange(effectivePlaying, buffering, false, currentTrackSeq)
                syncWidgetState()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val buffering = playbackState == Player.STATE_BUFFERING
                val ended = playbackState == Player.STATE_ENDED
                if (ended) {
                    if (shouldTriggerPrematureEndRecovery(
                            lastPositionMs = lastPlayingPositionMs,
                            knownStreamDurationMs = lastKnownStreamDurationMs,
                            catalogDurationMs = originalCatalogDurationMs,
                            alreadyRecovered = recoveredPrematureEofForSeq == currentTrackSeq,
                        )
                    ) {
                        val curIdx = exoPlayer.currentMediaItemIndex.coerceAtLeast(0)
                        val activeEntry = queuedTracks.getOrNull(curIdx) ?: queuedTracks.firstOrNull()
                        val resumePos = lastPlayingPositionMs.coerceAtLeast(0L)
                        val expectedSeq = currentTrackSeq
                        recoveredPrematureEofForSeq = expectedSeq
                        removeAudioCacheKey(applicationContext, activeEntry?.cacheKey)
                        cancelRecoveryFallback()
                        acquireBriefTransitionWakeLock()
                        bridgeListener?.onPlaybackRecoveryNeeded(
                            reason = "premature_eof",
                            positionMs = resumePos,
                            errorCode = "PREMATURE_EOF",
                            message = "音频流提前中断，正在原地续播",
                            trackSeq = expectedSeq,
                        )
                        val fallback = Runnable {
                            if (expectedSeq != currentTrackSeq || !::exoPlayer.isInitialized) return@Runnable
                            bridgeListener?.onError("PREMATURE_EOF", "音频流提前中断，已暂停在当前进度", expectedSeq)
                            syncWidgetState()
                        }
                        recoveryFallbackRunnable = fallback
                        mainHandler.postDelayed(fallback, RECOVERY_FALLBACK_TIMEOUT_MS)
                        return
                    }
                    acquireBriefTransitionWakeLock()
                    bridgeListener?.onStateChange(false, false, true, currentTrackSeq)
                    syncWidgetState()
                } else {
                    bridgeListener?.onStateChange(effectiveIsPlaying(), buffering, false, currentTrackSeq)
                    if (playbackState == Player.STATE_READY) {
                        retriedCurrentError = false
                        val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
                        val pos = exoPlayer.currentPosition.coerceAtLeast(0L)
                        lastPlayingPositionMs = pos
                        if (dur > 0L) {
                            lastKnownStreamDurationMs = dur
                        }

                        // Detect 30s/60s VIP trial snippets IMMEDIATELY at header load (before chorus cut-off!)
                        val expectedSeq = currentTrackSeq
                        if (isUnexpectedShortStream(
                                actualStreamDurationMs = dur,
                                catalogDurationMs = originalCatalogDurationMs,
                                alreadyCheckedOrRecovery = isCurrentLoadRecovery || checkedShortTrialForSeq == expectedSeq,
                            )
                        ) {
                            checkedShortTrialForSeq = expectedSeq
                            val curIdx = exoPlayer.currentMediaItemIndex.coerceAtLeast(0)
                            val activeEntry = queuedTracks.getOrNull(curIdx) ?: queuedTracks.firstOrNull()
                            removeAudioCacheKey(applicationContext, activeEntry?.cacheKey)
                            cancelFade()
                            cancelRecoveryFallback()
                            exoPlayer.pause()
                            bridgeListener?.onPlaybackRecoveryNeeded(
                                reason = "short_trial_stream",
                                positionMs = pos,
                                errorCode = "TRIAL_SNIPPET",
                                message = "检测到试听片段，自动切换完整音源",
                                trackSeq = expectedSeq,
                            )
                            return
                        }

                        // Ensure lock-screen seekbar duration stays exact once ExoPlayer resolves stream duration
                        val meta = currentMetadata
                        if (dur > 0L && meta != null && abs(dur - meta.durationMs) > 2000L) {
                            currentMetadata = meta.copy(durationMs = dur)
                            applyMetadataToActiveItem(currentMetadata!!, currentArtworkBytes)
                        }
                        bridgeListener?.onTimeUpdate(
                            pos,
                            dur,
                            effectiveIsPlaying(),
                            currentTrackSeq,
                        )
                    }
                    syncWidgetState()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val curIdx = exoPlayer.currentMediaItemIndex.coerceAtLeast(0)
                val activeEntry = queuedTracks.getOrNull(curIdx) ?: queuedTracks.firstOrNull()
                val savedPosMs = exoPlayer.currentPosition.takeIf { it > 0L } ?: lastPlayingPositionMs.coerceAtLeast(0L)
                val hasUpcoming = exoPlayer.mediaItemCount > curIdx + 1
                val failingSpec = extractFailingDataSpec(error)
                val expectedSeq = currentTrackSeq

                // STAGE 1: Isolate pre-buffering errors from upcoming tracks so a bad Track B
                // NEVER aborts or skips Track A at ~4/5 progress!
                if (isUpcomingPreloadError(
                        failingUri = failingSpec?.uri?.toString(),
                        failingKey = failingSpec?.key,
                        activeUri = activeEntry?.url,
                        activeKey = activeEntry?.cacheKey,
                        hasUpcomingItems = hasUpcoming,
                        alreadyIsolated = isolatedUpcomingForSeq == expectedSeq,
                        savedPositionMs = savedPosMs,
                        knownStreamDurationMs = lastKnownStreamDurationMs,
                    )
                ) {
                    isolatedUpcomingForSeq = expectedSeq
                    cancelRetry()
                    cancelRecoveryFallback()
                    isExplicitLoading = true
                    try {
                        if (exoPlayer.mediaItemCount > curIdx + 1) {
                            exoPlayer.removeMediaItems(curIdx + 1, exoPlayer.mediaItemCount)
                        }
                        while (queuedTracks.size > curIdx + 1) {
                            queuedTracks.removeAt(queuedTracks.lastIndex)
                        }
                        rebuildItemHeaderRegistry()
                        exoPlayer.seekTo(curIdx, savedPosMs)
                        exoPlayer.prepare()
                        exoPlayer.play()
                    } catch (_: Exception) {
                    } finally {
                        isExplicitLoading = false
                    }
                    bridgeListener?.onPlaybackRecoveryNeeded(
                        reason = "upcoming_dropped",
                        positionMs = savedPosMs,
                        errorCode = error.errorCodeName,
                        message = error.message ?: "下一首预加载异常，已隔离保护当前曲目",
                        trackSeq = expectedSeq,
                    )
                    return
                }

                // STAGE 2: Current track itself hit a stream/CDN/cache failure.
                // Evict only this track's cache entry and request JS to re-resolve a fresh URL
                // and resume seamlessly at savedPosMs — NEVER auto-skipping mid-song!
                removeAudioCacheKey(applicationContext, activeEntry?.cacheKey)
                cancelRetry()
                cancelRecoveryFallback()
                acquireBriefTransitionWakeLock()
                val errMsg = error.message ?: "音频流加载中断"
                bridgeListener?.onPlaybackRecoveryNeeded(
                    reason = "stream_error",
                    positionMs = savedPosMs,
                    errorCode = error.errorCodeName,
                    message = errMsg,
                    trackSeq = expectedSeq,
                )

                // Screen-off Doze fallback: try 1 native reload at savedPosMs; NEVER seekToNextMediaItem()!
                val fallback = Runnable {
                    if (expectedSeq != currentTrackSeq || !::exoPlayer.isInitialized) return@Runnable
                    if (!retriedCurrentError) {
                        retriedCurrentError = true
                        isExplicitLoading = true
                        try {
                            exoPlayer.seekTo(curIdx, savedPosMs)
                            exoPlayer.prepare()
                            exoPlayer.play()
                        } catch (_: Exception) {
                        } finally {
                            isExplicitLoading = false
                        }
                        return@Runnable
                    }
                    bridgeListener?.onError(error.errorCodeName, errMsg, expectedSeq)
                    syncWidgetState()
                }
                recoveryFallbackRunnable = fallback
                mainHandler.postDelayed(fallback, RECOVERY_FALLBACK_TIMEOUT_MS)
            }
        })

        val forwardingPlayer = object : ForwardingPlayer(exoPlayer) {
            override fun getAvailableCommands(): Player.Commands {
                return super.getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build()
            }

            override fun isCommandAvailable(command: Int): Boolean {
                return when (command) {
                    Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                    -> true
                    else -> super.isCommandAvailable(command)
                }
            }

            override fun seekToNext() {
                if (exoPlayer.repeatMode != Player.REPEAT_MODE_ONE && exoPlayer.hasNextMediaItem()) {
                    exoPlayer.seekToNextMediaItem()
                    exoPlayer.play()
                } else {
                    acquireBriefTransitionWakeLock()
                    bridgeListener?.onMediaCommand("next", null)
                }
            }

            override fun seekToNextMediaItem() {
                seekToNext()
            }

            override fun seekToPrevious() {
                if (exoPlayer.currentPosition > 5000L) {
                    exoPlayer.seekTo(0L)
                } else {
                    acquireBriefTransitionWakeLock()
                    bridgeListener?.onMediaCommand("previous", null)
                }
            }

            override fun seekToPreviousMediaItem() {
                seekToPrevious()
            }
        }

        val sessionActivityIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("openNowPlaying", true)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val session = MediaSession.Builder(this, forwardingPlayer)
            .setId("puretone_media_session")
            .setCallback(sessionCallback)
            .setSessionActivity(sessionActivityIntent)
            .build()
        mediaSession = session
        addSession(session)
        refreshCustomNotificationButtons()

        ContextCompat.registerReceiver(
            this,
            noisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        mainHandler.postDelayed(timeTicker, 250L)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!::exoPlayer.isInitialized || !exoPlayer.playWhenReady) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        cancelFade()
        cancelRetry()
        cancelRecoveryFallback()
        releaseTransitionWakeLock()
        mainHandler.removeCallbacks(timeTicker)
        audioEffects.release()
        try {
            unregisterReceiver(noisyReceiver)
        } catch (_: Exception) {
        }
        serviceScope.cancel()
        if (activeService === this) activeService = null
        mediaSession?.release()
        mediaSession = null
        if (::exoPlayer.isInitialized) {
            exoPlayer.release()
        }
        itemHeadersByKey.clear()
        super.onDestroy()
    }

    private fun acquireBriefTransitionWakeLock() {
        try {
            if (transitionWakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                transitionWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PureTone:TrackTransition").apply {
                    setReferenceCounted(false)
                }
            }
            transitionWakeLock?.acquire(10_000L)
        } catch (_: Exception) {
        }
    }

    private fun releaseTransitionWakeLock() {
        try {
            if (transitionWakeLock?.isHeld == true) {
                transitionWakeLock?.release()
            }
        } catch (_: Exception) {
        }
        transitionWakeLock = null
    }

    private fun isScreenInteractive(): Boolean {
        return try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.isInteractive ?: true
        } catch (_: Exception) {
            true
        }
    }

    private fun forceRefreshNotification() {
        val session = mediaSession ?: return
        try {
            onUpdateNotification(session, true)
        } catch (_: Exception) {
        }
    }

    private fun refreshCustomNotificationButtons() {
        val session = mediaSession ?: return
        val heartIcon = if (isCurrentFavorite) {
            CommandButton.ICON_HEART_FILLED
        } else {
            CommandButton.ICON_HEART_UNFILLED
        }
        // Clean Apple Music / Android 15-17 capsule 5-slot layout:
        // [App Icon]  [Previous]  [Play/Pause]  [Next]  [Heart (SLOT_FORWARD_SECONDARY)]
        val favButton = CommandButton.Builder(heartIcon)
            .setDisplayName(if (isCurrentFavorite) "取消红心" else "收藏红心")
            .setSessionCommand(CMD_TOGGLE_FAVORITE)
            .setSlots(CommandButton.SLOT_FORWARD_SECONDARY)
            .build()

        val buttons = ImmutableList.of(favButton)
        session.setMediaButtonPreferences(buttons)
        session.setCustomLayout(buttons)
        forceRefreshNotification()
    }

    private fun ensureMediaNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            // IMPORTANCE_DEFAULT (with silent sound & disabled vibration) ensures eligibility
            // for live media capsules and lock-screen promotion on Android 14–17.
            val channel = NotificationChannel(
                MEDIA_CHANNEL_ID,
                "弥音 · MELUNE 音乐播控",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "用于在锁屏界面、通知中心与系统实时播控展示播放曲目与快捷控制"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun cancelFade() {
        fadeRunnable?.let { mainHandler.removeCallbacks(it) }
        fadeRunnable = null
    }

    private fun cancelRetry() {
        retryRunnable?.let { mainHandler.removeCallbacks(it) }
        retryRunnable = null
    }

    private fun cancelRecoveryFallback() {
        recoveryFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        recoveryFallbackRunnable = null
    }

    private fun registerItemHeaders(entry: QueuedTrackEntry) {
        val snapshot = HashMap<String, String>(entry.headers)
        if (!entry.cacheKey.isNullOrBlank()) {
            itemHeadersByKey["ck:${entry.cacheKey}"] = snapshot
        }
        if (entry.url.isNotBlank()) {
            itemHeadersByKey["uri:${entry.url}"] = snapshot
        }
    }

    private fun rebuildItemHeaderRegistry() {
        itemHeadersByKey.clear()
        for (entry in queuedTracks) {
            registerItemHeaders(entry)
        }
    }

    private fun lookupItemHeaders(cacheKey: String?, uri: String?): Map<String, String> {
        if (!cacheKey.isNullOrBlank()) {
            itemHeadersByKey["ck:$cacheKey"]?.let { return it }
        }
        if (!uri.isNullOrBlank()) {
            itemHeadersByKey["uri:$uri"]?.let { return it }
        }
        return emptyMap()
    }

    private fun extractFailingDataSpec(error: PlaybackException): DataSpec? {
        var cur: Throwable? = error.cause
        var guard = 0
        while (cur != null && guard < 10) {
            if (cur is HttpDataSource.HttpDataSourceException) {
                return cur.dataSpec
            }
            cur = cur.cause
            guard += 1
        }
        return null
    }

    private fun commitNativeTransition(matched: QueuedTrackEntry, idx: Int) {
        retriedCurrentError = false
        cancelRetry()
        cancelRecoveryFallback()
        autoFadeActiveForSeq = -1
        isolatedUpcomingForSeq = -1
        recoveredPrematureEofForSeq = -1
        checkedShortTrialForSeq = -1
        isCurrentLoadRecovery = false
        lastPlayingPositionMs = 0L
        lastKnownStreamDurationMs = 0L
        originalCatalogDurationMs = matched.metadata.durationMs.coerceAtLeast(0L)
        currentTrackSeq += 1
        val newSeq = currentTrackSeq
        currentMetadata = matched.metadata
        currentArtworkBytes = null
        currentArtworkBitmap = null
        currentLiveLyric = ""
        lastLiveLyricUpdatedAt = 0L
        currentAccentColor = DEFAULT_NOTIFICATION_ACCENT

        // Trim already-played entries before current item so playlist stays lean
        if (idx > 0 && idx < queuedTracks.size) {
            val trimmed = queuedTracks.subList(idx, queuedTracks.size).toList()
            queuedTracks.clear()
            queuedTracks.addAll(trimmed)
            if (exoPlayer.currentMediaItemIndex > 0) {
                try {
                    exoPlayer.removeMediaItems(0, exoPlayer.currentMediaItemIndex)
                } catch (_: Exception) {
                }
            }
        }
        rebuildItemHeaderRegistry()

        // Gentle fade-in for the newly entered track when smooth transition is active
        if (transitionFadeMs > 0L && exoPlayer.playWhenReady) {
            val fadeInDur = min(transitionFadeMs, 1600L).coerceAtLeast(240L)
            animateVolume((targetVolume * 0.10f).coerceIn(0f, targetVolume), targetVolume, fadeInDur)
        } else {
            cancelFade()
            exoPlayer.volume = targetVolume
        }

        acquireBriefTransitionWakeLock()
        forceRefreshNotification()
        syncWidgetState()
        if (!matched.metadata.coverUrl.isNullOrBlank()) {
            fetchAndApplyArtwork(matched.metadata.coverUrl, newSeq, matched.metadata)
        }
        bridgeListener?.onNativeTrackAdvanced(matched.queueIndex, newSeq)
    }

    private fun animateVolume(from: Float, to: Float, durationMs: Long, onDone: (() -> Unit)? = null) {
        cancelFade()
        if (!::exoPlayer.isInitialized) {
            onDone?.invoke()
            return
        }
        val safeDur = durationMs.coerceAtLeast(16L)
        val startAt = System.currentTimeMillis()
        exoPlayer.volume = from.coerceIn(0f, 1f)

        val step = object : Runnable {
            override fun run() {
                if (!::exoPlayer.isInitialized) return
                val elapsed = (System.currentTimeMillis() - startAt).toFloat()
                val progress = (elapsed / safeDur).coerceIn(0f, 1f)
                val eased = progress * (2f - progress)
                exoPlayer.volume = (from + (to - from) * eased).coerceIn(0f, 1f)
                if (progress < 1f) {
                    mainHandler.postDelayed(this, 16L)
                } else {
                    fadeRunnable = null
                    onDone?.invoke()
                }
            }
        }
        fadeRunnable = step
        mainHandler.post(step)
    }

    fun loadTrack(
        url: String,
        headers: Map<String, String>,
        metadata: TrackMetadataPayload,
        autoPlay: Boolean,
        trackSeq: Int,
        cacheKey: String? = null,
        queueIndex: Int = -1,
        startPositionMs: Long = 0L,
        isRecovery: Boolean = false,
    ) {
        mainHandler.post {
            cancelFade()
            cancelRetry()
            cancelRecoveryFallback()
            retriedCurrentError = false
            isolatedUpcomingForSeq = -1
            recoveredPrematureEofForSeq = -1
            checkedShortTrialForSeq = -1
            isCurrentLoadRecovery = isRecovery
            val safeStartMs = startPositionMs.coerceAtLeast(0L)
            lastPlayingPositionMs = safeStartMs
            lastKnownStreamDurationMs = 0L
            originalCatalogDurationMs = metadata.durationMs.coerceAtLeast(0L)
            isExplicitLoading = true
            try {
                currentTrackSeq = trackSeq
                currentMetadata = metadata
                currentArtworkBytes = null
                currentArtworkBitmap = null
                currentLiveLyric = ""
                lastLiveLyricUpdatedAt = 0L
                currentAccentColor = DEFAULT_NOTIFICATION_ACCENT

                val mediaId = makeUniqueMediaId(trackSeq, queueIndex, metadata)
                val entry = QueuedTrackEntry(
                    mediaId = mediaId,
                    queueIndex = queueIndex,
                    url = url,
                    headers = headers,
                    metadata = metadata,
                    cacheKey = cacheKey,
                )
                queuedTracks.clear()
                queuedTracks.add(entry)
                rebuildItemHeaderRegistry()

                val item = buildMediaItem(mediaId, url, metadata, null, cacheKey)
                autoFadeActiveForSeq = -1
                exoPlayer.volume = if (autoPlay) 0f else targetVolume
                if (safeStartMs > 0L) {
                    exoPlayer.setMediaItem(item, safeStartMs)
                } else {
                    exoPlayer.setMediaItem(item)
                }
                exoPlayer.prepare()
                exoPlayer.playWhenReady = autoPlay
                if (autoPlay) {
                    val fadeInDur = if (safeStartMs > 0L) {
                        220L
                    } else if (transitionFadeMs > 0L) {
                        min(transitionFadeMs, 1200L).coerceAtLeast(220L)
                    } else {
                        180L
                    }
                    animateVolume(0f, targetVolume, fadeInDur)
                }
            } finally {
                isExplicitLoading = false
            }

            forceRefreshNotification()
            syncWidgetState()

            if (!metadata.coverUrl.isNullOrBlank()) {
                fetchAndApplyArtwork(metadata.coverUrl, trackSeq, metadata)
            }
        }
    }

    fun syncUpcomingTracks(entries: List<QueuedTrackEntry>) {
        mainHandler.post {
            if (!::exoPlayer.isInitialized || exoPlayer.mediaItemCount == 0) return@post
            val curIdx = exoPlayer.currentMediaItemIndex.coerceAtLeast(0)
            // Keep active track at curIdx intact; replace only future lookahead items
            if (exoPlayer.mediaItemCount > curIdx + 1) {
                exoPlayer.removeMediaItems(curIdx + 1, exoPlayer.mediaItemCount)
            }
            while (queuedTracks.size > curIdx + 1) {
                queuedTracks.removeAt(queuedTracks.lastIndex)
            }

            if (entries.isEmpty()) {
                rebuildItemHeaderRegistry()
                return@post
            }
            val mediaItems = entries.map { e ->
                queuedTracks.add(e)
                buildMediaItem(e.mediaId, e.url, e.metadata, null, e.cacheKey)
            }
            rebuildItemHeaderRegistry()
            exoPlayer.addMediaItems(mediaItems)
        }
    }

    fun prepareNextTrack(
        url: String,
        headers: Map<String, String>,
        metadata: TrackMetadataPayload,
        cacheKey: String? = null,
        queueIndex: Int = -1,
    ) {
        val entry = QueuedTrackEntry(
            mediaId = makeUniqueMediaId(currentTrackSeq + 1, queueIndex, metadata),
            queueIndex = queueIndex,
            url = url,
            headers = headers,
            metadata = metadata,
            cacheKey = cacheKey,
        )
        syncUpcomingTracks(listOf(entry))
    }

    fun clearNextTrack() {
        syncUpcomingTracks(emptyList())
    }

    fun play() = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        exoPlayer.play()
        animateVolume(0f, targetVolume, 200L)
        forceRefreshNotification()
        syncWidgetState()
    }

    fun pause() = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        if (!exoPlayer.isPlaying) {
            exoPlayer.pause()
            exoPlayer.volume = targetVolume
            forceRefreshNotification()
            syncWidgetState()
            return@post
        }
        val startVol = exoPlayer.volume.coerceIn(0f, 1f)
        animateVolume(startVol, 0f, 200L) {
            exoPlayer.pause()
            exoPlayer.volume = targetVolume
            forceRefreshNotification()
            syncWidgetState()
        }
    }

    fun fadeOutAndPause(durationMs: Long) = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        val startVol = exoPlayer.volume.coerceIn(0f, 1f)
        animateVolume(startVol, 0f, durationMs.coerceIn(200L, 10000L)) {
            exoPlayer.pause()
            exoPlayer.volume = targetVolume
            bridgeListener?.onStateChange(false, false, false, currentTrackSeq)
            forceRefreshNotification()
            syncWidgetState()
        }
    }

    fun stopPlayback() = mainHandler.post {
        cancelFade()
        cancelRetry()
        cancelRecoveryFallback()
        isCurrentLoadRecovery = false
        lastPlayingPositionMs = 0L
        lastKnownStreamDurationMs = 0L
        originalCatalogDurationMs = 0L
        queuedTracks.clear()
        itemHeadersByKey.clear()
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        exoPlayer.volume = targetVolume
        syncWidgetState()
    }

    fun seekTo(positionMs: Long) = mainHandler.post {
        val safePos = positionMs.coerceAtLeast(0L)
        lastPlayingPositionMs = safePos
        exoPlayer.seekTo(safePos)
        val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L }
            ?: (currentMetadata?.durationMs ?: 0L)
        bridgeListener?.onTimeUpdate(safePos, dur, effectiveIsPlaying(), currentTrackSeq)
    }

    fun setVolume(volume: Float) = mainHandler.post {
        targetVolume = volume.coerceIn(0f, 1f)
        cancelFade()
        exoPlayer.volume = targetVolume
    }

    fun setSpeed(speed: Float) = mainHandler.post {
        exoPlayer.playbackParameters = PlaybackParameters(speed.coerceIn(0.5f, 2.0f))
    }

    fun setRepeatOne(enabled: Boolean) = mainHandler.post {
        exoPlayer.repeatMode = if (enabled) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    fun setFavoriteState(favorite: Boolean) = mainHandler.post {
        if (isCurrentFavorite != favorite) {
            isCurrentFavorite = favorite
            refreshCustomNotificationButtons()
            syncWidgetState()
        }
    }

    fun setPlayModeState(mode: String) = mainHandler.post {
        currentPlayMode = mode
    }

    fun setTransitionFadeMs(fadeMs: Int) = mainHandler.post {
        transitionFadeMs = fadeMs.toLong().coerceIn(0L, 6000L)
        if (transitionFadeMs == 0L && autoFadeActiveForSeq == currentTrackSeq && ::exoPlayer.isInitialized) {
            autoFadeActiveForSeq = -1
            exoPlayer.volume = targetVolume
        }
    }

    fun setVolumeLeveling(enabled: Boolean) = mainHandler.post {
        if (::exoPlayer.isInitialized) {
            audioEffects.attachToSession(exoPlayer.audioSessionId)
        }
        audioEffects.applyVolumeLeveling(enabled)
    }

    /**
     * Applies studio-safe subtractive EQ with a 70ms volume duck + 120ms soft ramp
     * so switching presets (e.g. to Vocal) mid-playback NEVER causes DSP pops or digital clipping.
     */
    fun setEqPreset(preset: String) = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        audioEffects.attachToSession(exoPlayer.audioSessionId)
        if (!exoPlayer.isPlaying) {
            audioEffects.applyPreset(preset)
            return@post
        }
        val startVol = exoPlayer.volume.coerceIn(0f, 1f)
        val duckVol = (targetVolume * 0.18f).coerceIn(0.05f, startVol)
        animateVolume(startVol, duckVol, 70L) {
            audioEffects.applyPreset(preset)
            animateVolume(duckVol, targetVolume, 120L)
        }
    }

    fun setLiveLyric(lyricLine: String) = mainHandler.post {
        val clean = lyricLine.trim()
        if (clean == currentLiveLyric) return@post
        // Throttle live lyric updates when screen is off or too frequent to prevent lock-screen media card freeze
        if (clean.isNotEmpty()) {
            if (!isScreenInteractive()) return@post
            val now = System.currentTimeMillis()
            if (now - lastLiveLyricUpdatedAt < 2500L) return@post
            lastLiveLyricUpdatedAt = now
        }
        currentLiveLyric = clean
        val meta = currentMetadata ?: return@post
        applyMetadataToActiveItem(meta, currentArtworkBytes)
    }

    fun updateMetadata(metadata: TrackMetadataPayload) {
        mainHandler.post {
            currentMetadata = metadata
            applyMetadataToActiveItem(metadata, currentArtworkBytes)
            syncWidgetState()
            if (!metadata.coverUrl.isNullOrBlank() && currentArtworkBytes == null) {
                fetchAndApplyArtwork(metadata.coverUrl, currentTrackSeq, metadata)
            }
        }
    }

    private fun applyMetadataToActiveItem(meta: TrackMetadataPayload, artworkBytes: ByteArray?) {
        if (!::exoPlayer.isInitialized) return
        val idx = exoPlayer.currentMediaItemIndex
        val currentItem = exoPlayer.currentMediaItem ?: return
        val updated = currentItem.buildUpon()
            .setMediaMetadata(buildMediaMetadata(meta, artworkBytes))
            .build()
        isExplicitLoading = true
        try {
            exoPlayer.replaceMediaItem(idx, updated)
        } finally {
            isExplicitLoading = false
        }
        forceRefreshNotification()
    }

    fun handleWidgetTogglePlay() {
        mainHandler.post {
            if (!::exoPlayer.isInitialized || exoPlayer.currentMediaItem == null) {
                bridgeListener?.onMediaCommand("play", null)
                return@post
            }
            if (exoPlayer.isPlaying) {
                pause()
                bridgeListener?.onMediaCommand("pause", null)
            } else {
                play()
                bridgeListener?.onMediaCommand("play", null)
            }
        }
    }

    fun handleWidgetNext() {
        mainHandler.post {
            if (::exoPlayer.isInitialized && exoPlayer.repeatMode != Player.REPEAT_MODE_ONE && exoPlayer.hasNextMediaItem()) {
                exoPlayer.seekToNextMediaItem()
                exoPlayer.play()
            } else {
                bridgeListener?.onMediaCommand("next", null)
            }
        }
    }

    fun handleWidgetPrev() {
        mainHandler.post { bridgeListener?.onMediaCommand("previous", null) }
    }

    fun handleWidgetToggleFav() {
        mainHandler.post {
            isCurrentFavorite = !isCurrentFavorite
            refreshCustomNotificationButtons()
            syncWidgetState()
            bridgeListener?.onMediaCommand("toggleFavorite", null)
        }
    }

    private fun syncWidgetState() {
        val meta = currentMetadata
        val playing = effectiveIsPlaying()
        PureToneWidgetProvider.updateAll(
            context = this,
            title = meta?.title ?: getString(R.string.app_name),
            artist = meta?.artist ?: getString(R.string.widget_idle_subtitle),
            isPlaying = playing,
            artwork = currentArtworkBitmap,
            accentColor = currentAccentColor,
            isFavorite = isCurrentFavorite,
        )
    }

    fun snapshotState(): Map<String, Any> {
        val isPlaying = effectiveIsPlaying()
        val isBuffering = if (::exoPlayer.isInitialized) exoPlayer.playbackState == Player.STATE_BUFFERING else false
        val pos = if (::exoPlayer.isInitialized) exoPlayer.currentPosition.coerceAtLeast(0L) else 0L
        val dur = if (::exoPlayer.isInitialized) {
            exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: (currentMetadata?.durationMs ?: 0L)
        } else 0L
        return mapOf(
            "isPlaying" to isPlaying,
            "isBuffering" to isBuffering,
            "currentTimeMs" to pos,
            "durationMs" to dur,
            "volume" to targetVolume.toDouble(),
            "speed" to (if (::exoPlayer.isInitialized) exoPlayer.playbackParameters.speed.toDouble() else 1.0),
            "repeatOne" to (if (::exoPlayer.isInitialized) exoPlayer.repeatMode == Player.REPEAT_MODE_ONE else false),
            "trackSeq" to currentTrackSeq,
        )
    }

    private fun makeUniqueMediaId(seq: Int, queueIndex: Int, meta: TrackMetadataPayload): String {
        return "pt_${seq}_${queueIndex}_${meta.title.hashCode()}_${meta.artist.hashCode()}"
    }

    private fun buildMediaMetadata(meta: TrackMetadataPayload, artworkBytes: ByteArray?): MediaMetadata {
        val artistSubtitle = if (currentLiveLyric.isNotBlank()) {
            currentLiveLyric
        } else {
            meta.artist
        }
        return MediaMetadata.Builder()
            .setTitle(meta.title)
            .setDisplayTitle(meta.title)
            .setArtist(artistSubtitle)
            .setSubtitle(if (currentLiveLyric.isNotBlank()) meta.artist else meta.album)
            .setAlbumTitle(meta.album)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .apply {
                if (meta.durationMs > 0L) {
                    setDurationMs(meta.durationMs)
                }
                if (artworkBytes != null && artworkBytes.isNotEmpty()) {
                    setArtworkData(artworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                }
            }
            .build()
    }

    private fun buildMediaItem(
        mediaId: String,
        url: String,
        meta: TrackMetadataPayload,
        artworkBytes: ByteArray?,
        cacheKey: String?,
    ): MediaItem {
        return MediaItem.Builder()
            .setMediaId(mediaId)
            .setUri(Uri.parse(url))
            .setMediaMetadata(buildMediaMetadata(meta, artworkBytes))
            .apply {
                if (!cacheKey.isNullOrBlank()) {
                    setCustomCacheKey(cacheKey)
                }
            }
            .build()
    }

    private fun fetchAndApplyArtwork(coverUrl: String, trackSeq: Int, meta: TrackMetadataPayload) {
        serviceScope.launch {
            try {
                val hdUrl = coverUrl.replace("/240/", "/640/").replace("/400/", "/640/")
                val req = Request.Builder().url(hdUrl).build()
                okHttpClient.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@launch
                    val bytes = res.body?.bytes() ?: return@launch
                    if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) return@launch
                    val bmp = try {
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } catch (_: Exception) {
                        null
                    }
                    val accent = bmp?.let { extractAccentColorFromBitmap(it) } ?: DEFAULT_NOTIFICATION_ACCENT
                    mainHandler.post {
                        if (trackSeq != currentTrackSeq || !::exoPlayer.isInitialized) return@post
                        currentArtworkBytes = bytes
                        currentArtworkBitmap = bmp
                        currentAccentColor = accent
                        val activeMeta = currentMetadata ?: meta
                        applyMetadataToActiveItem(activeMeta, bytes)
                        syncWidgetState()
                    }
                }
            } catch (_: Exception) {
                // Non-fatal
            }
        }
    }

    companion object {
        const val MEDIA_CHANNEL_ID = "puretone_media_playback_v2"
        const val DEFAULT_USER_AGENT = "MELUNE-Android/2.4 (Linux; Android 16)"
        const val RECOVERY_FALLBACK_TIMEOUT_MS = 4_500L
        const val DEFAULT_AUDIO_CACHE_MAX_MB = 2048
        const val MAX_AUDIO_CACHE_BYTES = DEFAULT_AUDIO_CACHE_MAX_MB.toLong() * 1024L * 1024L
        private const val CACHE_PREFS_NAME = "melune_cache_prefs"
        private const val KEY_AUDIO_CACHE_MAX_MB = "audio_cache_max_mb"
        const val ACTION_TOGGLE_FAVORITE = "com.xhd2005.puretone.ACTION_TOGGLE_FAVORITE"
        const val ACTION_CYCLE_PLAY_MODE = "com.xhd2005.puretone.ACTION_CYCLE_PLAY_MODE"
        private const val DEFAULT_NOTIFICATION_ACCENT = 0xFF1A2D70.toInt()

        /**
         * Preserves stable UI playing state during transient seek/rebuffer windows (`STATE_BUFFERING`
         * while `playWhenReady == true` and no audio-focus suppression) so album artwork & transport
         * controls never flash paused or twitch when scrubbing the progress bar.
         */
        fun computeEffectiveIsPlaying(
            isPlaying: Boolean,
            playWhenReady: Boolean,
            playbackState: Int,
            playbackSuppressionReason: Int = Player.PLAYBACK_SUPPRESSION_REASON_NONE,
        ): Boolean {
            if (isPlaying) return true
            return playWhenReady &&
                playbackState == Player.STATE_BUFFERING &&
                playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
        }

        fun resolveRequestHeaders(
            existingHeaders: Map<String, String>,
            itemHeaders: Map<String, String>,
            defaultUserAgent: String = DEFAULT_USER_AGENT,
        ): Map<String, String> {
            val merged = LinkedHashMap<String, String>(existingHeaders)
            for ((k, v) in itemHeaders) {
                if (k.isNotBlank() && v.isNotBlank()) {
                    merged[k] = v
                }
            }
            val hasUa = merged.keys.any { it.equals("User-Agent", ignoreCase = true) }
            if (!hasUa && defaultUserAgent.isNotBlank()) {
                merged["User-Agent"] = defaultUserAgent
            }
            return merged
        }

        /**
         * Determines whether a PlaybackException originated from pre-buffering an upcoming queued
         * track (which typically triggers ~30-50s before track end, right around 4/5 progress)
         * rather than the actively playing track itself.
         */
        fun isUpcomingPreloadError(
            failingUri: String?,
            failingKey: String?,
            activeUri: String?,
            activeKey: String?,
            hasUpcomingItems: Boolean,
            alreadyIsolated: Boolean,
            savedPositionMs: Long,
            knownStreamDurationMs: Long,
        ): Boolean {
            if (!hasUpcomingItems) return false
            val cleanFailKey = failingKey?.trim().orEmpty()
            val cleanActiveKey = activeKey?.trim().orEmpty()
            if (cleanFailKey.isNotEmpty() && cleanActiveKey.isNotEmpty() && cleanFailKey != cleanActiveKey) {
                return true
            }
            val cleanFailUri = failingUri?.trim().orEmpty()
            val cleanActiveUri = activeUri?.trim().orEmpty()
            if (cleanFailUri.isNotEmpty() && cleanActiveUri.isNotEmpty() && cleanFailUri != cleanActiveUri) {
                return true
            }
            // If we have an explicit DataSpec match proving it IS the active track, do NOT misclassify as upcoming
            if ((cleanFailKey.isNotEmpty() && cleanFailKey == cleanActiveKey) ||
                (cleanFailUri.isNotEmpty() && cleanFailUri == cleanActiveUri)
            ) {
                return false
            }
            // No HTTP DataSpec (e.g. ParserException while pre-preparing upcoming MediaItem):
            // isolate upcoming items once if active track was already playing well before its tail.
            if (!alreadyIsolated && savedPositionMs >= 3_000L) {
                if (knownStreamDurationMs <= 0L || savedPositionMs < knownStreamDurationMs - 5_000L) {
                    return true
                }
            }
            return false
        }

        /**
         * Detects 30s/60s VIP trial snippets immediately at STATE_READY when actual stream container
         * duration is drastically shorter than catalog song duration (stopping chorus cut-offs!).
         */
        fun isUnexpectedShortStream(
            actualStreamDurationMs: Long,
            catalogDurationMs: Long,
            alreadyCheckedOrRecovery: Boolean,
        ): Boolean {
            if (alreadyCheckedOrRecovery) return false
            if (catalogDurationMs < 90_000L) return false
            if (actualStreamDurationMs <= 0L) return false
            val diffMs = catalogDurationMs - actualStreamDurationMs
            val ratio = actualStreamDurationMs.toDouble() / catalogDurationMs.toDouble()
            return actualStreamDurationMs <= 75_000L && diffMs >= 30_000L && ratio < 0.70
        }

        /**
         * Detects silently truncated audio streams, corrupt cache spans, or sneaky trial clips
         * that hit EOF suspiciously early (e.g. at chorus ~60s or ~4/5 progress) without error.
         */
        fun shouldTriggerPrematureEndRecovery(
            lastPositionMs: Long,
            knownStreamDurationMs: Long,
            catalogDurationMs: Long = 0L,
            alreadyRecovered: Boolean,
        ): Boolean {
            if (alreadyRecovered) return false
            if (lastPositionMs < 10_000L) return false
            // Case 1: Stream container itself says it's much longer than where EOF occurred (e.g. 4/5 cut-off)
            if (knownStreamDurationMs >= 60_000L) {
                val remainingMs = knownStreamDurationMs - lastPositionMs
                val ratio = lastPositionMs.toDouble() / knownStreamDurationMs.toDouble()
                if (remainingMs >= 12_000L && ratio < 0.92) {
                    return true
                }
            }
            // Case 2: Stream ended around ~30-75s (chorus) while catalog song is clearly a full song (>= 100s)
            if (catalogDurationMs >= 100_000L &&
                lastPositionMs <= 75_000L &&
                catalogDurationMs - lastPositionMs >= 35_000L
            ) {
                return true
            }
            return false
        }

        val CMD_TOGGLE_FAVORITE by lazy { SessionCommand(ACTION_TOGGLE_FAVORITE, Bundle.EMPTY) }
        val CMD_CYCLE_PLAY_MODE by lazy { SessionCommand(ACTION_CYCLE_PLAY_MODE, Bundle.EMPTY) }

        @Volatile
        var activeService: EchoPlaybackService? = null

        @Volatile
        var bridgeListener: PlayerBridgeListener? = null

        @Volatile
        private var sharedAudioCache: SimpleCache? = null

        @Volatile
        private var sharedCacheEvictor: DynamicLruCacheEvictor? = null

        fun sanitizeAudioCacheMaxMb(rawMb: Int): Int {
            return when (rawMb) {
                0, 500, 1024, 2048, 4096 -> rawMb
                else -> DEFAULT_AUDIO_CACHE_MAX_MB
            }
        }

        fun audioCacheMbToBytes(maxMb: Int): Long {
            val clean = sanitizeAudioCacheMaxMb(maxMb)
            return if (clean <= 0) 0L else clean.toLong() * 1024L * 1024L
        }

        fun getAudioCacheMaxMb(appContext: Context): Int {
            val prefs = appContext.getSharedPreferences(CACHE_PREFS_NAME, Context.MODE_PRIVATE)
            return sanitizeAudioCacheMaxMb(prefs.getInt(KEY_AUDIO_CACHE_MAX_MB, DEFAULT_AUDIO_CACHE_MAX_MB))
        }

        fun setAudioCacheMaxMb(appContext: Context, maxMb: Int): Long {
            val cleanMb = sanitizeAudioCacheMaxMb(maxMb)
            val maxBytes = audioCacheMbToBytes(cleanMb)
            appContext.getSharedPreferences(CACHE_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_AUDIO_CACHE_MAX_MB, cleanMb)
                .apply()
            sharedCacheEvictor?.setMaxBytes(maxBytes, sharedAudioCache)
            return maxBytes
        }

        fun shouldUsePromotedLiveUpdate(sdkInt: Int, canPostPromoted: Boolean): Boolean {
            return sdkInt >= 36 && canPostPromoted
        }

        fun formatShortCriticalTitle(rawTitle: String): String {
            val clean = rawTitle.trim()
            if (clean.length <= 18) return clean
            return clean.take(17) + "…"
        }

        fun isActivelyPlaying(): Boolean {
            return activeService?.isCurrentlyActive() == true
        }

        /**
         * Cosine-eased fade-out multiplier for smooth single-engine track transition.
         * Returns 1.0 outside the fade window and smoothly tapers toward 0.08 as remainingMs -> 0.
         */
        fun computeTrackFadeFactor(remainingMs: Long, fadeDurationMs: Long): Float {
            if (fadeDurationMs <= 0L || remainingMs >= fadeDurationMs) return 1.0f
            if (remainingMs <= 0L) return 0.08f
            val ratio = (remainingMs.toFloat() / fadeDurationMs.toFloat()).coerceIn(0f, 1f)
            val eased = (0.5f - 0.5f * cos(ratio * Math.PI).toFloat()).coerceIn(0f, 1f)
            return (0.08f + 0.92f * eased).coerceIn(0.08f, 1.0f)
        }

        /**
         * Pro-audio SUBTRACTIVE EQ gain curves (millibels, 100 mB = 1 dB).
         * Every band stays strictly <= 0 mB so mastered 0 dBFS music tracks NEVER clip or crackle
         * on Android DSP Equalizers while preserving crisp tonal character.
         */
        fun computeEqBandGains(preset: String, centerFreqsHz: IntArray): IntArray {
            return IntArray(centerFreqsHz.size) { idx ->
                val hz = centerFreqsHz[idx]
                when (preset) {
                    "vocal" -> when {
                        hz <= 150 -> -420
                        hz <= 500 -> -160
                        hz <= 2500 -> 0
                        hz <= 6000 -> -80
                        else -> -260
                    }
                    "bass" -> when {
                        hz <= 120 -> 0
                        hz <= 350 -> -60
                        hz <= 1200 -> -320
                        hz <= 4500 -> -260
                        else -> -180
                    }
                    "night" -> when {
                        hz <= 150 -> -80
                        hz <= 500 -> -120
                        hz <= 2500 -> -240
                        hz <= 6000 -> -420
                        else -> -540
                    }
                    "live" -> when {
                        hz <= 140 -> -40
                        hz <= 500 -> -280
                        hz <= 2000 -> -160
                        hz <= 6000 -> -40
                        else -> 0
                    }
                    else -> 0
                }
            }
        }

        fun selectNotificationAccentRgb(samples: List<Triple<Int, Int, Int>>): Triple<Int, Int, Int> {
            var bestScore = -1.0
            var bestR = 138
            var bestG = 28
            var bestB = 50
            for ((r, g, b) in samples) {
                val maxC = max(r, max(g, b))
                val minC = min(r, min(g, b))
                val delta = maxC - minC
                val sat = if (maxC == 0) 0.0 else delta.toDouble() / maxC.toDouble()
                val luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
                if (luma < 0.12 || luma > 0.90) continue
                val score = sat * 1.4 + (1.0 - abs(luma - 0.45)) * 0.6
                if (sat >= 0.22 && score > bestScore) {
                    bestScore = score
                    bestR = r
                    bestG = g
                    bestB = b
                }
            }
            val factor = if ((0.299 * bestR + 0.587 * bestG + 0.114 * bestB) > 145) 0.62 else 0.84
            return Triple(
                (bestR * factor).roundToInt().coerceIn(24, 185),
                (bestG * factor).roundToInt().coerceIn(24, 185),
                (bestB * factor).roundToInt().coerceIn(24, 185),
            )
        }

        private fun extractAccentColorFromBitmap(bmp: Bitmap): Int {
            return try {
                val scaled = Bitmap.createScaledBitmap(bmp, 16, 16, true)
                val samples = ArrayList<Triple<Int, Int, Int>>(64)
                for (y in 0 until scaled.height step 2) {
                    for (x in 0 until scaled.width step 2) {
                        val px = scaled.getPixel(x, y)
                        samples.add(Triple(Color.red(px), Color.green(px), Color.blue(px)))
                    }
                }
                if (scaled !== bmp) scaled.recycle()
                val (r, g, b) = selectNotificationAccentRgb(samples)
                Color.rgb(r, g, b)
            } catch (_: Exception) {
                DEFAULT_NOTIFICATION_ACCENT
            }
        }

        @Synchronized
        fun getOrCreateAudioCache(appContext: Context): SimpleCache {
            sharedAudioCache?.let { return it }
            val cacheDir = File(appContext.cacheDir, "puretone_audio_cache")
            if (!cacheDir.exists()) cacheDir.mkdirs()
            val maxBytes = audioCacheMbToBytes(getAudioCacheMaxMb(appContext))
            val evictor = DynamicLruCacheEvictor(maxBytes)
            sharedCacheEvictor = evictor
            val dbProvider = StandaloneDatabaseProvider(appContext)
            return SimpleCache(cacheDir, evictor, dbProvider).also {
                sharedAudioCache = it
            }
        }

        fun isTrackCached(appContext: Context, cacheKey: String): Boolean {
            val cleanKey = cacheKey.trim()
            if (cleanKey.isEmpty()) return false
            return try {
                val cache = getOrCreateAudioCache(appContext)
                val contentLen = ContentMetadata.getContentLength(cache.getContentMetadata(cleanKey))
                contentLen > 0L && cache.isCached(cleanKey, 0L, contentLen)
            } catch (_: Exception) {
                false
            }
        }

        fun removeAudioCacheKey(appContext: Context, cacheKey: String?): Boolean {
            val cleanKey = cacheKey?.trim().orEmpty()
            if (cleanKey.isEmpty()) return false
            return try {
                val cache = sharedAudioCache ?: getOrCreateAudioCache(appContext)
                cache.removeResource(cleanKey)
                true
            } catch (_: Exception) {
                false
            }
        }

        fun getAudioCacheSizeBytes(appContext: Context): Long {
            val cache = sharedAudioCache
            if (cache != null) {
                return try {
                    cache.cacheSpace.coerceAtLeast(0L)
                } catch (_: Exception) {
                    0L
                }
            }
            val dir = File(appContext.cacheDir, "puretone_audio_cache")
            return computeDirSize(dir)
        }

        fun clearAudioCache(appContext: Context): Boolean {
            return try {
                val cache = sharedAudioCache
                if (cache != null) {
                    val keys = cache.keys.toList()
                    for (k in keys) {
                        try {
                            cache.removeResource(k)
                        } catch (_: Exception) {
                        }
                    }
                } else {
                    val dir = File(appContext.cacheDir, "puretone_audio_cache")
                    if (dir.exists()) dir.deleteRecursively()
                }
                true
            } catch (_: Exception) {
                false
            }
        }

        private fun computeDirSize(file: File): Long {
            if (!file.exists()) return 0L
            if (file.isFile) return file.length()
            var total = 0L
            file.listFiles()?.forEach { child ->
                total += computeDirSize(child)
            }
            return total
        }
    }
}
