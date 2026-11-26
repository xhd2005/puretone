package com.xhd2005.echomusic.player

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.xhd2005.echomusic.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

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
class EchoPlaybackService : MediaSessionService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private lateinit var dataSourceFactory: OkHttpDataSource.Factory
    private lateinit var exoPlayer: ExoPlayer
    private var mediaSession: MediaSession? = null

    private var currentTrackSeq: Int = 0
    private var currentMetadata: TrackMetadataPayload? = null
    private var nextMediaItem: MediaItem? = null

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

    override fun onCreate() {
        super.onCreate()
        activeService = this

        dataSourceFactory = OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent("Android15-EchoMusic-Mobile/1.0")

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        exoPlayer.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                val buffering = exoPlayer.playbackState == Player.STATE_BUFFERING
                bridgeListener?.onStateChange(isPlaying, buffering, false, currentTrackSeq)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val buffering = playbackState == Player.STATE_BUFFERING
                val ended = playbackState == Player.STATE_ENDED
                if (ended) {
                    bridgeListener?.onStateChange(false, false, true, currentTrackSeq)
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
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                bridgeListener?.onError(
                    error.errorCodeName,
                    error.message ?: "音频解码或网络加载失败",
                    currentTrackSeq,
                )
            }
        })

        // Wrap ExoPlayer so system notification & Bluetooth headsets ALWAYS show Next & Previous
        // and delegate track switching to our JS queue store.
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
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        mediaSession = MediaSession.Builder(this, forwardingPlayer)
            .setSessionActivity(sessionActivityIntent)
            .build()

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
        mainHandler.removeCallbacks(timeTicker)
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

    fun loadTrack(
        url: String,
        headers: Map<String, String>,
        metadata: TrackMetadataPayload,
        autoPlay: Boolean,
        trackSeq: Int,
    ) {
        mainHandler.post {
            currentTrackSeq = trackSeq
            currentMetadata = metadata
            nextMediaItem = null
            dataSourceFactory.setDefaultRequestProperties(headers)

            val item = buildMediaItem(url, metadata, null)
            exoPlayer.setMediaItem(item)
            exoPlayer.prepare()
            exoPlayer.playWhenReady = autoPlay

            if (!metadata.coverUrl.isNullOrBlank()) {
                fetchAndApplyArtwork(metadata.coverUrl, trackSeq, metadata)
            }
        }
    }

    fun prepareNextTrack(url: String, metadata: TrackMetadataPayload) {
        mainHandler.post {
            nextMediaItem = buildMediaItem(url, metadata, null)
        }
    }

    fun clearNextTrack() {
        mainHandler.post { nextMediaItem = null }
    }

    fun play() = mainHandler.post { exoPlayer.play() }
    fun pause() = mainHandler.post { exoPlayer.pause() }
    fun stopPlayback() = mainHandler.post {
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
    }

    fun seekTo(positionMs: Long) = mainHandler.post {
        val safePos = positionMs.coerceAtLeast(0L)
        exoPlayer.seekTo(safePos)
        val dur = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it > 0L }
            ?: (currentMetadata?.durationMs ?: 0L)
        bridgeListener?.onTimeUpdate(safePos, dur, exoPlayer.isPlaying, currentTrackSeq)
    }

    fun setVolume(volume: Float) = mainHandler.post {
        exoPlayer.volume = volume.coerceIn(0f, 1f)
    }

    fun setSpeed(speed: Float) = mainHandler.post {
        exoPlayer.playbackParameters = PlaybackParameters(speed.coerceIn(0.5f, 2.0f))
    }

    fun setRepeatOne(enabled: Boolean) = mainHandler.post {
        exoPlayer.repeatMode = if (enabled) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    fun updateMetadata(metadata: TrackMetadataPayload) {
        mainHandler.post {
            currentMetadata = metadata
            val currentItem = exoPlayer.currentMediaItem ?: return@post
            val updated = currentItem.buildUpon()
                .setMediaMetadata(buildMediaMetadata(metadata, null))
                .build()
            exoPlayer.replaceMediaItem(exoPlayer.currentMediaItemIndex, updated)
            if (!metadata.coverUrl.isNullOrBlank()) {
                fetchAndApplyArtwork(metadata.coverUrl, currentTrackSeq, metadata)
            }
        }
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
            "volume" to (if (::exoPlayer.isInitialized) exoPlayer.volume.toDouble() else 1.0),
            "speed" to (if (::exoPlayer.isInitialized) exoPlayer.playbackParameters.speed.toDouble() else 1.0),
            "repeatOne" to (if (::exoPlayer.isInitialized) exoPlayer.repeatMode == Player.REPEAT_MODE_ONE else false),
            "trackSeq" to currentTrackSeq,
        )
    }

    private fun buildMediaMetadata(meta: TrackMetadataPayload, artworkBytes: ByteArray?): MediaMetadata {
        return MediaMetadata.Builder()
            .setTitle(meta.title)
            .setArtist(meta.artist)
            .setAlbumTitle(meta.album)
            .apply {
                if (artworkBytes != null && artworkBytes.isNotEmpty()) {
                    setArtworkData(artworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                } else if (!meta.coverUrl.isNullOrBlank()) {
                    setArtworkUri(Uri.parse(meta.coverUrl))
                }
            }
            .build()
    }

    private fun buildMediaItem(url: String, meta: TrackMetadataPayload, artworkBytes: ByteArray?): MediaItem {
        return MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMediaMetadata(buildMediaMetadata(meta, artworkBytes))
            .build()
    }

    private fun fetchAndApplyArtwork(coverUrl: String, trackSeq: Int, meta: TrackMetadataPayload) {
        serviceScope.launch {
            try {
                val req = Request.Builder().url(coverUrl).build()
                okHttpClient.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@launch
                    val bytes = res.body?.bytes() ?: return@launch
                    if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) return@launch
                    mainHandler.post {
                        if (trackSeq != currentTrackSeq || !::exoPlayer.isInitialized) return@post
                        val currentItem = exoPlayer.currentMediaItem ?: return@post
                        val updated = currentItem.buildUpon()
                            .setMediaMetadata(buildMediaMetadata(meta, bytes))
                            .build()
                        exoPlayer.replaceMediaItem(exoPlayer.currentMediaItemIndex, updated)
                    }
                }
            } catch (_: Exception) {
                // Non-fatal; fallback to artworkUri
            }
        }
    }

    companion object {
        @Volatile
        var activeService: EchoPlaybackService? = null

        @Volatile
        var bridgeListener: PlayerBridgeListener? = null
    }
}
