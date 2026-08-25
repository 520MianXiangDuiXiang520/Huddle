package com.huddle.host

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.huddle.host.databinding.ActivityRoomBinding
import com.huddle.host.server.HostForegroundService
import com.huddle.host.server.HostRuntime
import com.huddle.host.util.QrCodeUtil

class RoomActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRoomBinding
    private var webLoaded = false
    private var leavingRoom = false
    private var joinUrl: String? = null

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != HostForegroundService.ACTION_STATE_CHANGED) return
            val running = intent.getBooleanExtra(HostForegroundService.EXTRA_RUNNING, false)
            if (!running) {
                val error = intent.getStringExtra(HostForegroundService.EXTRA_ERROR)
                if (!error.isNullOrBlank()) {
                    showServerUnavailable(error)
                    return
                }
                if (!isFinishing) finish()
                return
            }
            if (leavingRoom) return
            val url = intent.getStringExtra(HostRuntime.EXTRA_JOIN_URL)
            val localUrl = intent.getStringExtra(HostRuntime.EXTRA_LOCAL_URL)
                ?: HostRuntime.localUrl
            onServerReady(url, localUrl)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityRoomBinding.inflate(layoutInflater)
        setContentView(binding.root)
        applySystemBarInsets()

        setupWebView()
        binding.btnInvite.setOnClickListener { showInviteDialog() }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    confirmLeaveRoom()
                }
            }
        )

        if (HostRuntime.isRunning) {
            onServerReady(HostRuntime.joinUrl, HostRuntime.localUrl)
        } else {
            binding.statusText.setText(R.string.waiting_server)
        }
    }

    private fun applySystemBarInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.roomRoot) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            binding.topBar.updatePadding(top = bars.top + 8)
            binding.webView.updatePadding(bottom = bars.bottom)
            insets
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(HostForegroundService.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stateReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(stateReceiver, filter)
        }
    }

    override fun onStop() {
        unregisterReceiver(stateReceiver)
        super.onStop()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(true)
        binding.webView.webViewClient = WebViewClient()
        binding.webView.webChromeClient = WebChromeClient()
        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
    }

    private fun onServerReady(joinUrl: String?, localUrl: String) {
        this.joinUrl = joinUrl
        binding.statusText.text = if (joinUrl != null) {
            getString(R.string.server_running)
        } else {
            getString(R.string.local_ip_unknown)
        }

        if (!webLoaded) {
            webLoaded = true
            binding.webView.loadUrl(localUrl)
            // First enter: auto show invite once so host can share quickly.
            if (joinUrl != null) {
                binding.webView.post { showInviteDialog() }
            }
        }
    }

    private fun showInviteDialog() {
        val url = joinUrl ?: HostRuntime.joinUrl
        val content = LayoutInflater.from(this).inflate(R.layout.dialog_invite, null, false)
        val qrView = content.findViewById<ImageView>(R.id.inviteQrImage)
        val urlView = content.findViewById<TextView>(R.id.inviteUrlText)

        if (url != null) {
            urlView.text = url
            qrView.setImageBitmap(QrCodeUtil.encode(url))
        } else {
            urlView.text = getString(R.string.local_ip_unknown)
            qrView.setImageDrawable(
                ContextCompat.getDrawable(this, R.drawable.ic_launcher_foreground)
            )
        }

        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.invite_title)
            .setView(content)
            .setPositiveButton(R.string.invite_copy_link) { _, _ ->
                if (url != null) {
                    val cm = getSystemService(ClipboardManager::class.java)
                    cm.setPrimaryClip(ClipData.newPlainText("huddle", url))
                    Toast.makeText(this, R.string.link_copied, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(R.string.invite_close, null)
            .show()
    }

    private fun showServerUnavailable(error: String) {
        if (isFinishing) return
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.server_unavailable_title)
            .setMessage(error)
            .setPositiveButton(R.string.server_unavailable_confirm) { _, _ -> finish() }
            .setCancelable(false)
            .show()
    }

    private fun confirmLeaveRoom() {
        if (leavingRoom || isFinishing) return
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.leave_room_title)
            .setMessage(R.string.leave_room_message)
            .setPositiveButton(R.string.leave_room_confirm) { _, _ -> leaveRoom() }
            .setNegativeButton(R.string.leave_room_cancel, null)
            .show()
    }

    private fun leaveRoom() {
        if (leavingRoom || isFinishing) return
        leavingRoom = true
        HostRuntime.isRunning = false
        HostForegroundService.stop(this)
        finish()
    }
}
