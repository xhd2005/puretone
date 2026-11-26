package com.xhd2005.echomusic.plugins

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.xhd2005.echomusic.MainActivity
import com.xhd2005.echomusic.R

class VipReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(manager)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("autoClaim", true)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            REQ_CODE_OPEN,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("今日畅听 VIP 待领取")
            .setContentText("点击打开 EchoMusic 自动完成每日四步签到")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(NOTIFICATION_ID, notification)
    }

    companion object {
        const val CHANNEL_ID = "echo_daily_vip_reminder"
        const val NOTIFICATION_ID = 202611
        const val REQ_CODE_OPEN = 202612
        const val REQ_CODE_ALARM = 202613

        fun ensureChannel(manager: NotificationManager) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "每日 VIP 签到提醒",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "在设定时间提醒你点击打开应用自动领取畅听会员"
                }
                manager.createNotificationChannel(channel)
            }
        }
    }
}
