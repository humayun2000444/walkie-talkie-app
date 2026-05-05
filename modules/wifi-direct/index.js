import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const WifiDirectMesh = requireNativeModule('WifiDirectMesh');
const emitter = new EventEmitter(WifiDirectMesh);

/**
 * WiFi Direct Mesh Module
 *
 * Usage:
 *   import WifiDirect from './modules/wifi-direct';
 *
 *   await WifiDirect.initialize();
 *   await WifiDirect.startDiscovery();
 *   await WifiDirect.connectToPeer(deviceAddress);
 *   await WifiDirect.sendAudio(base64AudioData);
 *
 * Events:
 *   WifiDirect.onPeerDiscovered(({ peers }) => { ... });
 *   WifiDirect.onPeerConnected(({ deviceAddress, deviceName }) => { ... });
 *   WifiDirect.onAudioReceived(({ audio, from }) => { ... });
 *   WifiDirect.onStatusChanged(({ status }) => { ... });
 */

export default {
  /**
   * Initialize WiFi Direct mesh networking
   */
  initialize: () => WifiDirectMesh.initialize(),

  /**
   * Start discovering nearby peers
   */
  startDiscovery: () => WifiDirectMesh.startDiscovery(),

  /**
   * Stop peer discovery
   */
  stopDiscovery: () => WifiDirectMesh.stopDiscovery(),

  /**
   * Connect to a peer by device address
   * @param {string} deviceAddress - MAC address of the peer
   */
  connectToPeer: (deviceAddress) => WifiDirectMesh.connectToPeer(deviceAddress),

  /**
   * Disconnect from a peer
   * @param {string} deviceAddress - MAC address of the peer
   */
  disconnectFromPeer: (deviceAddress) => WifiDirectMesh.disconnectFromPeer(deviceAddress),

  /**
   * Send audio to all connected peers (with automatic mesh relay)
   * @param {string} base64Audio - Base64 encoded audio data
   */
  sendAudio: (base64Audio) => WifiDirectMesh.sendAudio(base64Audio),

  /**
   * Get number of connected peers
   * @returns {number}
   */
  getConnectedPeerCount: () => WifiDirectMesh.getConnectedPeerCount(),

  /**
   * Get names of connected peers
   * @returns {string[]}
   */
  getConnectedPeerNames: () => WifiDirectMesh.getConnectedPeerNames(),

  /**
   * Destroy and cleanup
   */
  destroy: () => WifiDirectMesh.destroy(),

  // === Event Listeners ===

  /**
   * Called when peers are discovered
   * @param {function} callback - ({ peers: [{ deviceName, deviceAddress, isConnected }] })
   */
  onPeerDiscovered: (callback) => emitter.addListener('onPeerDiscovered', callback),

  /**
   * Called when a peer connects
   * @param {function} callback - ({ deviceAddress, deviceName })
   */
  onPeerConnected: (callback) => emitter.addListener('onPeerConnected', callback),

  /**
   * Called when a peer disconnects
   * @param {function} callback - ({ deviceAddress })
   */
  onPeerDisconnected: (callback) => emitter.addListener('onPeerDisconnected', callback),

  /**
   * Called when audio is received (including relayed audio)
   * @param {function} callback - ({ audio: base64String, from: deviceName })
   */
  onAudioReceived: (callback) => emitter.addListener('onAudioReceived', callback),

  /**
   * Called when status changes
   * @param {function} callback - ({ status: string })
   */
  onStatusChanged: (callback) => emitter.addListener('onStatusChanged', callback),

  /**
   * Called on errors
   * @param {function} callback - ({ error: string })
   */
  onError: (callback) => emitter.addListener('onError', callback),
};
