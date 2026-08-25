package com.huddle.host.data

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

object AppPrefs {
    private const val PREFS = "huddle_app"
    private const val KEY_THEME = "theme_mode"
    private const val KEY_LAST_GAME = "last_game_id"

    const val THEME_SYSTEM = 0
    const val THEME_LIGHT = 1
    const val THEME_DARK = 2

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun themeMode(context: Context): Int =
        prefs(context).getInt(KEY_THEME, THEME_SYSTEM)

    fun setThemeMode(context: Context, mode: Int) {
        prefs(context).edit().putInt(KEY_THEME, mode).apply()
        applyTheme(mode)
    }

    fun applyTheme(mode: Int) {
        AppCompatDelegate.setDefaultNightMode(
            when (mode) {
                THEME_LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
                THEME_DARK -> AppCompatDelegate.MODE_NIGHT_YES
                else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            }
        )
    }

    fun lastGameId(context: Context): String =
        prefs(context).getString(KEY_LAST_GAME, "gomoku") ?: "gomoku"

    fun setLastGameId(context: Context, id: String) {
        prefs(context).edit().putString(KEY_LAST_GAME, id).apply()
    }
}
