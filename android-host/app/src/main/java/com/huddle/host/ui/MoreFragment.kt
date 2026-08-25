package com.huddle.host.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.huddle.host.BuildConfig
import com.huddle.host.R
import com.huddle.host.data.AppPrefs
import com.huddle.host.data.AppStorage
import com.huddle.host.databinding.FragmentMoreBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MoreFragment : Fragment() {

    private var _binding: FragmentMoreBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentMoreBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        bindTheme()
        refreshAppVersion()
        refreshStorage()
        binding.btnClearStorage.setOnClickListener { confirmClearStorage() }
        binding.rowFeedback.setOnClickListener { openFeedbackEmail() }
        binding.rowPrivacy.setOnClickListener { showPrivacy() }
        binding.rowDonate.setOnClickListener { showDonate() }
        binding.rowChangelog.setOnClickListener { showChangelog() }
    }

    private fun openFeedbackEmail() {
        val email = getString(R.string.feedback_email).trim()
        val subject = getString(R.string.feedback_subject)
        val body = getString(
            R.string.feedback_body_template,
            BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_CODE
        )
        val mailto = Uri.parse(
            "mailto:$email" +
                "?subject=${Uri.encode(subject)}" +
                "&body=${Uri.encode(body)}"
        )
        val intent = Intent(Intent.ACTION_SENDTO, mailto)
        try {
            startActivity(Intent.createChooser(intent, getString(R.string.more_feedback)))
        } catch (_: Exception) {
            Toast.makeText(requireContext(), R.string.feedback_no_mail_app, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshAppVersion()
        refreshStorage()
    }

    private fun bindTheme() {
        when (AppPrefs.themeMode(requireContext())) {
            AppPrefs.THEME_LIGHT -> binding.themeLight.isChecked = true
            AppPrefs.THEME_DARK -> binding.themeDark.isChecked = true
            else -> binding.themeSystem.isChecked = true
        }
        binding.themeGroup.setOnCheckedChangeListener { _, checkedId ->
            val mode = when (checkedId) {
                R.id.themeLight -> AppPrefs.THEME_LIGHT
                R.id.themeDark -> AppPrefs.THEME_DARK
                else -> AppPrefs.THEME_SYSTEM
            }
            AppPrefs.setThemeMode(requireContext(), mode)
        }
    }

    private fun refreshAppVersion() {
        binding.appVersionText.text = getString(
            R.string.app_version_fmt,
            BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_CODE
        )
    }

    private fun refreshStorage() {
        viewLifecycleOwner.lifecycleScope.launch {
            val breakdown = withContext(Dispatchers.IO) {
                AppStorage.breakdown(requireContext().applicationContext)
            }
            if (_binding == null) return@launch
            binding.storageTotalText.text = getString(
                R.string.storage_total_fmt,
                AppStorage.formatBytes(breakdown.totalBytes)
            )
            binding.storageDetailText.text = getString(
                R.string.storage_detail_fmt,
                AppStorage.formatBytes(breakdown.webBytes),
                AppStorage.formatBytes(breakdown.cacheBytes),
                AppStorage.formatBytes(breakdown.dataBytes)
            )
        }
    }

    private fun confirmClearStorage() {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.storage_clear_title)
            .setMessage(R.string.storage_clear_message)
            .setPositiveButton(R.string.storage_clear_confirm) { _, _ -> clearStorage() }
            .setNegativeButton(R.string.dialog_close, null)
            .show()
    }

    private fun clearStorage() {
        binding.btnClearStorage.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                AppStorage.clearReclaimable(requireContext().applicationContext)
            }
            if (_binding == null) return@launch
            binding.btnClearStorage.isEnabled = true
            refreshStorage()
            Toast.makeText(requireContext(), R.string.storage_clear_done, Toast.LENGTH_SHORT).show()
        }
    }

    private fun showPrivacy() {
        showScrollDialog(R.string.more_privacy, getString(R.string.privacy_policy_body))
    }

    private fun showChangelog() {
        showScrollDialog(R.string.about_changelog, getString(R.string.changelog_text))
    }

    private fun showScrollDialog(titleRes: Int, body: String) {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val text = TextView(requireContext()).apply {
            setText(body)
            setTextColor(ContextCompat.getColor(requireContext(), R.color.text_secondary))
            textSize = 14f
            setLineSpacing(4f, 1f)
            setPadding(pad, pad / 2, pad, pad)
        }
        val scroll = ScrollView(requireContext()).apply {
            isFillViewport = true
            addView(text)
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(titleRes)
            .setView(scroll)
            .setPositiveButton(R.string.dialog_close, null)
            .show()
    }

    private fun showDonate() {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.more_donate)
            .setMessage(R.string.donate_body)
            .setPositiveButton(R.string.donate_copy) { _, _ ->
                val cm = requireContext().getSystemService(ClipboardManager::class.java)
                cm.setPrimaryClip(
                    ClipData.newPlainText("huddle-donate", getString(R.string.donate_copy_value))
                )
                Toast.makeText(requireContext(), R.string.donate_copied, Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton(R.string.donate_open_link) { _, _ ->
                val url = getString(R.string.donate_url).trim()
                if (url.startsWith("http")) {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } else {
                    Toast.makeText(requireContext(), R.string.donate_link_unavailable, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(R.string.dialog_close, null)
            .show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
