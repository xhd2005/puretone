package com.xhd2005.echomusic.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Build
import androidx.core.content.ContextCompat
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
import java.util.Calendar

private class EchoKvDbHelper(context: Context) :
    SQLiteOpenHelper(context, "echo_mobile_kv.db", null, 1) {

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

    private lateinit var dbHelper: EchoKvDbHelper
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
        dbHelper = EchoKvDbHelper(context.applicationContext)

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
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkgInfo?.longVersionCode?.toInt() ?: 1
        } else {
            @Suppress("DEPRECATION")
            pkgInfo?.versionCode ?: 1
        }
        call.resolve(
            JSObject()
                .put("autoClaim", autoClaim)
                .put("versionName", pkgInfo?.versionName ?: "1.0.0")
                .put("versionCode", versionCode),
        )
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("granted", true))
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
        cm.setPrimaryClip(ClipData.newPlainText("EchoMusic", text))
        call.resolve()
    }

    companion object {
        @Volatile
        private var instance: EchoSystemPlugin? = null

        @Volatile
        var pendingAutoClaim: Boolean = false

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
