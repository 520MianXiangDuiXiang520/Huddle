package com.huddle.host.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.huddle.host.R
import com.huddle.host.data.UndercoverWordPair
import com.huddle.host.data.UndercoverWordStore
import com.huddle.host.databinding.ActivityUndercoverConfigBinding
import com.huddle.host.databinding.ItemUndercoverWordBinding

class UndercoverConfigActivity : AppCompatActivity() {

    private lateinit var binding: ActivityUndercoverConfigBinding
    private lateinit var adapter: WordAdapter

    private val minOptions = listOf(3, 4, 5, 6)
    private val maxOptions = listOf(6, 8, 10, 12)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUndercoverConfigBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }

        adapter = WordAdapter(
            onReuse = { id ->
                UndercoverWordStore.reuse(this, id)
                reload()
            },
            onDelete = { id ->
                UndercoverWordStore.remove(this, id)
                reload()
            }
        )
        binding.wordList.layoutManager = LinearLayoutManager(this)
        binding.wordList.adapter = adapter

        bindCountChoices()
        bindPlayerRows()

        binding.addBtn.setOnClickListener {
            val civilian = binding.civilianInput.text?.toString().orEmpty()
            val undercover = binding.undercoverInput.text?.toString().orEmpty()
            val added = UndercoverWordStore.add(this, civilian, undercover)
            if (added == null) {
                Toast.makeText(this, R.string.undercover_add_invalid, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            binding.civilianInput.text = null
            binding.undercoverInput.text = null
            reload()
        }

        binding.reuseAllBtn.setOnClickListener {
            UndercoverWordStore.reuseAll(this)
            Toast.makeText(this, R.string.undercover_reuse_all_done, Toast.LENGTH_SHORT).show()
            reload()
        }

        reload()
    }

    private fun bindCountChoices() {
        val selected = UndercoverWordStore.undercoverCount(this)
        val chips = listOf(binding.count1, binding.count2, binding.count3)
        chips.forEachIndexed { index, chip ->
            val value = index + 1
            styleChoice(chip, selected = value == selected)
            chip.setOnClickListener {
                UndercoverWordStore.setUndercoverCount(this, value)
                chips.forEachIndexed { i, c -> styleChoice(c, selected = i + 1 == value) }
            }
        }
    }

    private fun bindPlayerRows() {
        rebuildMinRow()
        rebuildMaxRow()
    }

    private fun rebuildMinRow() {
        val selected = UndercoverWordStore.minPlayers(this)
        fillChoiceRow(binding.minPlayersRow, minOptions, selected) { value ->
            UndercoverWordStore.setMinPlayers(this, value)
            rebuildMinRow()
            rebuildMaxRow()
            reload()
        }
    }

    private fun rebuildMaxRow() {
        val min = UndercoverWordStore.minPlayers(this)
        val selected = UndercoverWordStore.maxPlayers(this)
        val options = maxOptions.filter { it >= min }.ifEmpty { listOf(min.coerceAtLeast(6)) }
        fillChoiceRow(binding.maxPlayersRow, options, selected) { value ->
            UndercoverWordStore.setMaxPlayers(this, value)
            rebuildMaxRow()
            reload()
        }
    }

    private fun fillChoiceRow(
        row: LinearLayout,
        options: List<Int>,
        selected: Int,
        onPick: (Int) -> Unit
    ) {
        row.removeAllViews()
        options.forEachIndexed { index, value ->
            val chip = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, dp(48)).apply {
                    weight = 1f
                    if (index < options.lastIndex) marginEnd = dp(8)
                }
                gravity = android.view.Gravity.CENTER
                text = value.toString()
                textSize = 16f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                isClickable = true
                isFocusable = true
                setOnClickListener { onPick(value) }
            }
            styleChoice(chip, selected = value == selected)
            row.addView(chip)
        }
    }

    private fun styleChoice(view: TextView, selected: Boolean) {
        view.setBackgroundResource(
            if (selected) R.drawable.bg_choice_selected else R.drawable.bg_choice_unselected
        )
        view.setTextColor(
            ContextCompat.getColor(
                this,
                if (selected) android.R.color.white else R.color.text_primary
            )
        )
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun reload() {
        val pairs = UndercoverWordStore.list(this)
        adapter.submit(pairs)
        val unused = pairs.count { !it.used }
        binding.unusedHint.text = getString(
            R.string.undercover_unused_range_fmt,
            unused,
            pairs.size,
            UndercoverWordStore.playersLabel(this),
            UndercoverWordStore.undercoverCount(this)
        )
    }

    private class WordAdapter(
        private val onReuse: (String) -> Unit,
        private val onDelete: (String) -> Unit
    ) : RecyclerView.Adapter<WordAdapter.VH>() {
        private val items = mutableListOf<UndercoverWordPair>()

        fun submit(list: List<UndercoverWordPair>) {
            items.clear()
            items.addAll(list)
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val binding = ItemUndercoverWordBinding.inflate(
                LayoutInflater.from(parent.context),
                parent,
                false
            )
            return VH(binding)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            holder.bind(items[position])
        }

        override fun getItemCount(): Int = items.size

        inner class VH(private val binding: ItemUndercoverWordBinding) :
            RecyclerView.ViewHolder(binding.root) {
            fun bind(pair: UndercoverWordPair) {
                binding.pairTitle.text = "${pair.civilian} / ${pair.undercover}"
                binding.usedBadge.visibility =
                    if (pair.used) android.view.View.VISIBLE else android.view.View.GONE
                binding.reuseBtn.visibility =
                    if (pair.used) android.view.View.VISIBLE else android.view.View.GONE
                binding.reuseBtn.setOnClickListener { onReuse(pair.id) }
                binding.deleteBtn.setOnClickListener { onDelete(pair.id) }
            }
        }
    }
}
