package com.huddle.host.util

import java.net.Inet4Address
import java.net.NetworkInterface

object NetworkUtils {
    /**
     * Prefer hotspot / Wi-Fi IPv4. Falls back to any non-loopback IPv4.
     */
    fun getLanIpAddress(): String? {
        val preferred = mutableListOf<String>()
        val others = mutableListOf<String>()

        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
        for (nif in interfaces) {
            if (!nif.isUp || nif.isLoopback) continue
            val name = nif.name.lowercase()
            for (addr in nif.inetAddresses) {
                if (addr.isLoopbackAddress || addr !is Inet4Address) continue
                val host = addr.hostAddress ?: continue
                if (
                    name.contains("wlan") ||
                    name.contains("ap") ||
                    name.contains("swlan") ||
                    name.contains("wifi")
                ) {
                    preferred += host
                } else {
                    others += host
                }
            }
        }
        return preferred.firstOrNull() ?: others.firstOrNull()
    }
}
