package com.xhd2005.puretone.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.HapticFeedbackConstants
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private class PureToneKvDbHelper(context: Context) :
    SQLiteOpenHelper(context, "puretone_kv.db", null, 1) {

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS kv_store (
                k TEXT PRIMARY KEY NOT NULL,
                v TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
}

@CapacitorPlugin(
    name = "EchoSystem",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class EchoSystemPlugin : Plugin() {

    private lateinit var dbHelper: PureToneKvDbHelper
    private val updateExecutor = Executors.newSingleThreadExecutor()
    private val updateHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private var latestInsets: JSObject = JSObject().apply {
        put("top", 0)
        put("bottom", 0)
        put("left", 0)
        put("right", 0)
        put("imeBottom", 0)
    }

    override fun load() {
        super.load()
        instance = this
        dbHelper = PureToneKvDbHelper(context.applicationContext)
        cleanupLegacyDailyReminder()

        activity?.runOnUiThread {
            val root = activity.window?.decorView ?: return@runOnUiThread
            ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
                val sysBars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
                )
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                val density = context.resources.displayMetrics.density.coerceAtLeast(1f)
                val payload = JSObject().apply {
                    put("top", Math.round(sysBars.top / density))
                    put("bottom", Math.round(sysBars.bottom / density))
                    put("left", Math.round(sysBars.left / density))
                    put("right", Math.round(sysBars.right / density))
                    put("imeBottom", Math.round(ime.bottom / density))
                }
                latestInsets = payload
                notifyListeners("insetsChange", payload, true)
                insets
            }
            ViewCompat.requestApplyInsets(root)
        }
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        if (::dbHelper.isInitialized) dbHelper.close()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun kvGet(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("Missing key")
        var value: String? = null
        dbHelper.readableDatabase.rawQuery("SELECT v FROM kv_store WHERE k = ?", arrayOf(key)).use { c ->
            if (c.moveToFirst()) value = c.getString(0)
        }
        call.resolve(JSObject().put("value", value))
    }

    @PluginMethod
    fun kvSet(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("Missing key")
        val value = call.getString("value") ?: ""
        val cv = ContentValues().apply {
            put("k", key)
            put("v", value)
            put("updated_at", System.currentTimeMillis())
        }
        dbHelper.writableDatabase.insertWithOnConflict("kv_store", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        call.resolve()
    }

    @PluginMethod
    fun kvDelete(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("Missing key")
        dbHelper.writableDatabase.delete("kv_store", "k = ?", arrayOf(key))
        call.resolve()
    }

    @PluginMethod
    fun kvKeys(call: PluginCall) {
        val prefix = call.getString("prefix") ?: ""
        val keys = JSArray()
        val sql = if (prefix.isEmpty()) "SELECT k FROM kv_store" else "SELECT k FROM kv_store WHERE k LIKE ?"
        val args = if (prefix.isEmpty()) null else arrayOf("$prefix%")
        dbHelper.readableDatabase.rawQuery(sql, args).use { c ->
            while (c.moveToNext()) keys.put(c.getString(0))
        }
        call.resolve(JSObject().put("keys", keys))
    }

    @PluginMethod
    fun getInsets(call: PluginCall) {
        call.resolve(latestInsets)
    }

    @PluginMethod
    fun setStatusBarStyle(call: PluginCall) {
        val darkIcons = call.getBoolean("darkIcons", false) ?: false
        activity?.runOnUiThread {
            val window = activity.window ?: return@runOnUiThread
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.isAppearanceLightStatusBars = darkIcons
            controller.isAppearanceLightNavigationBars = darkIcons
        }
        call.resolve()
    }

    @PluginMethod
    fun haptic(call: PluginCall) {
        val style = call.getString("style") ?: "light"
        activity?.runOnUiThread {
            val view = activity.window?.decorView ?: return@runOnUiThread
            val constant = when (style) {
                "selection" -> HapticFeedbackConstants.CLOCK_TICK
                "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
                "heavy" -> HapticFeedbackConstants.LONG_PRESS
                "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    HapticFeedbackConstants.CONFIRM
                } else {
                    HapticFeedbackConstants.KEYBOARD_TAP
                }
                else -> HapticFeedbackConstants.KEYBOARD_TAP
            }
            @Suppress("DEPRECATION")
            view.performHapticFeedback(constant, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING)
        }
        call.resolve()
    }

    @PluginMethod
    fun moveToBackground(call: PluginCall) {
        activity?.runOnUiThread {
            activity.moveTaskToBack(true)
        }
        call.resolve()
    }

    @PluginMethod
    fun getLaunchFlags(call: PluginCall) {
        val pkgInfo = try {
            context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (_: Exception) {
            null
        }
        val openNowPlaying = pendingOpenNowPlaying
        pendingOpenNowPlaying = false

        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkgInfo?.longVersionCode?.toInt() ?: 15
        } else {
            @Suppress("DEPRECATION")
            pkgInfo?.versionCode ?: 15
        }
        call.resolve(
            JSObject()
                .put("openNowPlaying", openNowPlaying)
                .put("versionName", pkgInfo?.versionName ?: "2.4.8")
                .put("versionCode", versionCode),
        )
    }

    @PluginMethod
    fun checkNotificationPermission(call: PluginCall) {
        val systemEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val runtimeGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        call.resolve(
            JSObject()
                .put("granted", systemEnabled && runtimeGranted)
                .put("systemEnabled", systemEnabled)
                .put("runtimeGranted", runtimeGranted),
        )
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("granted", NotificationManagerCompat.from(context).areNotificationsEnabled()))
            return
        }
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback")
        }
    }

    @PermissionCallback
    private fun notificationsPermissionCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    @PluginMethod
    fun openAppNotificationSettings(call: PluginCall) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: Exception) {
            call.resolve(JSObject().put("opened", false))
        }
    }

    @PluginMethod
    fun checkOverlayPermission(call: PluginCall) {
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
        call.resolve(JSObject().put("granted", granted))
    }

    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}"),
                )
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(fallback)
                call.resolve(JSObject().put("opened", true))
            } catch (_: Exception) {
                call.resolve(JSObject().put("opened", false))
            }
        }
    }

    @PluginMethod
    fun openAppDetailsSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: Exception) {
            call.resolve(JSObject().put("opened", false))
        }
    }

    @PluginMethod
    fun openExternalUrl(call: PluginCall) {
        val url = call.getString("url")?.trim() ?: ""
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.resolve(JSObject().put("opened", false))
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (_: Exception) {
            call.resolve(JSObject().put("opened", false))
        }
    }

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) {
        val candidateList = mutableListOf<Pair<String, String>>()
        val rawCandidates = call.getArray("candidates")
        if (rawCandidates != null) {
            for (i in 0 until rawCandidates.length()) {
                val obj = rawCandidates.optJSONObject(i) ?: continue
                val u = obj.optString("url", "").trim()
                val lbl = obj.optString("label", "").trim().ifEmpty { "线路 ${i + 1}" }
                if (u.startsWith("http://") || u.startsWith("https://")) {
                    candidateList.add(u to lbl)
                }
            }
        }
        val fallbackUrl = call.getString("url")?.trim() ?: ""
        if (candidateList.isEmpty() && (fallbackUrl.startsWith("http://") || fallbackUrl.startsWith("https://"))) {
            candidateList.add(fallbackUrl to "GitHub")
        }
        if (candidateList.isEmpty()) {
            call.resolve(JSObject().put("started", false).put("message", "无效的更新包地址"))
            return
        }
        val expectedSha256 = call.getString("expectedSha256")?.trim()?.lowercase().orEmpty()
        val rawName = call.getString("fileName")?.trim().orEmpty()
        val safeName = if (rawName.endsWith(".apk", ignoreCase = true)) {
            rawName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        } else {
            "MELUNE-update.apk"
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            try {
                val permIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(permIntent)
            } catch (_: Exception) {
                // ignore
            }
            call.resolve(
                JSObject()
                    .put("started", false)
                    .put("needsInstallPermission", true)
                    .put("message", "请先开启「允许安装未知应用」，返回后再点击立即安装"),
            )
            return
        }

        call.resolve(JSObject().put("started", true).put("needsInstallPermission", false))

        updateExecutor.execute {
            val updatesDir = File(context.cacheDir, "updates")
            if (!updatesDir.exists()) updatesDir.mkdirs()
            val apkFile = File(updatesDir, safeName)
            var lastError = "所有更新线路均暂不可达，请稍后重试或点击浏览器加速下载"

            for ((idx, pair) in candidateList.withIndex()) {
                val (targetUrl, nodeLabel) = pair
                if (apkFile.exists()) apkFile.delete()
                notifyUpdateProgress(0L, 0L, if (idx == 0) 2 else 4, false, nodeLabel, null)

                try {
                    val req = Request.Builder()
                        .url(targetUrl)
                        .header("User-Agent", "MELUNE-Android/2.4.8")
                        .build()
                    val downloadedOk = updateHttpClient.newCall(req).execute().use { res ->
                        if (!res.isSuccessful) {
                            lastError = "$nodeLabel 失败（HTTP ${res.code}）"
                            return@use false
                        }
                        val body = res.body ?: run {
                            lastError = "$nodeLabel 响应为空"
                            return@use false
                        }
                        val total = body.contentLength().coerceAtLeast(0L)
                        var downloaded = 0L
                        var lastEmit = 0L
                        val buf = ByteArray(16 * 1024)
                        val headerBytes = ByteArray(4)
                        var headerRead = 0
                        val shaDigest = MessageDigest.getInstance("SHA-256")

                        body.byteStream().use { input ->
                            FileOutputStream(apkFile).use { out ->
                                while (true) {
                                    val read = input.read(buf)
                                    if (read == -1) break
                                    if (headerRead < 4) {
                                        val copyLen = minOf(read, 4 - headerRead)
                                        System.arraycopy(buf, 0, headerBytes, headerRead, copyLen)
                                        headerRead += copyLen
                                        if (headerRead == 4 && !isValidApkHeader(headerBytes)) {
                                            lastError = "$nodeLabel 返回非 APK 内容，正在切换线路"
                                            return@use false
                                        }
                                    }
                                    out.write(buf, 0, read)
                                    shaDigest.update(buf, 0, read)
                                    downloaded += read
                                    val now = System.currentTimeMillis()
                                    if (now - lastEmit >= 160L) {
                                        lastEmit = now
                                        val pct = if (total > 0L) ((downloaded * 100L) / total).toInt().coerceIn(1, 99) else 0
                                        notifyUpdateProgress(downloaded, total, pct, false, nodeLabel, null)
                                    }
                                }
                                out.flush()
                            }
                        }

                        if (headerRead < 4 || !isValidApkHeader(headerBytes) || downloaded < 1024L * 100L) {
                            lastError = "$nodeLabel 安装包不完整，正在切换线路"
                            return@use false
                        }
                        if (expectedSha256.length == 64) {
                            val actualSha = shaDigest.digest().joinToString("") { "%02x".format(it) }
                            if (!actualSha.equals(expectedSha256, ignoreCase = true)) {
                                lastError = "$nodeLabel 完整性校验失败，正在切换安全线路"
                                return@use false
                            }
                        }

                        notifyUpdateProgress(downloaded, total.coerceAtLeast(downloaded), 100, true, nodeLabel, null)
                        true
                    }

                    if (downloadedOk) {
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(installIntent)
                        return@execute
                    }
                } catch (e: Exception) {
                    lastError = "$nodeLabel 连接失败：${e.message ?: "超时"}"
                } finally {
                    if (!apkFile.exists() || apkFile.length() < 1024L * 100L) {
                        apkFile.delete()
                    }
                }
            }

            if (apkFile.exists()) apkFile.delete()
            notifyUpdateProgress(0L, 0L, 0, false, null, lastError)
        }
    }

    private fun notifyUpdateProgress(
        downloadedBytes: Long,
        totalBytes: Long,
        percent: Int,
        done: Boolean,
        sourceLabel: String?,
        error: String?,
    ) {
        val obj = JSObject()
            .put("downloadedBytes", downloadedBytes)
            .put("totalBytes", totalBytes)
            .put("percent", percent)
            .put("done", done)
        if (!sourceLabel.isNullOrBlank()) obj.put("sourceLabel", sourceLabel)
        if (!error.isNullOrBlank()) obj.put("error", error)
        notifyListeners("updateDownloadProgress", obj)
    }

    private fun cleanupLegacyDailyReminder() {
        try {
            val intent = Intent().setComponent(
                ComponentName(context.packageName, "com.xhd2005.puretone.plugins.VipReminderReceiver"),
            )
            val pi = PendingIntent.getBroadcast(
                context,
                LEGACY_REMINDER_ALARM_REQ_CODE,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            if (pi != null) {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                alarmManager.cancel(pi)
                pi.cancel()
            }
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(LEGACY_REMINDER_NOTIFICATION_ID)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.deleteNotificationChannel(LEGACY_REMINDER_CHANNEL_ID)
            }
        } catch (_: Exception) {
            // non-fatal legacy cleanup
        }
    }

    @PluginMethod
    fun copyToClipboard(call: PluginCall) {
        val text = call.getString("text") ?: ""
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("MELUNE", text))
        call.resolve()
    }

    @PluginMethod
    fun isWeChatInstalled(call: PluginCall) {
        call.resolve(JSObject().put("installed", isPackageInstalled(WECHAT_PKG)))
    }

    @PluginMethod
    fun launchKugouWithQr(call: PluginCall) {
        val rawB64 = call.getString("base64Image")?.trim() ?: ""
        val saved = if (rawB64.isNotEmpty()) {
            val cleanB64 = rawB64.substringAfter("base64,", rawB64)
            try {
                val bytes = Base64.decode(cleanB64, Base64.DEFAULT)
                saveImageToGallery(bytes, "puretone_kugou_qr_${System.currentTimeMillis()}.png", "image/png")
            } catch (_: Exception) {
                false
            }
        } else {
            false
        }

        val targetPkg = when {
            isPackageInstalled(KUGOU_LITE_PKG) -> KUGOU_LITE_PKG
            isPackageInstalled(KUGOU_MAIN_PKG) -> KUGOU_MAIN_PKG
            else -> null
        }

        if (targetPkg == null) {
            call.resolve(
                JSObject()
                    .put("launched", false)
                    .put("savedToGallery", saved)
                    .put("appName", "")
                    .put("message", if (saved) "二维码已存至相册首张，未检测到酷狗客户端" else "未检测到酷狗客户端"),
            )
            return
        }

        val appLabel = if (targetPkg == KUGOU_LITE_PKG) "酷狗概念版" else "酷狗音乐"
        val launched = try {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(targetPkg)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launchIntent)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }

        call.resolve(
            JSObject()
                .put("launched", launched)
                .put("savedToGallery", saved)
                .put("appName", appLabel)
                .put("message", if (launched) "已存相册首张并打开$appLabel，点扫一扫选取相册即可登录" else "无法唤起$appLabel"),
        )
    }

    @PluginMethod
    fun launchWeChatScanWithQr(call: PluginCall) {
        val rawB64 = call.getString("base64Image")?.trim() ?: ""
        if (rawB64.isEmpty()) {
            call.reject("Missing base64Image")
            return
        }
        val cleanB64 = rawB64.substringAfter("base64,", rawB64)
        val bytes = try {
            Base64.decode(cleanB64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("Invalid base64 image", e)
            return
        }

        val saved = saveImageToGallery(bytes, "puretone_wx_login_${System.currentTimeMillis()}.jpg", "image/jpeg")

        if (!isPackageInstalled(WECHAT_PKG)) {
            call.resolve(
                JSObject()
                    .put("launched", false)
                    .put("savedToGallery", saved)
                    .put("message", "未检测到微信客户端"),
            )
            return
        }

        val launched = try {
            val scanIntent = Intent().apply {
                component = ComponentName(WECHAT_PKG, "com.tencent.mm.ui.LauncherUI")
                action = Intent.ACTION_VIEW
                putExtra("LauncherUI.From.Scaner.Shortcut", true)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(scanIntent)
            true
        } catch (_: Exception) {
            try {
                val launchIntent = context.packageManager.getLaunchIntentForPackage(WECHAT_PKG)
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(launchIntent)
                    true
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }

        call.resolve(
            JSObject()
                .put("launched", launched)
                .put("savedToGallery", saved)
                .put("message", if (launched) "已保存至相册首张并打开微信" else "无法唤起微信"),
        )
    }

    @PluginMethod
    fun saveImageToGallery(call: PluginCall) {
        val rawB64 = call.getString("base64Image")?.trim() ?: ""
        if (rawB64.isEmpty()) {
            call.reject("Missing base64Image")
            return
        }
        val cleanB64 = rawB64.substringAfter("base64,", rawB64)
        val bytes = try {
            Base64.decode(cleanB64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("Invalid base64 image", e)
            return
        }
        val rawName = call.getString("fileName")?.trim().takeIf { !it.isNullOrBlank() }
            ?: "MELUNE_Poster_${System.currentTimeMillis()}.png"
        val safeName = rawName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val mime = if (safeName.endsWith(".jpg", true) || safeName.endsWith(".jpeg", true)) "image/jpeg" else "image/png"
        val saved = saveImageToGallery(bytes, safeName, mime)
        call.resolve(JSObject().put("saved", saved))
    }

    @PluginMethod
    fun shareImage(call: PluginCall) {
        val rawB64 = call.getString("base64Image")?.trim() ?: ""
        if (rawB64.isEmpty()) {
            call.reject("Missing base64Image")
            return
        }
        val cleanB64 = rawB64.substringAfter("base64,", rawB64)
        val bytes = try {
            Base64.decode(cleanB64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("Invalid base64 image", e)
            return
        }
        val title = call.getString("title")?.trim().takeIf { !it.isNullOrBlank() } ?: "分享歌词海报"
        try {
            val cacheFile = File(context.cacheDir, "puretone_share_poster.png")
            cacheFile.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", cacheFile)
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooser = Intent.createChooser(shareIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            call.resolve(JSObject().put("launched", true))
        } catch (e: Exception) {
            call.resolve(JSObject().put("launched", false).put("message", e.message ?: "无法调起系统分享"))
        }
    }

    @PluginMethod
    fun shareQrToWeChat(call: PluginCall) {
        val rawB64 = call.getString("base64Image")?.trim() ?: ""
        if (rawB64.isEmpty()) {
            call.reject("Missing base64Image")
            return
        }
        val cleanB64 = rawB64.substringAfter("base64,", rawB64)
        val bytes = try {
            Base64.decode(cleanB64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("Invalid base64 image", e)
            return
        }

        try {
            val cacheFile = File(context.cacheDir, "wx_login_qr.jpg")
            cacheFile.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", cacheFile)

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "image/jpeg"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            if (isPackageInstalled(WECHAT_PKG)) {
                try {
                    val wxDirect = Intent(shareIntent).apply {
                        component = ComponentName(WECHAT_PKG, "com.tencent.mm.ui.tools.ShareImgUI")
                    }
                    context.startActivity(wxDirect)
                    call.resolve(JSObject().put("launched", true).put("message", "已唤起微信分享，请发给文件传输助手并长按识别"))
                    return
                } catch (_: Exception) {
                    // Fallback to generic chooser
                }
            }

            val chooser = Intent.createChooser(shareIntent, "发送到微信完成授权").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            call.resolve(JSObject().put("launched", true).put("message", "请选择微信发送并长按识别登录"))
        } catch (e: Exception) {
            call.resolve(JSObject().put("launched", false).put("message", "唤起微信分享失败：${e.message}"))
        }
    }

    private fun isPackageInstalled(pkg: String): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(pkg, 0)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun saveImageToGallery(bytes: ByteArray, fileName: String, mimeType: String): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/MELUNE")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                true
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "MELUNE")
                if (!dir.exists()) dir.mkdirs()
                val file = File(dir, fileName)
                file.writeBytes(bytes)
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val WECHAT_PKG = "com.tencent.mm"
        private const val KUGOU_LITE_PKG = "com.kugou.android.lite"
        private const val KUGOU_MAIN_PKG = "com.kugou.android"
        private const val LEGACY_REMINDER_CHANNEL_ID = "puretone_daily_vip_reminder"
        private const val LEGACY_REMINDER_NOTIFICATION_ID = 202611
        private const val LEGACY_REMINDER_ALARM_REQ_CODE = 202613

        @Volatile
        private var instance: EchoSystemPlugin? = null

        @Volatile
        var pendingOpenNowPlaying: Boolean = false

        fun dispatchHardwareBack(): Boolean {
            val plugin = instance ?: return false
            if (!plugin.hasListeners("hardwareBack")) return false
            plugin.notifyListeners("hardwareBack", JSObject())
            return true
        }

        fun dispatchOpenNowPlayingIntent() {
            val plugin = instance
            if (plugin != null && plugin.hasListeners("openNowPlayingIntent")) {
                plugin.notifyListeners("openNowPlayingIntent", JSObject())
            } else {
                pendingOpenNowPlaying = true
            }
        }

        /**
         * Validates standard ZIP/APK magic header (PK\x03\x04) to reject HTML proxy error pages.
         */
        fun isValidApkHeader(header: ByteArray): Boolean {
            return header.size >= 4 &&
                header[0] == 0x50.toByte() &&
                header[1] == 0x4B.toByte() &&
                header[2] == 0x03.toByte() &&
                header[3] == 0x04.toByte()
        }

        fun sha256Hex(data: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(data)
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
