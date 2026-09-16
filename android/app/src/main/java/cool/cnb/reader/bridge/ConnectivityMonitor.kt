package cool.cnb.reader.bridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.io.Closeable

/**
 * Real connectivity, which the WebView cannot provide.
 *
 * `navigator.onLine` inside a WebView reports "true" whenever a network interface
 * exists. On a phone that has joined a Wi-Fi network with no route to the NAS —
 * a captive portal, a hotel network, a VPN that has not connected yet — it says
 * "online" and the client happily attempts requests that will all time out. The
 * user then sees a spinner instead of their cached library.
 *
 * `NetworkCapabilities.NET_CAPABILITY_VALIDATED` is the platform's own answer to
 * "can this device actually reach the internet", which is the question the client
 * is really asking. Reporting it is what makes the offline path switch at the
 * right moment instead of several seconds later.
 */
class ConnectivityMonitor(context: Context) : Closeable {

    private val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val listeners = mutableSetOf<(String) -> Unit>()
    private var validated = currentValidation(manager)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = recompute()
        override fun onLost(network: Network) = recompute()
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = recompute()
    }

    init {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        // Registering for a request, not `registerDefaultNetworkCallback`: the app
        // may be on Wi-Fi with no uplink while a VPN provides the route to the
        // server, and the default network would miss that.
        runCatching { manager.registerNetworkCallback(request, callback) }
            .onFailure {
                // Android 10+ requires ACCESS_NETWORK_STATE, which the manifest
                // declares. If registration still fails the monitor degrades to a
                // best-effort snapshot rather than taking the app down.
                validated = currentValidation(manager)
            }
    }

    /** 'online' or 'offline', matching the strings the web bridge expects. */
    fun current(): String = if (validated) "online" else "offline"

    fun watch(listener: (String) -> Unit) {
        listeners.add(listener)
        // Report the current state immediately: the client registers its listener
        // after the bridge exists, so without this it would wait for the next
        // network change to learn that it is offline.
        listener(current())
    }

    private fun recompute() {
        val next = currentValidation(manager)
        if (next == validated) return
        validated = next
        val state = current()
        for (listener in listeners.toList()) listener(state)
    }

    override fun close() {
        listeners.clear()
        runCatching { manager.unregisterNetworkCallback(callback) }
    }

    private fun currentValidation(manager: ConnectivityManager): Boolean {
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false
        // VALIDATED means the system has confirmed the network reaches the
        // internet. A network without it may still reach a LAN server, so this is
        // treated as a hint rather than the whole truth: the client's own requests
        // are what ultimately decide, and they fall back to cache either way.
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    }
}
