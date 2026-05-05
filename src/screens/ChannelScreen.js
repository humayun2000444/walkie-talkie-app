import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import WifiDirect from '../../modules/wifi-direct';

const CHAN_PREFIX = 'CHAN:';

export default function ChannelScreen({ userName, channelName, mode, onBack }) {
  const [isTalking, setIsTalking] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [status, setStatus] = useState('Scanning for peers...');
  const [messages, setMessages] = useState([]);
  const [channelPeers, setChannelPeers] = useState([]); // confirmed same-channel peers
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  const recordingRef = useRef(null);
  const groupCallRecordingRef = useRef(null);
  const isInCallRef = useRef(false);
  const isMutedRef = useRef(false);
  const subscriptionsRef = useRef([]);
  const rediscoverTimer = useRef(null);

  const [amIGroupOwner, setAmIGroupOwner] = useState(false);
  const isConnected = channelPeers.length > 0;
  const isGroupCall = mode === 'group-call';

  const addMessage = useCallback((msg) => {
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    setMessages((prev) => [`${time} - ${msg}`, ...prev].slice(0, 50));
  }, []);

  // Send a small channel-handshake packet (not audio)
  const sendChannelAnnounce = useCallback(async () => {
    try {
      const msg = CHAN_PREFIX + JSON.stringify({ channel: channelName, user: userName });
      await WifiDirect.sendAudio(btoa(msg));
    } catch (_) {}
  }, [channelName, userName]);

  useEffect(() => {
    initAudio();
    initWifiDirect();
    return () => {
      cleanup();
    };
  }, []);

  const initAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: true,
      });
    } catch (_) {}
  };

  const initWifiDirect = async () => {
    try {
      const subs = [
        WifiDirect.onGroupCreated(() => {
          setAmIGroupOwner(true);
          setStatus('Group Owner — waiting for peers to join...');
          addMessage('Acting as group owner (fastest path)');
        }),

        WifiDirect.onPeerDiscovered(({ peers }) => {
          // Kotlin handles auto-connect and GO conflict resolution automatically.
          // JS just updates status.
          if (peers.length > 0) {
            setStatus(`Found ${peers.length} nearby device(s), connecting...`);
          }
        }),

        WifiDirect.onPeerConnected(({ deviceName }) => {
          addMessage(`Device linked — verifying channel...`);
          // Announce our channel to the newly connected peer
          sendChannelAnnounce();
        }),

        WifiDirect.onPeerDisconnected(() => {
          // Remove peers whose WiFi Direct link dropped
          setChannelPeers((prev) => {
            const updated = prev.slice(0, -1); // simplistic; refine if needed
            return updated;
          });
          addMessage('A peer disconnected');
        }),

        WifiDirect.onAudioReceived(({ audio, from }) => {
          // Check if it's a channel handshake message
          try {
            const decoded = atob(audio);
            if (decoded.startsWith(CHAN_PREFIX)) {
              const data = JSON.parse(decoded.slice(CHAN_PREFIX.length));
              if (data.channel === channelName) {
                setChannelPeers((prev) => {
                  if (prev.find((p) => p.user === data.user)) return prev;
                  return [...prev, { user: data.user, deviceName: from }];
                });
                setStatus(`Channel: ${channelName} • Mesh active`);
                addMessage(`${data.user} joined the channel`);
                // Reply so the other side also discovers us
                sendChannelAnnounce();
              } else {
                addMessage(`Nearby device is on a different channel — ignored`);
              }
              return;
            }
          } catch (_) {
            // Not a text packet — fall through to audio playback
          }
          // Real audio
          addMessage(`Audio from ${from}`);
          playReceivedAudio(audio);
        }),

        WifiDirect.onStatusChanged(({ status: s }) => {
          setStatus(s);
        }),

        WifiDirect.onError(({ error }) => {
          addMessage(`Error: ${error}`);
        }),
      ];
      subscriptionsRef.current = subs;

      await WifiDirect.initialize();
      // Try to become Group Owner immediately — skips slow GO negotiation on connect
      await WifiDirect.createGroup().catch(() => {});
      await WifiDirect.startDiscovery();
      addMessage('Scanning — anyone on the same channel code will appear automatically');

      // Re-run discovery every 60s (WiFi Direct scan times out)
      rediscoverTimer.current = setInterval(() => {
        WifiDirect.startDiscovery().catch(() => {});
      }, 60000);
    } catch (err) {
      addMessage(`WiFi Direct error: ${err.message}`);
    }
  };

  const cleanup = async () => {
    subscriptionsRef.current.forEach((sub) => sub.remove());
    clearInterval(rediscoverTimer.current);
    isInCallRef.current = false;
    if (groupCallRecordingRef.current) {
      await groupCallRecordingRef.current.stopAndUnloadAsync().catch(() => {});
    }
    await WifiDirect.destroy().catch(() => {});
  };

  const playReceivedAudio = async (base64Audio) => {
    try {
      const fileUri = FileSystem.cacheDirectory + 'received_audio.m4a';
      await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.didJustFinish) sound.unloadAsync();
      });
    } catch (err) {
      addMessage(`Playback error: ${err.message}`);
    }
  };

  const sendAudio = async (uri) => {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await WifiDirect.sendAudio(base64);
      addMessage('Transmitted');
    } catch (err) {
      addMessage(`Send error: ${err.message}`);
    }
  };

  // === PTT ===
  const startTalking = async () => {
    if (!isConnected) {
      Alert.alert('No peers on this channel', 'Wait for others to join the same channel code');
      return;
    }
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsTalking(true);
      setStatus('TRANSMITTING...');
    } catch (err) {
      addMessage(`Recording error: ${err.message}`);
    }
  };

  const stopTalking = async () => {
    try {
      setIsTalking(false);
      setStatus(`Channel: ${channelName} • Mesh active`);
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (uri && isConnected) await sendAudio(uri);
      }
    } catch (err) {
      addMessage(`Error: ${err.message}`);
    }
  };

  // === Group Call ===
  const startGroupCall = async () => {
    if (!isConnected) {
      Alert.alert('No peers on this channel', 'Wait for others to join the same channel code');
      return;
    }
    setIsInCall(true);
    isInCallRef.current = true;
    setStatus(`Channel: ${channelName} • In Call`);
    addMessage('Group call started');
    continuousRecord();
  };

  const continuousRecord = async () => {
    if (!isInCallRef.current) return;
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      groupCallRecordingRef.current = recording;

      setTimeout(async () => {
        if (!isInCallRef.current) return;
        if (groupCallRecordingRef.current && !isMutedRef.current) {
          await groupCallRecordingRef.current.stopAndUnloadAsync();
          const uri = groupCallRecordingRef.current.getURI();
          groupCallRecordingRef.current = null;
          if (uri) await sendAudio(uri);
        }
        continuousRecord();
      }, 2000);
    } catch (err) {
      addMessage(`Call error: ${err.message}`);
    }
  };

  const endGroupCall = async () => {
    setIsInCall(false);
    isInCallRef.current = false;
    if (groupCallRecordingRef.current) {
      await groupCallRecordingRef.current.stopAndUnloadAsync().catch(() => {});
      groupCallRecordingRef.current = null;
    }
    setStatus(`Channel: ${channelName} • Mesh active`);
    addMessage('Group call ended');
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;
    addMessage(next ? 'Muted' : 'Unmuted');
  };

  const toggleSpeaker = async () => {
    const newState = !isSpeakerOn;
    setIsSpeakerOn(newState);
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: !newState,
      staysActiveInBackground: true,
    });
    addMessage(newState ? 'Speaker on' : 'Earpiece');
  };

  const renderMessage = ({ item }) => (
    <Text style={styles.messageText}>{item}</Text>
  );

  const renderChannelPeer = ({ item }) => (
    <View style={styles.peerItem}>
      <View style={styles.peerDot} />
      <Text style={styles.peerName}>{item.user}</Text>
    </View>
  );

  const renderGroupCallControls = () => (
    <View style={styles.groupCallContainer}>
      {!isInCall ? (
        <TouchableOpacity style={styles.startCallButton} onPress={startGroupCall}>
          <Text style={styles.callButtonIcon}>📞</Text>
          <Text style={styles.startCallText}>Start Group Call</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.inCallControls}>
          <View style={styles.callStatusContainer}>
            <View style={styles.callPulse} />
            <Text style={styles.callActiveText}>Call Active</Text>
          </View>
          <View style={styles.callButtonsRow}>
            <TouchableOpacity
              style={[styles.callControlBtn, isMuted && styles.callControlBtnActive]}
              onPress={toggleMute}
            >
              <Text style={styles.callControlIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
              <Text style={styles.callControlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endCallButton} onPress={endGroupCall}>
              <Text style={styles.endCallIcon}>📵</Text>
              <Text style={styles.endCallLabel}>End</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.callControlBtn, !isSpeakerOn && styles.callControlBtnActive]}
              onPress={toggleSpeaker}
            >
              <Text style={styles.callControlIcon}>{isSpeakerOn ? '🔊' : '🔈'}</Text>
              <Text style={styles.callControlLabel}>{isSpeakerOn ? 'Speaker' : 'Earpiece'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.callPeersText}>
            {channelPeers.length + 1} participant{channelPeers.length !== 0 ? 's' : ''}
          </Text>
        </View>
      )}
    </View>
  );

  const renderPTTControls = () => (
    <View style={styles.pttContainer}>
      <TouchableOpacity
        style={[styles.pttButton, isTalking && styles.pttButtonActive]}
        onPressIn={startTalking}
        onPressOut={stopTalking}
        activeOpacity={0.8}
      >
        <Text style={styles.pttIcon}>{isTalking ? '🎙️' : '🎤'}</Text>
        <Text style={[styles.pttText, isTalking && { color: '#ff4444' }]}>
          {isTalking ? 'RELEASE' : 'HOLD TO TALK'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.channelTitle}>{channelName.toUpperCase()}</Text>
          <Text style={[styles.statusText, (isTalking || isInCall) && { color: '#ff4444' }]}>
            {status}
          </Text>
        </View>
        <View style={[styles.badge, { borderColor: isConnected ? '#4CAF50' : '#FF8C00' }]}>
          <Text style={[styles.badgeText, { color: isConnected ? '#4CAF50' : '#FF8C00' }]}>
            {isConnected ? `${channelPeers.length} peer${channelPeers.length !== 1 ? 's' : ''}` : 'Scanning'}
          </Text>
        </View>
      </View>

      {/* Mode indicator */}
      <View style={styles.modeIndicator}>
        <Text style={styles.modeText}>
          {isGroupCall ? '📞 Group Call Mode' : '📻 Walkie-Talkie Mode'}
          {amIGroupOwner ? '  •  Hub' : '  •  Client'}
        </Text>
      </View>

      {/* Channel peers (confirmed same channel) */}
      {channelPeers.length > 0 && (
        <View style={styles.peersPanel}>
          <Text style={styles.peersPanelTitle}>On this channel</Text>
          <FlatList
            data={channelPeers}
            renderItem={renderChannelPeer}
            keyExtractor={(item) => item.user}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peersListContent}
          />
        </View>
      )}

      {/* Activity Log */}
      <View style={styles.logContainer}>
        {messages.length === 0 ? (
          <View style={styles.emptyLog}>
            <Text style={styles.emptyIcon}>📡</Text>
            <Text style={styles.emptyText}>
              Scanning for devices on channel{'\n'}
              <Text style={{ color: '#FF8C00', fontWeight: 'bold' }}>{channelName}</Text>
              {'\n\n'}Anyone who joins the same channel code{'\n'}will appear here automatically
            </Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(_, index) => index.toString()}
          />
        )}
      </View>

      {/* Controls */}
      {isGroupCall ? renderGroupCallControls() : renderPTTControls()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'android' ? 40 : 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: { padding: 8 },
  backText: { color: '#fff', fontSize: 16 },
  headerCenter: { flex: 1, alignItems: 'center' },
  channelTitle: { color: '#FF8C00', fontSize: 18, fontWeight: 'bold' },
  statusText: { color: '#888', fontSize: 12, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: { fontSize: 12 },
  modeIndicator: {
    alignItems: 'center',
    paddingVertical: 8,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255, 140, 0, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 140, 0, 0.3)',
  },
  modeText: { color: '#FF8C00', fontSize: 13, fontWeight: '600' },
  peersPanel: { marginHorizontal: 16, marginTop: 12 },
  peersPanelTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  peersListContent: { gap: 8 },
  peerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 8,
  },
  peerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  peerName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  logContainer: {
    flex: 1,
    margin: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  emptyLog: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#666', textAlign: 'center', lineHeight: 24 },
  messageText: { color: '#999', fontSize: 12, paddingVertical: 2 },
  pttContainer: { alignItems: 'center', paddingVertical: 24 },
  pttButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255, 140, 0, 0.2)',
    borderWidth: 4,
    borderColor: '#FF8C00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pttButtonActive: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    borderColor: '#ff4444',
    elevation: 10,
  },
  pttIcon: { fontSize: 48 },
  pttText: { color: '#FF8C00', fontSize: 11, fontWeight: 'bold', marginTop: 8 },
  groupCallContainer: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  startCallButton: {
    width: '100%',
    height: 64,
    backgroundColor: '#4CAF50',
    borderRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callButtonIcon: { fontSize: 24, marginRight: 12 },
  startCallText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  inCallControls: { width: '100%', alignItems: 'center' },
  callStatusContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  callPulse: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4CAF50', marginRight: 8 },
  callActiveText: { color: '#4CAF50', fontSize: 16, fontWeight: 'bold' },
  callButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 16,
  },
  callControlBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  callControlBtnActive: { backgroundColor: 'rgba(255, 0, 0, 0.2)', borderColor: '#ff4444' },
  callControlIcon: { fontSize: 24 },
  callControlLabel: { color: '#aaa', fontSize: 10, marginTop: 4 },
  endCallButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f44336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endCallIcon: { fontSize: 28 },
  endCallLabel: { color: '#fff', fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  callPeersText: { color: '#888', fontSize: 12 },
});
