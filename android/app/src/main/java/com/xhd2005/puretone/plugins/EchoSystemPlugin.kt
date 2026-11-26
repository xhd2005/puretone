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
import java.util.Calendar
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
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
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
        val autoClaim = pendingAutoClaim
        pendingAutoClaim = false
        val openNowPlaying = pendingOpenNowPlaying
        pendingOpenNowPlaying = false

        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkgInfo?.longVersionCode?.toInt() ?: 2
        } else {
            @Suppress("DEPRECATION")
            pkgInfo?.versionCode ?: 2
        }
        call.resolve(
            JSObject()
                .put("autoClaim", autoClaim)
                .put("openNowPlaying", openNowPlaying)
                .put("versionName", pkgInfo?.versionName ?: "2.0.0")
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
        val url = call.getString("url")?.trim() ?: ""
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.resolve(JSObject().put("started", false).put("message", "无效的更新包地址"))
            return
        }
        val rawName = call.getString("fileName")?.trim().orEmpty()
        val safeName = if (rawName.endsWith(".apk", ignoreCase = true)) {
            rawName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        } else {
            "PureTone-update.apk"
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
            try {
                val updatesDir = File(context.cacheDir, "updates")
                if (!updatesDir.exists()) updatesDir.mkdirs()
                val apkFile = File(updatesDir, safeName)
                if (apkFile.exists()) apkFile.delete()

                val req = Request.Builder()
                    .url(url)
                    .header("User-Agent", "PureTone-Android/2.1")
                    .build()
                updateHttpClient.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) {
                        notifyUpdateProgress(0L, 0L, 0, false, "下载失败（HTTP ${res.code}）")
                        return@execute
                    }
                    val body = res.body ?: run {
                        notifyUpdateProgress(0L, 0L, 0, false, "安装包响应为空")
                        return@execute
                    }
                    val total = body.contentLength().coerceAtLeast(0L)
                    var downloaded = 0L
                    var lastEmit = 0L
                    val buf = ByteArray(16 * 1024)
                    body.byteStream().use { input ->
                        FileOutputStream(apkFile).use { out ->
                            while (true) {
                                val read = input.read(buf)
                                if (read == -1) break
                                out.write(buf, 0, read)
                                downloaded += read
                                val now = System.currentTimeMillis()
                                if (now - lastEmit >= 160L) {
                                    lastEmit = now
                                    val pct = if (total > 0L) ((downloaded * 100L) / total).toInt().coerceIn(0, 99) else 0
                                    notifyUpdateProgress(downloaded, total, pct, false, null)
                                }
                            }
                            out.flush()
                        }
                    }

                    notifyUpdateProgress(downloaded, total.coerceAtLeast(downloaded), 100, true, null)

                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
                    val installIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(installIntent)
                }
            } catch (e: Exception) {
                notifyUpdateProgress(0L, 0L, 0, false, e.message ?: "下载更新失败，请尝试浏览器下载")
            }
        }
    }

    private fun notifyUpdateProgress(
        downloadedBytes: Long,
        totalBytes: Long,
        percent: Int,
        done: Boolean,
        error: String?,
    ) {
        val obj = JSObject()
            .put("downloadedBytes", downloadedBytes)
            .put("totalBytes", totalBytes)
            .put("percent", percent)
            .put("done", done)
        if (!error.isNullOrBlank()) obj.put("error", error)
        notifyListeners("updateDownloadProgress", obj)
    }

    @PluginMethod
    fun scheduleDailyReminder(call: PluginCall) {
        val hour = (call.getInt("hour") ?: 9).coerceIn(0, 23)
        val minute = (call.getInt("minute") ?: 0).coerceIn(0, 59)

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        VipReminderReceiver.ensureChannel(nm)

        val triggerAt = computeNextTriggerMillis(hour, minute, System.currentTimeMillis())
        val intent = Intent(context, VipReminderReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            VipReminderReceiver.REQ_CODE_ALARM,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            triggerAt,
            AlarmManager.INTERVAL_DAY,
            pi,
        )
        call.resolve(JSObject().put("scheduled", true))
    }

    @PluginMethod
    fun cancelDailyReminder(call: PluginCall) {
        val intent = Intent(context, VipReminderReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            VipReminderReceiver.REQ_CODE_ALARM,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(pi)
        call.resolve()
    }

    @PluginMethod
    fun copyToClipboard(call: PluginCall) {
        val text = call.getString("text") ?: ""
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("PureTone", text))
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
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/PureTone")
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
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "PureTone")
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

        @Volatile
        private var instance: EchoSystemPlugin? = null

        @Volatile
        var pendingAutoClaim: Boolean = false

        @Volatile
        var pendingOpenNowPlaying: Boolean = false

        fun dispatchHardwareBack(): Boolean {
            val plugin = instance ?: return false
            if (!plugin.hasListeners("hardwareBack")) return false
            plugin.notifyListeners("hardwareBack", JSObject())
            return true
        }

        fun dispatchAutoClaimIntent() {
            val plugin = instance
            if (plugin != null && plugin.hasListeners("autoClaimIntent")) {
                plugin.notifyListeners("autoClaimIntent", JSObject())
            } else {
                pendingAutoClaim = true
            }
        }

        fun dispatchOpenNowPlayingIntent() {
            val plugin = instance
            if (plugin != null && plugin.hasListeners("openNowPlayingIntent")) {
                plugin.notifyListeners("openNowPlayingIntent", JSObject())
            } else {
                pendingOpenNowPlaying = true
            }
        }

        fun computeNextTriggerMillis(hour: Int, minute: Int, nowMillis: Long): Long {
            val cal = Calendar.getInstance().apply {
                timeInMillis = nowMillis
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (timeInMillis <= nowMillis) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }
            return cal.timeInMillis
        }
    }
}
