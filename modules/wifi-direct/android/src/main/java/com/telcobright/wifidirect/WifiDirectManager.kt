package com.telcobright.wifidirect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.*
import android.net.wifi.p2p.WifiP2pManager.*
import android.net.wifi.WpsInfo
import android.os.Build
import android.util.Log
import java.net.*
import java.io.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

class WifiDirectManager(private val context: Context) {

    companion object {
        private const val TAG = "WifiDirectMesh"
        private const val PORT = 9876
    }

    private var manager: WifiP2pManager? = null
    private var channel: Channel? = null

    // Bidirectional peer connections (one socket per peer, used for both send & receive)
    private val connectedPeers = ConcurrentHashMap<String, PeerConnection>()
    private val connectingPeers = ConcurrentHashMap.newKeySet<String>()
    private val discoveredPeers = CopyOnWriteArrayList<WifiP2pDevice>()

    var onPeerDiscovered: ((List<PeerInfo>) -> Unit)? = null
    var onPeerConnected: ((String, String) -> Unit)? = null
    var onPeerDisconnected: ((String) -> Unit)? = null
    var onAudioReceived: ((ByteArray, String) -> Unit)? = null
    var onStatusChanged: ((String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null
    var onGroupCreated: (() -> Unit)? = null

    private var serverThread: Thread? = null
    private var serverSocket: ServerSocket? = null
    private var isRunning = false

    private var myDeviceName: String = "Unknown"
    private var myDeviceAddress: String = ""
    private var isGroupOwner = false
    private var autonomousGO = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val state = intent.getIntExtra(EXTRA_WIFI_STATE, -1)
                    if (state == WIFI_P2P_STATE_ENABLED) {
                        onStatusChanged?.invoke("WiFi Direct enabled")
                    } else {
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
                                isConnected = connectedPeers.containsKey(device.deviceAddress),
                                isGroupOwner = getGroupCapability(device)
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
                        Log.i(TAG, "WiFi P2P disconnected — cleaning up")
                        connectingPeers.clear()
                        autonomousGO = false
                        // Stop streaming if active
                        if (audioStreamer.isActive()) {
                            audioStreamer.stopStreaming()
                        }
                        // Notify JS for each connected peer
                        for ((addr, _) in connectedPeers) {
                            onPeerDisconnected?.invoke(addr)
                        }
                        closeAllPeers()
                        onStatusChanged?.invoke("Disconnected — scanning for peers")
                        // Restart discovery so user can reconnect
                        startDiscovery()
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
        Log.i(TAG, "Initialized")
    }

    fun startDiscovery() {
        manager?.discoverPeers(channel, object : ActionListener {
            override fun onSuccess() {
                onStatusChanged?.invoke("Discovering peers...")
                Log.i(TAG, "Discovery started")
            }
            override fun onFailure(reason: Int) {
                if (reason == BUSY) {
                    Log.w(TAG, "Discovery busy, retrying in 3s")
                    Thread { Thread.sleep(3000); if (isRunning) startDiscovery() }.start()
                } else {
                    onError?.invoke("Discovery failed: $reason")
                }
            }
        })
    }

    fun stopDiscovery() { manager?.stopPeerDiscovery(channel, null) }

    fun createGroup() {
        manager?.createGroup(channel, object : ActionListener {
            override fun onSuccess() {
                autonomousGO = true; isGroupOwner = true
                onStatusChanged?.invoke("Group Owner — waiting for peers")
                onGroupCreated?.invoke()
                Log.i(TAG, "Group created (GO)")
            }
            override fun onFailure(reason: Int) {
                Log.w(TAG, "createGroup failed: $reason")
            }
        })
    }

    fun getDeviceAddress(): String = myDeviceAddress
    fun getDeviceName(): String = myDeviceName

    private fun getGroupCapability(device: WifiP2pDevice): Boolean {
        return try {
            val field = WifiP2pDevice::class.java.getField("groupCapability")
            (field.getInt(device) and 0x01) != 0
        } catch (_: Exception) { false }
    }

    fun connectToPeer(deviceAddress: String) {
        if (connectingPeers.contains(deviceAddress) || connectedPeers.containsKey(deviceAddress)) return
        connectingPeers.add(deviceAddress)
        val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
            wps.setup = WpsInfo.PBC
            groupOwnerIntent = 0
        }
        if (autonomousGO) {
            autonomousGO = false; isGroupOwner = false
            manager?.removeGroup(channel, object : ActionListener {
                override fun onSuccess() { doConnect(config) }
                override fun onFailure(r: Int) { doConnect(config) }
            })
        } else { doConnect(config) }
    }

    private fun doConnect(config: WifiP2pConfig) {
        manager?.connect(channel, config, object : ActionListener {
            override fun onSuccess() {
                onStatusChanged?.invoke("Connecting...")
                Log.i(TAG, "Connect initiated to ${config.deviceAddress}")
            }
            override fun onFailure(reason: Int) {
                connectingPeers.remove(config.deviceAddress)
                if (reason != BUSY) onError?.invoke("Connection failed: $reason")
            }
        })
    }

    fun disconnectFromPeer(deviceAddress: String) {
        manager?.removeGroup(channel, object : ActionListener {
            override fun onSuccess() {
                connectedPeers.remove(deviceAddress)?.close()
                onPeerDisconnected?.invoke(deviceAddress)
            }
            override fun onFailure(reason: Int) { onError?.invoke("Disconnect failed: $reason") }
        })
    }

    private fun handleConnectionInfo(info: WifiP2pInfo) {
        isGroupOwner = info.isGroupOwner
        val goAddress = info.groupOwnerAddress?.hostAddress ?: return

        if (isGroupOwner) {
            onStatusChanged?.invoke("Connected as Group Owner")
            Log.i(TAG, "I am GO at $goAddress — waiting for client socket")
            // GO: server will accept the client's connection
        } else {
            onStatusChanged?.invoke("Connected — establishing link...")
            Log.i(TAG, "I am client, connecting to GO at $goAddress")
            connectBidirectional(goAddress)
        }
    }

    // === Bidirectional socket: client side ===

    private fun connectBidirectional(serverAddress: String) {
        Thread {
            for (attempt in 1..5) {
                try {
                    val socket = Socket()
                    socket.tcpNoDelay = true
                    socket.connect(InetSocketAddress(serverAddress, PORT), 5000)

                    val output = DataOutputStream(BufferedOutputStream(socket.outputStream, 65536))
                    val input = DataInputStream(BufferedInputStream(socket.inputStream, 65536))

                    // Send registration
                    output.writeByte(2)
                    val nameBytes = myDeviceName.toByteArray()
                    output.writeInt(nameBytes.size)
                    output.write(nameBytes)
                    output.flush()

                    val peer = PeerConnection(serverAddress, "GroupOwner", socket, output)
                    connectingPeers.remove(serverAddress)
                    connectedPeers[serverAddress] = peer
                    onPeerConnected?.invoke(serverAddress, "GroupOwner")
                    onStatusChanged?.invoke("Connected to GroupOwner")
                    Log.i(TAG, "Connected to GO at $serverAddress (bidirectional)")

                    // Read loop: receive audio from GO on this same socket
                    readLoop(input, serverAddress)
                    return@Thread
                } catch (e: Exception) {
                    Log.w(TAG, "Connect attempt $attempt: ${e.message}")
                    Thread.sleep(1000)
                }
            }
            onError?.invoke("Could not connect to group owner")
        }.apply { isDaemon = true; start() }
    }

    // === Bidirectional socket: server side (GO accepts client) ===

    private fun startServer() {
        serverThread = Thread {
            for (attempt in 1..5) {
                try {
                    val s = ServerSocket()
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(PORT))
                    serverSocket = s
                    break
                } catch (e: Exception) {
                    Log.w(TAG, "Port $PORT busy (attempt $attempt/5): ${e.message}")
                    Thread.sleep(2000)
                }
            }
            if (serverSocket == null) {
                onError?.invoke("Audio server could not start (port busy)")
                return@Thread
            }
            Log.i(TAG, "Server listening on port $PORT")
            while (isRunning) {
                try {
                    val clientSocket = serverSocket?.accept() ?: break
                    clientSocket.tcpNoDelay = true
                    acceptBidirectional(clientSocket)
                } catch (e: Exception) {
                    if (isRunning) Log.e(TAG, "Server accept error: ${e.message}")
                }
            }
            serverSocket?.close(); serverSocket = null
        }.apply { isDaemon = true; start() }
    }

