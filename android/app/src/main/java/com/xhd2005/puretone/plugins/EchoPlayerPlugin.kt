package com.xhd2005.puretone.plugins

import android.content.ComponentName
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture
import com.xhd2005.puretone.player.EchoPlaybackService
import com.xhd2005.puretone.player.PlayerBridgeListener
import com.xhd2005.puretone.player.TrackMetadataPayload

@OptIn(UnstableApi::class)
@CapacitorPlugin(name = "EchoPlayer")
class EchoPlayerPlugin : Plugin(), PlayerBridgeListener {

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun load() {
        super.load()
        EchoPlaybackService.bridgeListener = this
        ensureServiceBound {}
    }

    override fun handleOnDestroy() {
        if (EchoPlaybackService.bridgeListener === this) {
            EchoPlaybackService.bridgeListener = null
        }
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        super.handleOnDestroy()
    }

    private fun startForegroundPlaybackServiceSafe() {
        try {
            val intent = Intent(context, EchoPlaybackService::class.java)
            ContextCompat.startForegroundService(context, intent)
        } catch (_: Exception) {
            // Fallback to MediaController bind when OS restricts background FGS start
        }
    }

    private fun ensureServiceBound(onReady: (EchoPlaybackService) -> Unit) {
        EchoPlaybackService.activeService?.let {
            onReady(it)
            return
        }
        mainHandler.post {
            if (controllerFuture == null) {
                val token = SessionToken(context, ComponentName(context, EchoPlaybackService::class.java))
                controllerFuture = MediaController.Builder(context, token).buildAsync()
            }
            controllerFuture?.addListener(
                {
                    val svc = EchoPlaybackService.activeService
                    if (svc != null) {
                        onReady(svc)
                    } else {
                        mainHandler.postDelayed({
                            EchoPlaybackService.activeService?.let(onReady)
                        }, 150L)
                    }
                },
                ContextCompat.getMainExecutor(context),
            )
        }
    }

    private fun parseMetadata(obj: JSObject?): TrackMetadataPayload {
        val cover = if (obj != null && !obj.isNull("coverUrl")) {
            obj.optString("coverUrl", "").takeIf { it.isNotBlank() }
        } else {
            null
        }
        return TrackMetadataPayload(
            title = obj?.optString("title", "未知歌曲") ?: "未知歌曲",
            artist = obj?.optString("artist", "未知歌手") ?: "未知歌手",
            album = obj?.optString("album", "") ?: "",
            coverUrl = cover,
            durationMs = obj?.optLong("durationMs", 0L) ?: 0L,
        )
    }

    private fun parseHeaders(obj: JSObject?): Map<String, String> {
        val map = mutableMapOf<String, String>()
        if (obj != null) {
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (!obj.isNull(k)) {
                    map[k] = obj.optString(k, "")
                }
            }
        }
        return map
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val url = call.getString("url")?.trim()
        if (url.isNullOrEmpty()) {
            call.reject("Missing url")
            return
        }
        val headers = parseHeaders(call.getObject("headers"))
        val metadata = parseMetadata(call.getObject("metadata"))
        val autoPlay = call.getBoolean("autoPlay", true) ?: true
        val trackSeq = call.getInt("trackSeq") ?: 0
        val cacheKey = call.getString("cacheKey")?.takeIf { it.isNotBlank() }

