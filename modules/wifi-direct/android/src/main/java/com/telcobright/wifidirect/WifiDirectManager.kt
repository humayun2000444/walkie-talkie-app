package com.telcobright.wifidirect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.*
import android.net.wifi.p2p.WifiP2pManager.*
import android.os.Build
import android.util.Log
import java.net.*
import java.io.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * WiFi Direct Mesh Manager
 * Handles peer discovery, connections, audio transfer, and relay functionality.
 *
 * Mesh relay: If device A is connected to both B and C,
 * but B and C can't see each other, A will forward audio between them.
 */
class WifiDirectManager(private val context: Context) {

    companion object {
        private const val TAG = "WifiDirectMesh"
        private const val PORT = 9876
        private const val RELAY_PORT = 9877
    }

    private var manager: WifiP2pManager? = null
    private var channel: Channel? = null

    // Connected peers: deviceAddress -> PeerConnection
    private val connectedPeers = ConcurrentHashMap<String, PeerConnection>()

    // Discovered peers
    private val discoveredPeers = CopyOnWriteArrayList<WifiP2pDevice>()

    // Callbacks
    var onPeerDiscovered: ((List<PeerInfo>) -> Unit)? = null
    var onPeerConnected: ((String, String) -> Unit)? = null
    var onPeerDisconnected: ((String) -> Unit)? = null
    var onAudioReceived: ((ByteArray, String) -> Unit)? = null
    var onStatusChanged: ((String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    // Server thread for receiving connections
    private var serverThread: Thread? = null
    private var isRunning = false

    // My device info
    private var myDeviceName: String = "Unknown"
    private var myDeviceAddress: String = ""
    private var isGroupOwner = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val state = intent.getIntExtra(EXTRA_WIFI_STATE, -1)
                    if (state == WIFI_P2P_STATE_ENABLED) {
                        onStatusChanged?.invoke("WiFi Direct enabled")
                    } else {
                        onStatusChanged?.invoke("WiFi Direct disabled")
                        onError?.invoke("WiFi Direct is not enabled")
                    }
                }
                WIFI_P2P_PEERS_CHANGED_ACTION -> {
                    manager?.requestPeers(channel) { peers ->
                        discoveredPeers.clear()
                        discoveredPeers.addAll(peers.deviceList)
                        val peerInfoList = peers.deviceList.map { device ->
                            PeerInfo(
                                deviceName = device.deviceName,
                                deviceAddress = device.deviceAddress,
                                isConnected = connectedPeers.containsKey(device.deviceAddress)
                            )
                        }
                        onPeerDiscovered?.invoke(peerInfoList)
                        onStatusChanged?.invoke("Found ${peers.deviceList.size} peers")
                    }
                }
                WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                    val networkInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(EXTRA_NETWORK_INFO, android.net.NetworkInfo::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_NETWORK_INFO)
                    }