    private fun acceptBidirectional(socket: Socket) {
        Thread {
            val peerAddress = socket.inetAddress?.hostAddress ?: ""
            try {
                val input = DataInputStream(BufferedInputStream(socket.inputStream, 65536))
                val output = DataOutputStream(BufferedOutputStream(socket.outputStream, 65536))

                // Read registration
                val regType = input.readByte()
                if (regType.toInt() != 2) {
                    Log.w(TAG, "Expected registration, got type=$regType from $peerAddress")
                    socket.close()
                    return@Thread
                }
                val nameLen = input.readInt()
                val nameBuf = ByteArray(nameLen)
                input.readFully(nameBuf)
                val peerName = String(nameBuf)

                // Store peer with output stream for sending back
                val peer = PeerConnection(peerAddress, peerName, socket, output)
                connectedPeers[peerAddress] = peer
                onPeerConnected?.invoke(peerAddress, peerName)
                onStatusChanged?.invoke("$peerName connected")
                Log.i(TAG, "Accepted $peerName at $peerAddress (bidirectional)")

                // Read loop: receive audio from client on this same socket
                readLoop(input, peerAddress)
            } catch (e: Exception) {
                if (isRunning) Log.e(TAG, "Accept error from $peerAddress: ${e.message}")
            } finally {
                connectedPeers.remove(peerAddress)?.close()
                onPeerDisconnected?.invoke(peerAddress)
                Log.i(TAG, "Peer $peerAddress disconnected")
            }
        }.apply { isDaemon = true; start() }
    }

