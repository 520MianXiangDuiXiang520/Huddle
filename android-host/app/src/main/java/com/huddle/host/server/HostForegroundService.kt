package com.huddle.host.server

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.huddle.host.R
import com.huddle.host.RoomActivity
import com.huddle.host.util.NetworkUtils
import java.util.concurrent.Executors

class HostForegroundService : Service() {

    private val worker = Executors.newSingleThreadExecutor()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                // Clear immediately so UI won't bounce back into RoomActivity.
                HostRuntime.isRunning = false
                stopServerAndSelf()
                return START_NOT_STICKY
            }
            else -> startServer()
        }
        return START_STICKY
    }

    private fun startServer() {
        ensureChannel()
        val notification = buildNotification(getString(R.string.notification_text))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        worker.execute {
            try {
                HostRuntime.server?.stop()
                val www = WwwStore.prepare(applicationContext, forceReseed = false)
                val server = HostServer(www)
                server.start()

                val lanIp = NetworkUtils.getLanIpAddress()
                val joinUrl = if (lanIp != null) {
                    "http://$lanIp:${HostServer.DEFAULT_PORT}/"
                } else {
                    null
                }
                val localUrl = "http://127.0.0.1:${HostServer.DEFAULT_PORT}/"

                HostRuntime.server = server
                HostRuntime.joinUrl = joinUrl
                HostRuntime.localUrl = localUrl
                HostRuntime.isRunning = true

                val text = joinUrl ?: getString(R.string.local_ip_unknown)
                val nm = getSystemService(NotificationManager::class.java)
                nm.notify(NOTIFICATION_ID, buildNotification(text))

                sendBroadcast(
                    Intent(ACTION_STATE_CHANGED).setPackage(packageName)
                        .putExtra(HostRuntime.EXTRA_JOIN_URL, joinUrl)
                        .putExtra(HostRuntime.EXTRA_LOCAL_URL, localUrl)
                        .putExtra(EXTRA_RUNNING, true)
                )
            } catch (t: Throwable) {
                HostRuntime.isRunning = false
                sendBroadcast(
                    Intent(ACTION_STATE_CHANGED).setPackage(packageName)
                        .putExtra(EXTRA_RUNNING, false)
                        .putExtra(EXTRA_ERROR, t.message ?: t.javaClass.simpleName)
                )
                stopSelf()
            }
        }
    }

    private fun stopServerAndSelf() {
        worker.execute {
            HostRuntime.server?.stop()
            HostRuntime.server = null
            HostRuntime.isRunning = false
            HostRuntime.joinUrl = null
            sendBroadcast(
                Intent(ACTION_STATE_CHANGED).setPackage(packageName)
                    .putExtra(EXTRA_RUNNING, false)
            )
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onDestroy() {
        HostRuntime.server?.stop()
        HostRuntime.server = null
        HostRuntime.isRunning = false
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_name),
            NotificationManager.IMPORTANCE_LOW
        )
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(content: String): Notification {
        val openIntent = Intent(this, RoomActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(content)
            .setContentIntent(pending)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        const val ACTION_STOP = "com.huddle.host.action.STOP"
        const val ACTION_STATE_CHANGED = "com.huddle.host.action.STATE_CHANGED"
        const val EXTRA_RUNNING = "running"
        const val EXTRA_ERROR = "error"

        private const val CHANNEL_ID = "huddle_host_room"
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, HostForegroundService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, HostForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