        startForegroundPlaybackServiceSafe()
        ensureServiceBound { svc ->
            svc.loadTrack(url, headers, metadata, autoPlay, trackSeq, cacheKey)
            call.resolve()
        }
    }

    @PluginMethod
    fun prepareNext(call: PluginCall) {
        val url = call.getString("url")?.trim()
        if (url.isNullOrEmpty()) {
            call.resolve()
            return
        }
        val metadata = parseMetadata(call.getObject("metadata"))
        val cacheKey = call.getString("cacheKey")?.takeIf { it.isNotBlank() }
        ensureServiceBound { svc ->
            svc.prepareNextTrack(url, metadata, cacheKey)
            call.resolve()
        }
    }

    @PluginMethod
    fun clearNext(call: PluginCall) {
        EchoPlaybackService.activeService?.clearNextTrack()
        call.resolve()
    }

    @PluginMethod
    fun play(call: PluginCall) {
        startForegroundPlaybackServiceSafe()
        ensureServiceBound { svc ->
            svc.play()
            call.resolve()
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        EchoPlaybackService.activeService?.pause()
        call.resolve()
    }

    @PluginMethod
    fun fadeOutAndPause(call: PluginCall) {
        val durationMs = call.getInt("durationMs")?.toLong() ?: 3000L
        EchoPlaybackService.activeService?.fadeOutAndPause(durationMs)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        EchoPlaybackService.activeService?.stopPlayback()
        call.resolve()
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        val positionMs = call.getInt("positionMs")?.toLong() ?: call.getDouble("positionMs")?.toLong() ?: 0L
        EchoPlaybackService.activeService?.seekTo(positionMs)
        call.resolve()
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getDouble("volume")?.toFloat() ?: 1f
        EchoPlaybackService.activeService?.setVolume(volume)
        call.resolve()
    }

    @PluginMethod
    fun setSpeed(call: PluginCall) {
        val speed = call.getDouble("speed")?.toFloat() ?: 1f
        EchoPlaybackService.activeService?.setSpeed(speed)
        call.resolve()
    }

    @PluginMethod
    fun setRepeatOne(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        EchoPlaybackService.activeService?.setRepeatOne(enabled)
        call.resolve()
    }

    @PluginMethod
    fun setFavoriteState(call: PluginCall) {
        val favorite = call.getBoolean("favorite", false) ?: false
        EchoPlaybackService.activeService?.setFavoriteState(favorite)
        call.resolve()
    }

    @PluginMethod
    fun setPlayModeState(call: PluginCall) {
        val mode = call.getString("mode") ?: "sequence"
        EchoPlaybackService.activeService?.setPlayModeState(mode)
        call.resolve()
    }

    @PluginMethod
    fun setLiveLyric(call: PluginCall) {
        val line = call.getString("line") ?: ""
        EchoPlaybackService.activeService?.setLiveLyric(line)
        call.resolve()
    }

    @PluginMethod
    fun setEqPreset(call: PluginCall) {
        val preset = call.getString("preset") ?: "flat"
        ensureServiceBound { svc ->
            svc.setEqPreset(preset)
            call.resolve()
        }
    }

    @PluginMethod
    fun updateMetadata(call: PluginCall) {
        val metadata = parseMetadata(call.data)
        EchoPlaybackService.activeService?.updateMetadata(metadata)
        call.resolve()
    }

    @PluginMethod
    fun getAudioCacheStats(call: PluginCall) {
        val bytes = EchoPlaybackService.getAudioCacheSizeBytes(context.applicationContext)
        call.resolve(
            JSObject()
                .put("usedBytes", bytes)
                .put("maxBytes", EchoPlaybackService.MAX_AUDIO_CACHE_BYTES),
        )
    }

    @PluginMethod
    fun clearAudioCache(call: PluginCall) {
        val ok = EchoPlaybackService.clearAudioCache(context.applicationContext)
        call.resolve(JSObject().put("cleared", ok))
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val svc = EchoPlaybackService.activeService
        if (svc == null) {
            call.resolve(
                JSObject()
                    .put("isPlaying", false)
                    .put("isBuffering", false)
                    .put("currentTimeMs", 0)
                    .put("durationMs", 0)
                    .put("volume", 1.0)
                    .put("speed", 1.0)
                    .put("repeatOne", false)
                    .put("trackSeq", 0),
            )
            return
        }
        mainHandler.post {
            val snap = svc.snapshotState()
            val out = JSObject()
            snap.forEach { (k, v) -> out.put(k, v) }
            call.resolve(out)
        }
    }

    override fun onTimeUpdate(currentTimeMs: Long, durationMs: Long, isPlaying: Boolean, trackSeq: Int) {
        notifyListeners(
            "timeUpdate",
            JSObject()
                .put("currentTimeMs", currentTimeMs)
                .put("durationMs", durationMs)
                .put("isPlaying", isPlaying)
                .put("trackSeq", trackSeq)
                .put("sampledAt", System.currentTimeMillis()),
        )
    }

    override fun onStateChange(isPlaying: Boolean, isBuffering: Boolean, ended: Boolean, trackSeq: Int) {
        notifyListeners(
            "stateChange",
            JSObject()
                .put("isPlaying", isPlaying)
                .put("isBuffering", isBuffering)
                .put("ended", ended)
                .put("trackSeq", trackSeq),
        )
    }

    override fun onError(code: String, message: String, trackSeq: Int) {
        notifyListeners(
            "playerError",
            JSObject()
                .put("code", code)
                .put("message", message)
                .put("trackSeq", trackSeq),
        )
    }

    override fun onMediaCommand(command: String, positionMs: Long?) {
        val data = JSObject().put("command", command)
        if (positionMs != null) data.put("positionMs", positionMs)
        notifyListeners("mediaCommand", data)
    }
}
