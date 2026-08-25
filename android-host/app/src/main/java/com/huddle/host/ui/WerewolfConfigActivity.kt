package com.huddle.host.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.huddle.host.R
import com.huddle.host.data.WerewolfRoleStore
import com.huddle.host.databinding.ActivityWerewolfConfigBinding
import com.huddle.host.databinding.ItemWerewolfRoleBinding

class WerewolfConfigActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWerewolfConfigBinding

    private val minOptions = (6..12).toList()
    private val maxOptions = (6..12).toList()

    private data class RoleRow(
        val id: String,
        val title: String,
        val blurb: String,
        val min: Int,
        val max: Int,
        val get: () -> Int,
        val set: (Int) -> Unit
    )

    private val roleRows: List<RoleRow> by lazy {
        listOf(
            RoleRow("werewolf", "狼人", WerewolfRoleStore.ROLE_BLURB["werewolf"]!!, 1, 4,
                { WerewolfRoleStore.werewolfCount(this) },
                { WerewolfRoleStore.setWerewolfCount(this, it) }),
            RoleRow("seer", "预言家", WerewolfRoleStore.ROLE_BLURB["seer"]!!, 0, 2,
                { WerewolfRoleStore.seerCount(this) },
                { WerewolfRoleStore.setSeerCount(this, it) }),
            RoleRow("witch", "女巫", WerewolfRoleStore.ROLE_BLURB["witch"]!!, 0, 2,
                { WerewolfRoleStore.witchCount(this) },
                { WerewolfRoleStore.setWitchCount(this, it) }),
            RoleRow("hunter", "猎人", WerewolfRoleStore.ROLE_BLURB["hunter"]!!, 0, 2,
                { WerewolfRoleStore.hunterCount(this) },
                { WerewolfRoleStore.setHunterCount(this, it) }),
            RoleRow("guard", "守卫", WerewolfRoleStore.ROLE_BLURB["guard"]!!, 0, 2,
                { WerewolfRoleStore.guardCount(this) },
                { WerewolfRoleStore.setGuardCount(this, it) })
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityWerewolfConfigBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.toolbar.setNavigationOnClickListener { finish() }

        rebuildMinRow()
        rebuildMaxRow()
        rebuildRoleRows()
        updateCompositionHint()
    }

    private fun rebuildMinRow() {
        val selected = WerewolfRoleStore.minPlayers(this)
        fillChoiceRow(binding.minPlayersRow, minOptions, selected) { value ->
            WerewolfRoleStore.setMinPlayers(this, value)
            rebuildMinRow()
            rebuildMaxRow()
            updateCompositionHint()
        }
    }

    private fun rebuildMaxRow() {
        val min = WerewolfRoleStore.minPlayers(this)
        val selected = WerewolfRoleStore.maxPlayers(this)
        val options = maxOptions.filter { it >= min }
        fillChoiceRow(binding.maxPlayersRow, options, selected) { value ->
            WerewolfRoleStore.setMaxPlayers(this, value)
            rebuildMaxRow()
            updateCompositionHint()
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

    private fun rebuildRoleRows() {
        binding.rolesList.removeAllViews()
        for (row in roleRows) {
            val item = ItemWerewolfRoleBinding.inflate(
                LayoutInflater.from(this), binding.rolesList, false
            )
            item.roleTitle.text = row.title
            item.roleBlurb.text = row.blurb
            renderCount(item, row)
            item.minusBtn.setOnClickListener {
                row.set((row.get() - 1).coerceIn(row.min, row.max))
                renderCount(item, row)
                updateCompositionHint()
            }
            item.plusBtn.setOnClickListener {
                row.set((row.get() + 1).coerceIn(row.min, row.max))
                renderCount(item, row)
                updateCompositionHint()
            }
            binding.rolesList.addView(item.root)
        }
    }

    private fun renderCount(item: ItemWerewolfRoleBinding, row: RoleRow) {
        item.countText.text = row.get().toString()
        item.minusBtn.isEnabled = row.get() > row.min
        item.plusBtn.isEnabled = row.get() < row.max
        item.minusBtn.alpha = if (item.minusBtn.isEnabled) 1f else 0.4f
        item.plusBtn.alpha = if (item.plusBtn.isEnabled) 1f else 0.4f
    }

    private fun updateCompositionHint() {
        val special = WerewolfRoleStore.specialTotal(this)
        val minP = WerewolfRoleStore.minPlayers(this)
        val maxP = WerewolfRoleStore.maxPlayers(this)
        val villagerMin = (minP - special).coerceAtLeast(0)
        val villagerMax = (maxP - special).coerceAtLeast(0)
        val warn = WerewolfRoleStore.validate(this, minP)
        val base = "特殊角色共 $special 人 · 平民 $villagerMin–$villagerMax 人 · 开房 ${WerewolfRoleStore.playersLabel(this)}"
        binding.compositionHint.text = if (warn != null) "$base\n⚠ $warn" else base
        binding.compositionHint.setTextColor(
            ContextCompat.getColor(
                this,
                if (warn != null) R.color.danger else R.color.text_secondary
            )
        )
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
