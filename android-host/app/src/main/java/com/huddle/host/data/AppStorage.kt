package com.huddle.host.data

import android.content.Context
import com.huddle.host.server.WwwStore
import java.io.File

data class StorageBreakdown(
    val webBytes: Long,
    val cacheBytes: Long,
    val dataBytes: Long
) {
    val totalBytes: Long get() = webBytes + cacheBytes + dataBytes
}

/**
 * Measures and cleans reclaimable on-device storage used by Huddle.
 */
object AppStorage {
    fun breakdown(context: Context): StorageBreakdown {
        val app = context.applicationContext
        val www = WwwStore.root(app)
        val web = dirSize(www)
        val cache = dirSize(app.cacheDir) +
            dirSize(app.codeCacheDir) +
            dirSize(app.externalCacheDir)

        val dataDir = File(app.applicationInfo.dataDir)
        val internalSansCache = dirSizeExcluding(
            dataDir,
            setOfNotNull(app.cacheDir, app.codeCacheDir)
        )
        val extRoot = app.getExternalFilesDir(null)?.parentFile
        val externalSansWebAndCache = dirSizeExcluding(
            extRoot,
            setOfNotNull(www, app.externalCacheDir)
        )
        val data = (internalSansCache + externalSansWebAndCache).coerceAtLeast(0L)

        return StorageBreakdown(
            webBytes = web,
            cacheBytes = cache,
            dataBytes = data
        )
    }

    /**
     * Clears caches and reseeds bundled web assets.
     * Keeps theme / last-game prefs and undercover word library.
     */
    fun clearReclaimable(context: Context): StorageBreakdown {
        val app = context.applicationContext
        deleteContents(app.cacheDir)
        deleteContents(app.codeCacheDir)
        app.externalCacheDir?.let { deleteContents(it) }
        WwwStore.prepare(app, forceReseed = true)
        return breakdown(app)
    }

    fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return String.format("%.1f KB", kb)
        val mb = kb / 1024.0
        if (mb < 1024) return String.format("%.1f MB", mb)
        return String.format("%.2f GB", mb / 1024.0)
    }

    private fun setOfNotNull(vararg files: File?): Set<File> =
        files.mapNotNull { it?.canonicalFile }.toSet()

    private fun dirSize(dir: File?): Long {
        if (dir == null || !dir.exists()) return 0L
        if (dir.isFile) return dir.length()
        var total = 0L
        val children = dir.listFiles() ?: return 0L
        for (child in children) {
            total += if (child.isDirectory) dirSize(child) else child.length()
        }
        return total
    }

    private fun dirSizeExcluding(root: File?, excluded: Set<File>): Long {
        if (root == null || !root.exists()) return 0L
        val canon = runCatching { root.canonicalFile }.getOrDefault(root)
        if (canon in excluded) return 0L
        if (root.isFile) return root.length()
        var total = 0L
        val children = root.listFiles() ?: return 0L
        for (child in children) {
            total += if (child.isDirectory) dirSizeExcluding(child, excluded) else {
                val c = runCatching { child.canonicalFile }.getOrDefault(child)
                if (c in excluded) 0L else child.length()
            }
        }
        return total
    }

    private fun deleteContents(dir: File?) {
        if (dir == null || !dir.isDirectory) return
        dir.listFiles()?.forEach { child ->
            if (child.isDirectory) child.deleteRecursively() else child.delete()
        }
    }
}
