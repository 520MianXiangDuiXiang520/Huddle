package com.huddle.host

import android.app.Application
import com.huddle.host.data.AppPrefs
import com.huddle.host.data.UndercoverWordStore

class HuddleHostApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        AppPrefs.applyTheme(AppPrefs.themeMode(this))
        UndercoverWordStore.ensureSeeded(this)
    }

    companion object {
        lateinit var instance: HuddleHostApp
            private set
    }
}
