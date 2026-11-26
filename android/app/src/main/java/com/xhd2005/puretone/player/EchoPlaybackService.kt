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
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
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

interface PlayerBridgeListener {
    fun onTimeUpdate(currentTimeMs: Long, durationMs: Long, isPlaying: Boolean, trackSeq: Int)
    fun onStateChange(isPlaying: Boolean, isBuffering: Boolean, ended: Boolean, trackSeq: Int)
    fun onError(code: String, message: String, trackSeq: Int)
    fun onMediaCommand(command: String, positionMs: Long?)
}

@OptIn(UnstableApi::class)
private class PureToneMediaNotificationProvider(
    context: Context,
    private val accentColorProvider: () -> Int,
) : MediaNotification.Provider {

    private val delegate = DefaultMediaNotificationProvider.Builder(context)
        .setChannelId(EchoPlaybackService.MEDIA_CHANNEL_ID)
        .setChannelName(R.string.app_name)
        .build()
        .apply {
            setSmallIcon(R.drawable.ic_stat_puretone)
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
        n.extras.putBoolean(Notification.EXTRA_COLORIZED, true)
        return mediaNotification
    }

    override fun handleCustomCommand(session: MediaSession, action: String, extras: Bundle): Boolean {
        return delegate.handleCustomCommand(session, action, extras)
    }
}

private class PureToneAudioEffects {
    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var boundSessionId: Int = C.AUDIO_SESSION_ID_UNSET
    private var currentPreset: String = "flat"

    fun attachToSession(audioSessionId: Int) {
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId == 0) return
        if (boundSessionId == audioSessionId && equalizer != null) {
            applyPreset(currentPreset)
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
        applyPreset(currentPreset)
    }

