package com.huddle.host.server

import android.content.Context
import com.huddle.host.BuildConfig
import java.io.File

/**
 * Web frontend lives on device storage (not only inside the APK).
 *
 * Path (typical):
 *   /sdcard/Android/data/com.huddle.host/files/www/
 *
 * First launch seeds from APK assets. The on-disk copy is reseeded
 * automatically on every APK upgrade (detected via versionCode), so any
 * change shipped inside `assets/www` overwrites the stale disk cache.
 * There is no remote/OTA update path.
 */
object WwwStore {
    private const val PREFS = "huddle_web"
    private const val KEY_SEED_VERSION_CODE = "seed_version_code"

    fun root(context: Context): File {
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        return File(base, "www")
    }

    fun absolutePath(context: Context): String = root(context).absolutePath

    /**
     * @param forceReseed when true, wipe local www and copy bundled assets again
     */
    fun prepare(context: Context, forceReseed: Boolean = false): File {
        val dest = root(context)
        val index = File(dest, "index.html")
        val seedVc = readSeedVersionCode(context)
        val needReseed = forceReseed ||
            !index.isFile ||
            seedVc != BuildConfig.VERSION_CODE
        if (needReseed) {
            if (dest.exists()) {
                dest.deleteRecursively()
            }
            dest.mkdirs()
            copyAssetDir(context, "www", dest)
            writeSeedVersionCode(context, BuildConfig.VERSION_CODE)
        } else {
            dest.mkdirs()
        }
        return dest
    }

    private fun readSeedVersionCode(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_SEED_VERSION_CODE, -1)

    private fun writeSeedVersionCode(context: Context, versionCode: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_SEED_VERSION_CODE, versionCode)
            .apply()
    }

    private fun copyAssetDir(context: Context, assetPath: String, destDir: File) {
        val assets = context.assets
        val children = assets.list(assetPath) ?: return
        if (children.isEmpty()) {
            assets.open(assetPath).use { input ->
                destDir.outputStream().use { output -> input.copyTo(output) }
            }
            return
        }
        destDir.mkdirs()
        for (child in children) {
            val childAsset = "$assetPath/$child"
            val childDest = File(destDir, child)
            val nested = assets.list(childAsset)
            if (nested.isNullOrEmpty()) {
                assets.open(childAsset).use { input ->
                    childDest.outputStream().use { output -> input.copyTo(output) }
                }
            } else {
                copyAssetDir(context, childAsset, childDest)
            }
        }
    }
}
