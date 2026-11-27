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
import com.xhd2005.puretone.player.QueuedTrackEntry
import com.xhd2005.puretone.player.TrackMetadataPayload
import org.json.JSONObject

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
        val queueIndex = call.getInt("queueIndex") ?: -1
        val startPositionMs = (
            call.getInt("startPositionMs")?.toLong()
                ?: call.getDouble("startPositionMs")?.toLong()
                ?: 0L
            ).coerceAtLeast(0L)
        val isRecovery = call.getBoolean("isRecovery", false) ?: false

        startForegroundPlaybackServiceSafe()
        ensureServiceBound { svc ->
            svc.loadTrack(url, headers, metadata, autoPlay, trackSeq, cacheKey, queueIndex, startPositionMs, isRecovery)
            call.resolve()
        }
    }

    @PluginMethod
    fun syncUpcomingTracks(call: PluginCall) {
        val rawArr = call.getArray("tracks")
        val entries = mutableListOf<QueuedTrackEntry>()
        if (rawArr != null) {
            for (i in 0 until rawArr.length()) {
                val itemObj = rawArr.optJSONObject(i) ?: continue
                val url = itemObj.optString("url", "").trim()
                if (url.isEmpty()) continue
                val metaJson = itemObj.optJSONObject("metadata")
                val cover = metaJson?.optString("coverUrl", "")?.takeIf { it.isNotBlank() && it != "null" }
                val meta = TrackMetadataPayload(
                    title = metaJson?.optString("title", "未知歌曲") ?: "未知歌曲",
                    artist = metaJson?.optString("artist", "未知歌手") ?: "未知歌手",
                    album = metaJson?.optString("album", "") ?: "",
                    coverUrl = cover,
                    durationMs = metaJson?.optLong("durationMs", 0L) ?: 0L,
                )
                val headersMap = mutableMapOf<String, String>()
                val hJson: JSONObject? = itemObj.optJSONObject("headers")
                if (hJson != null) {
                    val keys = hJson.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        if (!hJson.isNull(k)) headersMap[k] = hJson.optString(k, "")
                    }
                }
                val qIdx = itemObj.optInt("queueIndex", -1)
                val cKey = itemObj.optString("cacheKey", "").takeIf { it.isNotBlank() && it != "null" }
                val mId = itemObj.optString("mediaId", "").takeIf { it.isNotBlank() }
                    ?: "pt_up_${i}_${qIdx}_${meta.title.hashCode()}"
                entries.add(
                    QueuedTrackEntry(
                        mediaId = mId,
                        queueIndex = qIdx,
                        url = url,
                        headers = headersMap,
                        metadata = meta,
                        cacheKey = cKey,
                    ),
                )
            }
        }
        ensureServiceBound { svc ->
            svc.syncUpcomingTracks(entries)
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
        val headers = parseHeaders(call.getObject("headers"))
        val metadata = parseMetadata(call.getObject("metadata"))
        val cacheKey = call.getString("cacheKey")?.takeIf { it.isNotBlank() }
        val queueIndex = call.getInt("queueIndex") ?: -1
        ensureServiceBound { svc ->
            svc.prepareNextTrack(url, headers, metadata, cacheKey, queueIndex)
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
    fun setTransitionFadeMs(call: PluginCall) {
        val fadeMs = call.getInt("fadeMs") ?: 1500
        ensureServiceBound { svc ->
            svc.setTransitionFadeMs(fadeMs)
            call.resolve()
        }
    }

    @PluginMethod
    fun setVolumeLeveling(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        ensureServiceBound { svc ->
            svc.setVolumeLeveling(enabled)
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
        val appCtx = context.applicationContext
        val bytes = EchoPlaybackService.getAudioCacheSizeBytes(appCtx)
        val maxMb = EchoPlaybackService.getAudioCacheMaxMb(appCtx)
        val maxBytes = EchoPlaybackService.audioCacheMbToBytes(maxMb)
        call.resolve(
            JSObject()
                .put("usedBytes", bytes)
                .put("maxBytes", maxBytes)
                .put("maxMb", maxMb),
        )
    }

    @PluginMethod
    fun setAudioCacheMaxMb(call: PluginCall) {
        val rawMb = call.getInt("maxMb") ?: EchoPlaybackService.DEFAULT_AUDIO_CACHE_MAX_MB
        val appCtx = context.applicationContext
        Thread {
            val maxBytes = EchoPlaybackService.setAudioCacheMaxMb(appCtx, rawMb)
            val usedBytes = EchoPlaybackService.getAudioCacheSizeBytes(appCtx)
            val cleanMb = EchoPlaybackService.sanitizeAudioCacheMaxMb(rawMb)
            call.resolve(
                JSObject()
                    .put("usedBytes", usedBytes)
                    .put("maxBytes", maxBytes)
                    .put("maxMb", cleanMb),
            )
        }.start()
    }

    @PluginMethod
    fun isTrackCached(call: PluginCall) {
        val cacheKey = call.getString("cacheKey")?.trim() ?: ""
        val appCtx = context.applicationContext
        Thread {
            val cached = EchoPlaybackService.isTrackCached(appCtx, cacheKey)
            call.resolve(JSObject().put("cached", cached))
        }.start()
    }

    @PluginMethod
    fun removeCachedTrack(call: PluginCall) {
        val cacheKey = call.getString("cacheKey")?.trim() ?: ""
        val appCtx = context.applicationContext
        Thread {
            val removed = EchoPlaybackService.removeAudioCacheKey(appCtx, cacheKey)
            call.resolve(JSObject().put("removed", removed))
        }.start()
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

    override fun onNativeTrackAdvanced(queueIndex: Int, trackSeq: Int) {
        notifyListeners(
            "trackAutoAdvanced",
            JSObject()
                .put("queueIndex", queueIndex)
                .put("trackSeq", trackSeq),
        )
    }

    override fun onPlaybackRecoveryNeeded(
        reason: String,
        positionMs: Long,
        errorCode: String,
        message: String,
        trackSeq: Int,
    ) {
        notifyListeners(
            "playbackRecovery",
            JSObject()
                .put("reason", reason)
                .put("positionMs", positionMs)
                .put("errorCode", errorCode)
                .put("message", message)
                .put("trackSeq", trackSeq),
        )
    }
}
