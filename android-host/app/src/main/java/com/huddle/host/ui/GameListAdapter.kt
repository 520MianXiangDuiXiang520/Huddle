package com.huddle.host.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.huddle.host.R
import com.huddle.host.data.GameCatalog
import com.huddle.host.data.GameDef
import com.huddle.host.databinding.ItemGameBinding

class GameListAdapter(
    private val games: List<GameDef>,
    private var selectedId: String,
    private val onSelect: (GameDef) -> Unit,
    private val onConfig: (GameDef) -> Unit = {}
) : RecyclerView.Adapter<GameListAdapter.VH>() {

    fun setSelected(id: String) {
        val old = selectedId
        selectedId = id
        val oldIndex = games.indexOfFirst { it.id == old }
        val newIndex = games.indexOfFirst { it.id == id }
        if (oldIndex >= 0) notifyItemChanged(oldIndex)
        if (newIndex >= 0) notifyItemChanged(newIndex)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val binding = ItemGameBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(binding)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        holder.bind(games[position])
    }

    override fun getItemCount(): Int = games.size

    inner class VH(private val binding: ItemGameBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(game: GameDef) {
            binding.gameTitle.text = game.title
            binding.gameSubtitle.text = game.subtitle
            binding.gamePlayers.text = GameCatalog.resolvedPlayersLabel(game)

            val showConfig = game.available && game.hasConfig
            binding.gameConfigBtn.visibility =
                if (showConfig) android.view.View.VISIBLE else android.view.View.GONE
            binding.gameConfigBtn.setOnClickListener {
                onConfig(game)
            }
            binding.gameConfigBtn.contentDescription =
                binding.root.context.getString(R.string.game_config_a11y, game.title)

            if (game.available) {
                binding.gameBadge.visibility = android.view.View.GONE
                binding.gameActionHint.visibility = android.view.View.VISIBLE
                binding.root.alpha = 1f
                binding.root.contentDescription =
                    binding.root.context.getString(R.string.game_card_a11y_available, game.title)
            } else {
                binding.gameBadge.visibility = android.view.View.VISIBLE
                binding.gameBadge.text = binding.root.context.getString(R.string.coming_soon)
                binding.gameActionHint.visibility = android.view.View.GONE
                binding.root.alpha = 0.72f
                binding.root.contentDescription =
                    binding.root.context.getString(R.string.game_card_a11y_soon, game.title)
            }

            val selected = game.available && game.id == selectedId
            binding.root.strokeWidth = if (selected) 2 else 1
            binding.root.strokeColor = ContextCompat.getColor(
                binding.root.context,
                if (selected) R.color.accent else R.color.stroke
            )

            binding.root.setOnClickListener {
                if (!game.available) return@setOnClickListener
                onSelect(game)
            }
        }
    }
}