    fun applyPreset(preset: String) {
        currentPreset = preset
        val eq = equalizer
        val bass = bassBoost
        try {
            if (preset == "flat") {
                eq?.enabled = false
                bass?.enabled = false
                return
            }
            if (eq != null) {
                val bandCount = eq.numberOfBands.toInt().coerceAtLeast(1)
                val range = eq.bandLevelRange
                val minLv = range[0].toInt()
                val maxLv = range[1].toInt()
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
                val strength: Short = when (preset) {
                    "bass" -> 380
                    "live" -> 200
                    "night" -> 120
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
        equalizer = null
        bassBoost = null
        boundSessionId = C.AUDIO_SESSION_ID_UNSET
    }
}

@OptIn(UnstableApi::class)
class EchoPlaybackService : MediaSessionService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private lateinit var upstreamFactory: OkHttpDataSource.Factory
    private lateinit var exoPlayer: ExoPlayer
    private var mediaSession: MediaSession? = null
    private val audioEffects = PureToneAudioEffects()

    private var currentTrackSeq: Int = 0
    private var currentMetadata: TrackMetadataPayload? = null
    private var currentArtworkBytes: ByteArray? = null
    private var currentArtworkBitmap: Bitmap? = null
    private var currentAccentColor: Int = DEFAULT_NOTIFICATION_ACCENT
    private var currentLiveLyric: String = ""
    private var isCurrentFavorite: Boolean = false
    private var currentPlayMode: String = "sequence"
    private var nextMediaItem: MediaItem? = null
    private var targetVolume: Float = 1.0f
    private var fadeRunnable: Runnable? = null

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
                val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L }
                    ?: (currentMetadata?.durationMs ?: 0L)
                bridgeListener?.onTimeUpdate(pos, dur, true, currentTrackSeq)
            }
            mainHandler.postDelayed(this, 250L)
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
            PureToneMediaNotificationProvider(this) { currentAccentColor },
        )

        upstreamFactory = OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent("PureTone-Android/2.1 (Linux; Android 15)")

        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(getOrCreateAudioCache(applicationContext))
            .setUpstreamDataSourceFactory(upstreamFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(cacheDataSourceFactory))
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        audioEffects.attachToSession(exoPlayer.audioSessionId)

        exoPlayer.addListener(object : Player.Listener {
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                audioEffects.attachToSession(audioSessionId)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                val buffering = exoPlayer.playbackState == Player.STATE_BUFFERING
                bridgeListener?.onStateChange(isPlaying, buffering, false, currentTrackSeq)
                syncWidgetState()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val buffering = playbackState == Player.STATE_BUFFERING
                val ended = playbackState == Player.STATE_ENDED
                if (ended) {
                    bridgeListener?.onStateChange(false, false, true, currentTrackSeq)
                    syncWidgetState()
                } else {
                    bridgeListener?.onStateChange(exoPlayer.isPlaying, buffering, false, currentTrackSeq)
                    if (playbackState == Player.STATE_READY) {
                        val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
                        bridgeListener?.onTimeUpdate(
                            exoPlayer.currentPosition.coerceAtLeast(0L),
                            dur,
                            exoPlayer.isPlaying,
                            currentTrackSeq,
                        )
                    }
                    syncWidgetState()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                bridgeListener?.onError(
                    error.errorCodeName,
                    error.message ?: "音频解码或网络加载失败",
                    currentTrackSeq,
                )
                syncWidgetState()
            }
        })

        val forwardingPlayer = object : ForwardingPlayer(exoPlayer) {
            override fun getAvailableCommands(): Player.Commands {
                return super.getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build()
            }

            override fun isCommandAvailable(command: Int): Boolean {
                return when (command) {
                    Player.COMMAND_SEEK_TO_NEXT,
                    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_TO_PREVIOUS,
                    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                    -> true
                    else -> super.isCommandAvailable(command)
                }
            }

            override fun seekToNext() {
                bridgeListener?.onMediaCommand("next", null)
            }

            override fun seekToNextMediaItem() {
                bridgeListener?.onMediaCommand("next", null)
            }

            override fun seekToPrevious() {
                bridgeListener?.onMediaCommand("previous", null)
            }

            override fun seekToPreviousMediaItem() {
                bridgeListener?.onMediaCommand("previous", null)
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
        mainHandler.removeCallbacks(timeTicker)
        audioEffects.release()
        try {
            unregisterReceiver(noisyReceiver)
        } catch (_: Exception) {
        }
        serviceScope.cancel()
        if (activeService === this) activeService = null
        mediaSession?.run {
            release()
        }
        mediaSession = null
        if (::exoPlayer.isInitialized) {
            exoPlayer.release()
        }
        super.onDestroy()
    }

    private fun refreshCustomNotificationButtons() {
        val session = mediaSession ?: return
        val heartIcon = if (isCurrentFavorite) {
            CommandButton.ICON_HEART_FILLED
        } else {
            CommandButton.ICON_HEART_UNFILLED
        }
        val favButton = CommandButton.Builder(heartIcon)
            .setDisplayName(if (isCurrentFavorite) "取消红心" else "收藏红心")
            .setSessionCommand(CMD_TOGGLE_FAVORITE)
            .build()

        val modeIcon = when (currentPlayMode) {
            "shuffle" -> CommandButton.ICON_SHUFFLE_ON
            "repeat-one" -> CommandButton.ICON_REPEAT_ONE
            else -> CommandButton.ICON_REPEAT_ALL
        }
        val modeLabel = when (currentPlayMode) {
            "shuffle" -> "随机播放"
            "repeat-one" -> "单曲循环"
            else -> "列表循环"
        }
        val modeButton = CommandButton.Builder(modeIcon)
            .setDisplayName(modeLabel)
            .setSessionCommand(CMD_CYCLE_PLAY_MODE)
            .build()

        val buttons = ImmutableList.of(favButton, modeButton)
        session.setCustomLayout(buttons)
    }

    private fun ensureMediaNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                MEDIA_CHANNEL_ID,
                "纯音 PureTone 音乐播控",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "用于在通知中心、锁屏界面与原子岛展示播放曲目、封面配色与快捷控制"
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
    ) {
        mainHandler.post {
            cancelFade()
            currentTrackSeq = trackSeq
            currentMetadata = metadata
            currentArtworkBytes = null
            currentArtworkBitmap = null
            currentLiveLyric = ""
            currentAccentColor = DEFAULT_NOTIFICATION_ACCENT
            nextMediaItem = null
            upstreamFactory.setDefaultRequestProperties(headers)

            val item = buildMediaItem(url, metadata, null, cacheKey)
            exoPlayer.volume = if (autoPlay) 0f else targetVolume
            exoPlayer.setMediaItem(item)
            exoPlayer.prepare()
            exoPlayer.playWhenReady = autoPlay
            if (autoPlay) {
                animateVolume(0f, targetVolume, 220L)
            }
            syncWidgetState()

            if (!metadata.coverUrl.isNullOrBlank()) {
                fetchAndApplyArtwork(metadata.coverUrl, trackSeq, metadata)
            }
        }
    }

    fun prepareNextTrack(url: String, metadata: TrackMetadataPayload, cacheKey: String? = null) {
        mainHandler.post {
            nextMediaItem = buildMediaItem(url, metadata, null, cacheKey)
        }
    }

    fun clearNextTrack() {
        mainHandler.post { nextMediaItem = null }
    }

    fun play() = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        exoPlayer.play()
        animateVolume(0f, targetVolume, 220L)
        syncWidgetState()
    }

    fun pause() = mainHandler.post {
        if (!::exoPlayer.isInitialized) return@post
        if (!exoPlayer.isPlaying) {
            exoPlayer.pause()
            exoPlayer.volume = targetVolume
            syncWidgetState()
            return@post
        }
        val startVol = exoPlayer.volume.coerceIn(0f, 1f)
        animateVolume(startVol, 0f, 220L) {
            exoPlayer.pause()
            exoPlayer.volume = targetVolume
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
            syncWidgetState()
        }
    }

    fun stopPlayback() = mainHandler.post {
        cancelFade()
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        exoPlayer.volume = targetVolume
        syncWidgetState()
    }

    fun seekTo(positionMs: Long) = mainHandler.post {
        val safePos = positionMs.coerceAtLeast(0L)
        exoPlayer.seekTo(safePos)
        val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L }
            ?: (currentMetadata?.durationMs ?: 0L)
        bridgeListener?.onTimeUpdate(safePos, dur, exoPlayer.isPlaying, currentTrackSeq)
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
        }
    }

    fun setPlayModeState(mode: String) = mainHandler.post {
        if (currentPlayMode != mode) {
            currentPlayMode = mode
            refreshCustomNotificationButtons()
        }
    }

    fun setEqPreset(preset: String) = mainHandler.post {
        audioEffects.attachToSession(exoPlayer.audioSessionId)
        audioEffects.applyPreset(preset)
    }

    fun setLiveLyric(lyricLine: String) = mainHandler.post {
        val clean = lyricLine.trim()
        if (clean == currentLiveLyric) return@post
        currentLiveLyric = clean
        val meta = currentMetadata ?: return@post
        val currentItem = exoPlayer.currentMediaItem ?: return@post
        val updated = currentItem.buildUpon()
            .setMediaMetadata(buildMediaMetadata(meta, currentArtworkBytes))
            .build()
        exoPlayer.replaceMediaItem(exoPlayer.currentMediaItemIndex, updated)
    }

    fun updateMetadata(metadata: TrackMetadataPayload) {
        mainHandler.post {
            currentMetadata = metadata
            val currentItem = exoPlayer.currentMediaItem ?: return@post
            val updated = currentItem.buildUpon()
                .setMediaMetadata(buildMediaMetadata(metadata, currentArtworkBytes))
                .build()
            exoPlayer.replaceMediaItem(exoPlayer.currentMediaItemIndex, updated)
            syncWidgetState()
            if (!metadata.coverUrl.isNullOrBlank() && currentArtworkBytes == null) {
                fetchAndApplyArtwork(metadata.coverUrl, currentTrackSeq, metadata)
            }
        }
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
        mainHandler.post { bridgeListener?.onMediaCommand("next", null) }
    }

    fun handleWidgetPrev() {
        mainHandler.post { bridgeListener?.onMediaCommand("previous", null) }
    }

    private fun syncWidgetState() {
        val meta = currentMetadata
        val playing = if (::exoPlayer.isInitialized) exoPlayer.isPlaying else false
        PureToneWidgetProvider.updateAll(
            context = this,
            title = meta?.title ?: getString(R.string.app_name),
            artist = meta?.artist ?: "轻触开始聆听",
            isPlaying = playing,
            artwork = currentArtworkBitmap,
        )
    }

    fun snapshotState(): Map<String, Any> {
        val isPlaying = if (::exoPlayer.isInitialized) exoPlayer.isPlaying else false
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
                } else if (!meta.coverUrl.isNullOrBlank()) {
                    setArtworkUri(Uri.parse(meta.coverUrl))
                }
            }
            .build()
    }

    private fun buildMediaItem(
        url: String,
        meta: TrackMetadataPayload,
        artworkBytes: ByteArray?,
        cacheKey: String?,
    ): MediaItem {
        return MediaItem.Builder()
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
                        val currentItem = exoPlayer.currentMediaItem ?: return@post
                        val updated = currentItem.buildUpon()
                            .setMediaMetadata(buildMediaMetadata(meta, bytes))
                            .build()
                        exoPlayer.replaceMediaItem(exoPlayer.currentMediaItemIndex, updated)
                        syncWidgetState()
                    }
                }
            } catch (_: Exception) {
                // Non-fatal
            }
        }
    }

    companion object {
        const val MEDIA_CHANNEL_ID = "puretone_media_playback"
        const val MAX_AUDIO_CACHE_BYTES = 300L * 1024L * 1024L
        const val ACTION_TOGGLE_FAVORITE = "com.xhd2005.puretone.ACTION_TOGGLE_FAVORITE"
        const val ACTION_CYCLE_PLAY_MODE = "com.xhd2005.puretone.ACTION_CYCLE_PLAY_MODE"
        private const val DEFAULT_NOTIFICATION_ACCENT = 0xFF8A1C32.toInt()

        val CMD_TOGGLE_FAVORITE by lazy { SessionCommand(ACTION_TOGGLE_FAVORITE, Bundle.EMPTY) }
        val CMD_CYCLE_PLAY_MODE by lazy { SessionCommand(ACTION_CYCLE_PLAY_MODE, Bundle.EMPTY) }

        @Volatile
        var activeService: EchoPlaybackService? = null

        @Volatile
        var bridgeListener: PlayerBridgeListener? = null

        @Volatile
        private var sharedAudioCache: SimpleCache? = null

        /**
         * Studio-tuned EQ gain curves (in millibels, 100 mB = 1 dB) mapped dynamically
         * onto any Android device's equalizer center frequencies.
         */
        fun computeEqBandGains(preset: String, centerFreqsHz: IntArray): IntArray {
            return IntArray(centerFreqsHz.size) { idx ->
                val hz = centerFreqsHz[idx]
                when (preset) {
                    "vocal" -> when {
                        hz <= 150 -> -180
                        hz <= 500 -> 80
                        hz <= 2500 -> 340
                        hz <= 6000 -> 240
                        else -> 80
                    }
                    "bass" -> when {
                        hz <= 120 -> 480
                        hz <= 350 -> 300
                        hz <= 1200 -> 40
                        hz <= 4500 -> 80
                        else -> 140
                    }
                    "night" -> when {
                        hz <= 150 -> 220
                        hz <= 500 -> 120
                        hz <= 2500 -> -60
                        hz <= 6000 -> -240
                        else -> -360
                    }
                    "live" -> when {
                        hz <= 140 -> 280
                        hz <= 500 -> -80
                        hz <= 2000 -> 140
                        hz <= 6000 -> 320
                        else -> 360
                    }
                    else -> 0
                }
            }
        }

        /**
         * Pure RGB picker (unit-testable on JVM without Android Graphics) selecting a tasteful,
         * rich darkened accent color suitable for white media notification controls.
         */
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
            // Gently deepen overly bright colors so white notification icons maintain crisp contrast
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
            val evictor = LeastRecentlyUsedCacheEvictor(MAX_AUDIO_CACHE_BYTES)
            val dbProvider = StandaloneDatabaseProvider(appContext)
            return SimpleCache(cacheDir, evictor, dbProvider).also {
                sharedAudioCache = it
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
