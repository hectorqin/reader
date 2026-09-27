package cool.cnb.reader.bridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.io.Closeable

/**
 * Reports whether an active network can carry requests, including LAN-only Wi-Fi.
 * Public-internet validation says nothing about reachability of a self-hosted NAS.
 * Actual HTTP requests decide server reachability and retain the cache fallback.
 */
class ConnectivityMonitor(context: Context) : Closeable {

    private val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val listeners = mutableSetOf<(String) -> Unit>()
    private var connected = currentConnection(manager)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = recompute()
        override fun onLost(network: Network) = recompute()
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = recompute()
    }

    init {
        // Observe the network used by requests, including default-route/VPN changes.
        runCatching { manager.registerDefaultNetworkCallback(callback) }
            .onFailure {
                // Android 10+ requires ACCESS_NETWORK_STATE, which the manifest
                // declares. If registration still fails the monitor degrades to a
                // best-effort snapshot rather than taking the app down.
                connected = currentConnection(manager)
            }
    }

    /** 'online' or 'offline', matching the strings the web bridge expects. */
    fun current(): String = if (connected) "online" else "offline"

    fun watch(listener: (String) -> Unit) {
        listeners.add(listener)
        // Report the current state immediately: the client registers its listener
        // after the bridge exists, so without this it would wait for the next
        // network change to learn that it is offline.
        listener(current())
    }

    private fun recompute() {
        val next = currentConnection(manager)
        if (next == connected) return
        connected = next
        val state = current()
        for (listener in listeners.toList()) listener(state)
    }

    override fun close() {
        listeners.clear()
        runCatching { manager.unregisterNetworkCallback(callback) }
    }

    private fun currentConnection(manager: ConnectivityManager): Boolean {
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    }
}
