package com.huddle.host.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.huddle.host.R
import com.huddle.host.RoomActivity
import com.huddle.host.data.AppPrefs
import com.huddle.host.data.GameCatalog
import com.huddle.host.data.GameDef
import com.huddle.host.databinding.FragmentHomeBinding
import com.huddle.host.server.HostForegroundService
import com.huddle.host.server.HostRuntime

class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!
    private lateinit var adapter: GameListAdapter
    private var selectedGameId: String = "gomoku"
    private var pendingStartGameId: String? = null

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            startPendingGame()
        }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        selectedGameId = AppPrefs.lastGameId(requireContext())
        if (GameCatalog.find(selectedGameId)?.available != true) {
            selectedGameId = "gomoku"
        }

        adapter = GameListAdapter(
            games = GameCatalog.all,
            selectedId = selectedGameId,
            onSelect = { game ->
                selectedGameId = game.id
                AppPrefs.setLastGameId(requireContext(), game.id)
                adapter.setSelected(game.id)
                confirmStartRoom(game)
            },
            onConfig = { game ->
                when (game.id) {
                    "undercover" -> startActivity(
                        Intent(requireContext(), UndercoverConfigActivity::class.java)
                    )
                    "draw_guess" -> startActivity(
                        Intent(requireContext(), DrawGuessConfigActivity::class.java)
                    )
                    "werewolf" -> startActivity(
                        Intent(requireContext(), WerewolfConfigActivity::class.java)
                    )
                }
            }
        )
        binding.gameList.layoutManager = LinearLayoutManager(requireContext())
        binding.gameList.adapter = adapter
    }

    private fun confirmStartRoom(game: GameDef) {
        if (!game.available) {
            Toast.makeText(requireContext(), R.string.coming_soon, Toast.LENGTH_SHORT).show()
            return
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.start_room_confirm_title)
            .setMessage(
                getString(
                    R.string.start_room_confirm_message,
                    game.title,
                    GameCatalog.resolvedPlayersLabel(game)
                )
            )
            .setPositiveButton(R.string.start_room_confirm_ok) { _, _ ->
                pendingStartGameId = game.id
                ensurePermissionThenStart()
            }
            .setNegativeButton(R.string.start_room_confirm_cancel, null)
            .show()
    }

    private fun ensurePermissionThenStart() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                requireContext(),
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        startPendingGame()
    }

    private fun startPendingGame() {
        val gameId = pendingStartGameId ?: selectedGameId
        val game = GameCatalog.find(gameId)
        if (game == null || !game.available) {
            Toast.makeText(requireContext(), R.string.pick_available_game, Toast.LENGTH_SHORT).show()
            return
        }
        HostRuntime.selectedGameId = game.id
        HostForegroundService.start(requireContext())
        startActivity(Intent(requireContext(), RoomActivity::class.java))
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
