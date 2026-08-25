package com.huddle.host.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.huddle.host.R
import com.huddle.host.data.DrawGuessWord
import com.huddle.host.data.DrawGuessWordStore
import com.huddle.host.databinding.ActivityDrawGuessConfigBinding
import com.huddle.host.databinding.ItemDrawGuessWordBinding

class DrawGuessConfigActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDrawGuessConfigBinding
    private lateinit var adapter: WordAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDrawGuessConfigBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }

        adapter = WordAdapter(
            onReuse = { id ->
                DrawGuessWordStore.reuse(this, id)
                reload()
            },
            onDelete = { id ->
                DrawGuessWordStore.remove(this, id)
                reload()
            }
        )
        binding.wordList.layoutManager = LinearLayoutManager(this)
        binding.wordList.adapter = adapter

        binding.addBtn.setOnClickListener {
            val word = binding.wordInput.text?.toString().orEmpty()
            val added = DrawGuessWordStore.add(this, word)
            if (added == null) {
                Toast.makeText(this, R.string.draw_guess_add_invalid, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            binding.wordInput.text = null
            reload()
        }

        binding.reuseAllBtn.setOnClickListener {
            DrawGuessWordStore.reuseAll(this)
            Toast.makeText(this, R.string.draw_guess_reuse_all_done, Toast.LENGTH_SHORT).show()
            reload()
        }

        reload()
    }

    private fun reload() {
        val words = DrawGuessWordStore.list(this)
        adapter.submit(words)
        val unused = words.count { !it.used }
        binding.unusedHint.text = getString(
            R.string.draw_guess_unused_fmt,
            unused,
            words.size
        )
    }

    private class WordAdapter(
        private val onReuse: (String) -> Unit,
        private val onDelete: (String) -> Unit
    ) : RecyclerView.Adapter<WordAdapter.VH>() {
        private val items = mutableListOf<DrawGuessWord>()

        fun submit(list: List<DrawGuessWord>) {
            items.clear()
            items.addAll(list)
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val binding = ItemDrawGuessWordBinding.inflate(
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

        inner class VH(private val binding: ItemDrawGuessWordBinding) :
            RecyclerView.ViewHolder(binding.root) {
            fun bind(entry: DrawGuessWord) {
                binding.wordTitle.text = entry.word
                binding.usedBadge.visibility =
                    if (entry.used) android.view.View.VISIBLE else android.view.View.GONE
                binding.reuseBtn.visibility =
                    if (entry.used) android.view.View.VISIBLE else android.view.View.GONE
                binding.reuseBtn.setOnClickListener { onReuse(entry.id) }
                binding.deleteBtn.setOnClickListener { onDelete(entry.id) }
            }
        }
    }
}