    // === Shared read loop for both sides ===

    private fun readLoop(input: DataInputStream, peerAddress: String) {
        try {
            while (isRunning) {
                val type = input.readByte()
                when (type.toInt()) {
                    1 -> {
                        // File-based audio (PTT mode)
                        val nameLen = input.readInt()
                        val nameBuf = ByteArray(nameLen)
                        input.readFully(nameBuf)
                        val fromName = String(nameBuf)

                        val dataLen = input.readInt()
                        val audioData = ByteArray(dataLen)
                        input.readFully(audioData)

                        onAudioReceived?.invoke(audioData, fromName)

                        // Relay
                        for ((addr, peer) in connectedPeers) {
                            if (addr != peerAddress) {
                                try { peer.sendAudio(audioData, fromName) } catch (_: Exception) {}
                            }
                        }
                    }
                    3 -> {
                        // Streaming PCM audio (group call) — play directly
                        val dataLen = input.readInt()
                        val pcmData = ByteArray(dataLen)
                        input.readFully(pcmData)

                        // Play immediately via native AudioTrack
                        audioStreamer.playAudio(pcmData)

                        // Relay to other peers
                        for ((addr, peer) in connectedPeers) {
                            if (addr != peerAddress) {
                                try { peer.sendStreamAudio(pcmData) } catch (_: Exception) {}
                            }
                        }
                    }
                    else -> {
                        Log.w(TAG, "Unknown message type=$type from $peerAddress, skipping")
                    }
                }
            }
        } catch (e: java.io.EOFException) {
            Log.i(TAG, "Peer $peerAddress EOF")
        } catch (e: Exception) {
            if (isRunning) Log.w(TAG, "Read error from $peerAddress: ${e.message}")
        }
    }

    // === Send audio to all peers ===

    fun sendAudio(audioData: ByteArray) {
        val peers = connectedPeers.toMap()
        if (peers.isEmpty()) return
        Thread {
            for ((address, peer) in peers) {
                try {
                    peer.sendAudio(audioData, myDeviceName)
                } catch (e: Exception) {
                    Log.e(TAG, "Send failed to $address: ${e.message}")
                    connectedPeers.remove(address)?.close()
                    onPeerDisconnected?.invoke(address)
                }
            }
        }.start()
    }

    private fun closeAllPeers() {
        for ((_, peer) in connectedPeers) { peer.close() }
        connectedPeers.clear()
    }

    fun destroy() {
        isRunning = false
        if (audioStreamer.isActive()) audioStreamer.stopStreaming()
        stopDiscovery()
        try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
        try { serverSocket?.close(); serverSocket = null } catch (_: Exception) {}
        closeAllPeers()
        serverThread?.interrupt()
        Log.i(TAG, "Destroyed")
    }

    fun getConnectedPeerCount(): Int = connectedPeers.size
    fun getConnectedPeerNames(): List<String> = connectedPeers.values.map { it.peerName }

    // === Native Audio Streaming ===

    private val audioStreamer = AudioStreamer()

    fun startGroupCallStream() {
        audioStreamer.onAudioCaptured = { pcmData ->
            // Send raw PCM to all peers (type=3 for streaming audio)
            val peers = connectedPeers.toMap()
            for ((address, peer) in peers) {
                try {
                    peer.sendStreamAudio(pcmData)
                } catch (e: Exception) {
                    Log.e(TAG, "Stream send failed to $address: ${e.message}")
                    connectedPeers.remove(address)?.close()
                    onPeerDisconnected?.invoke(address)
                }
            }
        }
        audioStreamer.startStreaming()
        Log.i(TAG, "Group call stream started")
    }

    fun stopGroupCallStream() {
        audioStreamer.stopStreaming()
        Log.i(TAG, "Group call stream stopped")
    }

    fun setStreamMuted(muted: Boolean) {
        audioStreamer.setMuted(muted)
    }

    fun playStreamAudio(pcmData: ByteArray) {
        audioStreamer.playAudio(pcmData)
    }

    fun isStreamActive(): Boolean = audioStreamer.isActive()
}

class PeerConnection(
    val address: String,
    val peerName: String,
    private val socket: Socket,
    private val output: DataOutputStream
) {
    private val sendLock = Any()

    fun sendAudio(audioData: ByteArray, fromName: String) {
        synchronized(sendLock) {
            output.writeByte(1)
            val nameBytes = fromName.toByteArray()
            output.writeInt(nameBytes.size)
            output.write(nameBytes)
            output.writeInt(audioData.size)
            output.write(audioData)
            output.flush()
        }
    }

    fun sendStreamAudio(pcmData: ByteArray) {
        synchronized(sendLock) {
            output.writeByte(3)  // type=3 for streaming PCM
            output.writeInt(pcmData.size)
            output.write(pcmData)
            output.flush()
        }
    }

    fun close() {
        try { socket.close() } catch (_: Exception) {}
    }
}

data class PeerInfo(
    val deviceName: String,
    val deviceAddress: String,
    val isConnected: Boolean,
    val isGroupOwner: Boolean = false
)
