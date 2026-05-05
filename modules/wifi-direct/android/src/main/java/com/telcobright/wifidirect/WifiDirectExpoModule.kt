package com.telcobright.wifidirect

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import android.util.Base64

/**
 * Expo Module that bridges the Kotlin WifiDirectManager to JavaScript.
 * This allows the React Native / Expo app to use WiFi Direct mesh features.
 */
class WifiDirectExpoModule : Module() {

    private var wifiDirectManager: WifiDirectManager? = null

    override fun definition() = ModuleDefinition {
        Name("WifiDirectMesh")

        // Events that can be sent to JS
        Events(
            "onPeerDiscovered",
            "onPeerConnected",
            "onPeerDisconnected",
            "onAudioReceived",
            "onStatusChanged",
            "onError",
            "onGroupCreated"
        )

        // Initialize WiFi Direct
        AsyncFunction("initialize") { promise: Promise ->
            try {
                val context = appContext.reactContext ?: throw Exception("No context")
                wifiDirectManager = WifiDirectManager(context)

                wifiDirectManager?.onPeerDiscovered = { peers ->
                    val peerList = peers.map { mapOf(
                        "deviceName" to it.deviceName,
                        "deviceAddress" to it.deviceAddress,
                        "isConnected" to it.isConnected,
                        "isGroupOwner" to it.isGroupOwner
                    )}
                    sendEvent("onPeerDiscovered", mapOf("peers" to peerList))
                }

                wifiDirectManager?.onGroupCreated = {
                    sendEvent("onGroupCreated", emptyMap<String, Any>())
                }

                wifiDirectManager?.onPeerConnected = { address, name ->
                    sendEvent("onPeerConnected", mapOf(
                        "deviceAddress" to address,
                        "deviceName" to name
                    ))
                }

                wifiDirectManager?.onPeerDisconnected = { address ->
                    sendEvent("onPeerDisconnected", mapOf("deviceAddress" to address))
                }

                wifiDirectManager?.onAudioReceived = { audioData, fromDevice ->
                    val base64Audio = Base64.encodeToString(audioData, Base64.NO_WRAP)
                    sendEvent("onAudioReceived", mapOf(
                        "audio" to base64Audio,
                        "from" to fromDevice
                    ))
                }

                wifiDirectManager?.onStatusChanged = { status ->
                    sendEvent("onStatusChanged", mapOf("status" to status))
                }

                wifiDirectManager?.onError = { error ->
                    sendEvent("onError", mapOf("error" to error))
                }

                wifiDirectManager?.initialize()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", e.message, e)
            }
        }

        // Start peer discovery
        AsyncFunction("startDiscovery") { promise: Promise ->
            try {
                wifiDirectManager?.startDiscovery()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("DISCOVERY_ERROR", e.message, e)
            }
        }

        // Stop peer discovery
        AsyncFunction("stopDiscovery") { promise: Promise ->
            try {
                wifiDirectManager?.stopDiscovery()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STOP_ERROR", e.message, e)
            }
        }

        // Create an autonomous P2P group (become Group Owner immediately)
        AsyncFunction("createGroup") { promise: Promise ->
            try {
                wifiDirectManager?.createGroup()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CREATE_GROUP_ERROR", e.message, e)
            }
        }

        // Get this device's WiFi Direct address
        Function("getDeviceAddress") {
            wifiDirectManager?.getDeviceAddress() ?: ""
        }

        // Connect to a peer by address
        AsyncFunction("connectToPeer") { deviceAddress: String, promise: Promise ->
            try {
                wifiDirectManager?.connectToPeer(deviceAddress)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CONNECT_ERROR", e.message, e)
            }
        }

        // Disconnect from a peer
        AsyncFunction("disconnectFromPeer") { deviceAddress: String, promise: Promise ->
            try {
                wifiDirectManager?.disconnectFromPeer(deviceAddress)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("DISCONNECT_ERROR", e.message, e)
            }
        }

        // Send audio (base64 encoded) to all connected peers
        AsyncFunction("sendAudio") { base64Audio: String, promise: Promise ->
            try {
                val audioData = Base64.decode(base64Audio, Base64.NO_WRAP)
                wifiDirectManager?.sendAudio(audioData)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SEND_ERROR", e.message, e)
            }
        }

        // Get connected peer count
        Function("getConnectedPeerCount") {
            wifiDirectManager?.getConnectedPeerCount() ?: 0
        }

        // Get connected peer names
        Function("getConnectedPeerNames") {
            wifiDirectManager?.getConnectedPeerNames() ?: emptyList<String>()
        }

        // Cleanup
        AsyncFunction("destroy") { promise: Promise ->
            try {
                wifiDirectManager?.destroy()
                wifiDirectManager = null
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("DESTROY_ERROR", e.message, e)
            }
        }
    }
}