                    if (networkInfo?.isConnected == true) {
                        manager?.requestConnectionInfo(channel) { info ->
                            handleConnectionInfo(info)
                        }
                    } else {
                        onStatusChanged?.invoke("Disconnected")
                    }
                }
                WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(EXTRA_WIFI_P2P_DEVICE, WifiP2pDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_WIFI_P2P_DEVICE)
                    }
                    device?.let {
                        myDeviceName = it.deviceName
                        myDeviceAddress = it.deviceAddress
                    }
                }
            }
        }
    }

    fun initialize() {
        manager = context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
        channel = manager?.initialize(context, context.mainLooper, null)

        val intentFilter = IntentFilter().apply {
            addAction(WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WIFI_P2P_CONNECTION_CHANGED_ACTION)
            addAction(WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
        }
        context.registerReceiver(receiver, intentFilter)

        isRunning = true
        startServer()
        onStatusChanged?.invoke("Initialized")
        Log.d(TAG, "WiFi Direct Manager initialized")
    }

    fun startDiscovery() {
        manager?.discoverPeers(channel, object : ActionListener {
            override fun onSuccess() {
                onStatusChanged?.invoke("Discovering peers...")
                Log.d(TAG, "Discovery started")
            }

            override fun onFailure(reason: Int) {
                val msg = when (reason) {
                    ERROR -> "Internal error"
                    P2P_UNSUPPORTED -> "P2P unsupported"
                    BUSY -> "System busy"
                    else -> "Unknown error ($reason)"
                }
                onError?.invoke("Discovery failed: $msg")
                Log.e(TAG, "Discovery failed: $msg")
            }
        })
    }

    fun stopDiscovery() {
        manager?.stopPeerDiscovery(channel, null)
    }

    fun connectToPeer(deviceAddress: String) {
        val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
        }

        manager?.connect(channel, config, object : ActionListener {
            override fun onSuccess() {
                onStatusChanged?.invoke("Connecting to $deviceAddress...")
                Log.d(TAG, "Connection initiated to $deviceAddress")
            }

            override fun onFailure(reason: Int) {
                onError?.invoke("Connection failed: $reason")
                Log.e(TAG, "Connection failed: $reason")
            }
        })
    }

    fun disconnectFromPeer(deviceAddress: String) {
        manager?.removeGroup(channel, object : ActionListener {
            override fun onSuccess() {
                connectedPeers.remove(deviceAddress)
                onPeerDisconnected?.invoke(deviceAddress)
                onStatusChanged?.invoke("Disconnected from $deviceAddress")
            }

            override fun onFailure(reason: Int) {
                onError?.invoke("Disconnect failed: $reason")
            }
        })
    }

    private fun handleConnectionInfo(info: WifiP2pInfo) {
        isGroupOwner = info.isGroupOwner
        val groupOwnerAddress = info.groupOwnerAddress?.hostAddress ?: return

        if (isGroupOwner) {
            // We are the group owner - clients connect to us
            onStatusChanged?.invoke("Connected as Group Owner")
            Log.d(TAG, "I am group owner")
        } else {
            // We are a client - connect to group owner
            onStatusChanged?.invoke("Connected to group owner")
            Log.d(TAG, "Connecting to group owner at $groupOwnerAddress")
            connectToServer(groupOwnerAddress)
        }
    }

    // === Audio Transfer ===

    fun sendAudio(audioData: ByteArray) {
        Thread {
            for ((address, peer) in connectedPeers) {
                try {
                    peer.sendAudio(audioData, myDeviceName)
                    Log.d(TAG, "Audio sent to $address (${audioData.size} bytes)")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to send audio to $address: ${e.message}")
                }
            }
        }.start()
    }

    // === Mesh Relay ===

    /**
     * Relay audio from one peer to all other connected peers.
     * This enables mesh networking - if B and C can't see each other,
     * but both are connected to A, then A relays between them.
     */
    private fun relayAudio(audioData: ByteArray, fromDevice: String) {
        for ((address, peer) in connectedPeers) {
            // Don't send back to the sender
            if (address != fromDevice) {
                try {
                    peer.sendAudio(audioData, fromDevice)
                    Log.d(TAG, "Relayed audio from $fromDevice to $address")
                } catch (e: Exception) {
                    Log.e(TAG, "Relay failed to $address: ${e.message}")
                }
            }
        }
    }

    // === Server (receives incoming connections and audio) ===

    private fun startServer() {
        serverThread = Thread {
            try {
                val serverSocket = ServerSocket(PORT)
                Log.d(TAG, "Server listening on port $PORT")

                while (isRunning) {
                    try {
                        val clientSocket = serverSocket.accept()
                        handleIncomingConnection(clientSocket)
                    } catch (e: Exception) {
                        if (isRunning) Log.e(TAG, "Server accept error: ${e.message}")
                    }
                }
                serverSocket.close()
            } catch (e: Exception) {
                Log.e(TAG, "Server start error: ${e.message}")
            }
        }.apply { isDaemon = true; start() }
    }

    private fun handleIncomingConnection(socket: Socket) {
        Thread {
            try {
                val input = DataInputStream(socket.inputStream)

                // Read header: [type(1 byte)][nameLength(4 bytes)][name][dataLength(4 bytes)][data]
                val type = input.readByte()
                val nameLength = input.readInt()
                val nameBytes = ByteArray(nameLength)
                input.readFully(nameBytes)
                val senderName = String(nameBytes)

                when (type.toInt()) {
                    1 -> {
                        // Audio data
                        val dataLength = input.readInt()
                        val audioData = ByteArray(dataLength)
                        input.readFully(audioData)

                        Log.d(TAG, "Received audio from $senderName (${audioData.size} bytes)")
                        onAudioReceived?.invoke(audioData, senderName)

                        // MESH RELAY: Forward to all other connected peers
                        relayAudio(audioData, socket.inetAddress.hostAddress ?: "")
                    }
                    2 -> {
                        // Peer registration
                        val peerAddress = socket.inetAddress.hostAddress ?: ""
                        val peerConn = PeerConnection(peerAddress, senderName, PORT)
                        connectedPeers[peerAddress] = peerConn
                        onPeerConnected?.invoke(peerAddress, senderName)
                        onStatusChanged?.invoke("$senderName connected (${connectedPeers.size} peers)")
                        Log.d(TAG, "Peer registered: $senderName at $peerAddress")
                    }
                }

                socket.close()
            } catch (e: Exception) {
                Log.e(TAG, "Handle connection error: ${e.message}")
            }
        }.start()
    }

    private fun connectToServer(serverAddress: String) {
        Thread {
            try {
                val socket = Socket(serverAddress, PORT)
                val output = DataOutputStream(socket.outputStream)

                // Send registration: type=2
                output.writeByte(2)
                val nameBytes = myDeviceName.toByteArray()
                output.writeInt(nameBytes.size)
                output.write(nameBytes)
                output.flush()

                // Register this as a connected peer
                val peerConn = PeerConnection(serverAddress, "GroupOwner", PORT)
                connectedPeers[serverAddress] = peerConn
                onPeerConnected?.invoke(serverAddress, "GroupOwner")

                socket.close()
                Log.d(TAG, "Registered with group owner at $serverAddress")
            } catch (e: Exception) {
                Log.e(TAG, "Connect to server error: ${e.message}")
                onError?.invoke("Could not connect to group owner: ${e.message}")
            }
        }.start()
    }

    // === Cleanup ===

    fun destroy() {
        isRunning = false
        stopDiscovery()
        try {
            context.unregisterReceiver(receiver)
        } catch (_: Exception) {}
        serverThread?.interrupt()
        connectedPeers.clear()
        Log.d(TAG, "WiFi Direct Manager destroyed")
    }

    fun getConnectedPeerCount(): Int = connectedPeers.size

    fun getConnectedPeerNames(): List<String> =
        connectedPeers.values.map { it.peerName }
}

/**
 * Represents a connection to a peer device
 */
class PeerConnection(
    val address: String,
    val peerName: String,
    private val port: Int
) {
    fun sendAudio(audioData: ByteArray, fromName: String) {
        val socket = Socket(address, port)
        val output = DataOutputStream(socket.outputStream)

        // type=1 (audio), name, data
        output.writeByte(1)
        val nameBytes = fromName.toByteArray()
        output.writeInt(nameBytes.size)
        output.write(nameBytes)
        output.writeInt(audioData.size)
        output.write(audioData)
        output.flush()
        socket.close()
    }
}

/**
 * Data class for peer info exposed to JS/UI layer
 */
data class PeerInfo(
    val deviceName: String,
    val deviceAddress: String,
    val isConnected: Boolean
)
