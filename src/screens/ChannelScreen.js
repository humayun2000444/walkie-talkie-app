import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { Audio } from 'expo-av';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system';

export default function ChannelScreen({ userName, channelName, mode, onBack }) {
  const [isTalking, setIsTalking] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Initializing...');
  const [messages, setMessages] = useState([]);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [myIp, setMyIp] = useState('');
  const [peerIp, setPeerIp] = useState('');
  const [showPeerInput, setShowPeerInput] = useState(true);
  const recordingRef = useRef(null);
  const groupCallRecordingRef = useRef(null);
  const pollingRef = useRef(null);
  const lastTimestampRef = useRef(0);

  const isGroupCall = mode === 'group-call';
  const PORT = 8765;

  useEffect(() => {
    initAudio();
    getMyIp();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (groupCallRecordingRef.current) {
        groupCallRecordingRef.current.stopAndUnloadAsync();
      }
    };
  }, []);

  const addMessage = (msg) => {
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setMessages((prev) => [`${time} - ${msg}`, ...prev].slice(0, 50));
  };

  const getMyIp = async () => {
    try {
      const ip = await Network.getIpAddressAsync();
      setMyIp(ip);
      addMessage(`Your IP: ${ip}`);
      setStatus(`Channel: ${channelName} • Your IP: ${ip}`);
    } catch (err) {
      addMessage(`Network error: ${err.message}`);
    }
  };

  const initAudio = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Microphone permission is required');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: true,
      });
      addMessage('Audio ready');
    } catch (err) {
      addMessage(`Audio init error: ${err.message}`);
    }
  };

  const connectToPeer = async () => {
    if (!peerIp.trim()) {
      Alert.alert('Error', 'Enter the server IP address');
      return;
    }
    try {
      // POST /join to register on the relay server
      const response = await fetch(`http://${peerIp}:${PORT}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelName, user: userName }),
      });
      const data = await response.json();
      if (data.success) {
        setIsConnected(true);
        setConnectedPeers(data.userCount || 1);
        setShowPeerInput(false);
        setStatus(`Channel: ${channelName} • ${data.userCount} user(s) connected`);
        addMessage(`Joined channel via server ${peerIp}. Users: ${data.userCount}`);
        // Start polling for incoming audio
        startListening();
      } else {
        Alert.alert('Error', 'Failed to join channel');
      }
    } catch (err) {
      Alert.alert('Connection Error', `Could not reach server at ${peerIp}:${PORT}\n${err.message}`);
      addMessage(`Connection failed: ${err.message}`);
    }
  };

  const startListening = () => {
    pollingRef.current = setInterval(async () => {
      try {
        const since = lastTimestampRef.current;
        const url = `http://${peerIp}:${PORT}/receive?channel=${encodeURIComponent(channelName)}&user=${encodeURIComponent(userName)}&since=${since}`;
        const response = await fetch(url).catch(() => null);

        if (response && response.ok) {
          const data = await response.json();
          // Update connected users count
          if (data.userCount) {
            setConnectedPeers(data.userCount);
          }
          if (data.audio && data.audio.audio) {
            lastTimestampRef.current = data.audio.timestamp;
            addMessage(`Receiving audio from ${data.audio.from}...`);
            await playReceivedAudio(data.audio.audio);
          }
        }
      } catch (e) {
        // Silently fail on polling - server may not be ready
      }
    }, 500);
  };

  const playReceivedAudio = async (base64Audio) => {
    try {
      const fileUri = FileSystem.cacheDirectory + 'received_audio.m4a';
      await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) sound.unloadAsync();
      });
    } catch (err) {
      addMessage(`Playback error: ${err.message}`);
    }
  };

  const sendAudioToPeer = async (uri) => {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await fetch(`http://${peerIp}:${PORT}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: userName,
          channel: channelName,
          audio: base64,
        }),
      });
      addMessage('Audio sent!');
    } catch (err) {
      addMessage(`Send error: ${err.message}`);
    }
  };

  // === PTT Mode ===
  const startTalking = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Enter peer IP first');
      return;
    }
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await recording.startAsync();
      recordingRef.current = recording;
      setIsTalking(true);
      setStatus('TRANSMITTING...');
      addMessage('Recording...');
    } catch (err) {
      addMessage(`Recording error: ${err.message}`);
    }
  };

  const stopTalking = async () => {
    try {
      setIsTalking(false);
      setStatus(`Channel: ${channelName} • Connected to ${peerIp}`);

      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;

        if (uri && isConnected) {
          await sendAudioToPeer(uri);
        }
      }
    } catch (err) {
      addMessage(`Error: ${err.message}`);
    }
  };

  // === Group Call Mode ===
  const startGroupCall = async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Enter peer IP first');
      return;
    }
    setIsInCall(true);
    setStatus(`Channel: ${channelName} • In Call`);
    addMessage('Group call started');

    // Continuous recording loop
    continuousRecord();
  };

  const continuousRecord = async () => {
    if (!isInCall) return;
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await recording.startAsync();
      groupCallRecordingRef.current = recording;

      // Record for 2 seconds then send and restart
      setTimeout(async () => {
        if (groupCallRecordingRef.current && isInCall && !isMuted) {
          await groupCallRecordingRef.current.stopAndUnloadAsync();
          const uri = groupCallRecordingRef.current.getURI();
          groupCallRecordingRef.current = null;
          if (uri) await sendAudioToPeer(uri);
          if (isInCall) continuousRecord();
        }
      }, 2000);
    } catch (err) {
      addMessage(`Call error: ${err.message}`);
    }
  };

  const endGroupCall = async () => {
    setIsInCall(false);
    if (groupCallRecordingRef.current) {
      await groupCallRecordingRef.current.stopAndUnloadAsync();
      groupCallRecordingRef.current = null;
    }
    setStatus(`Channel: ${channelName} • Connected`);
    addMessage('Group call ended');
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    addMessage(isMuted ? 'Unmuted' : 'Muted');
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

  // === Group Call Controls UI ===
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
            {connectedPeers} participant{connectedPeers !== 1 ? 's' : ''}
          </Text>
        </View>
      )}
    </View>
  );

  // === PTT Controls UI ===
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
        <View
          style={[styles.badge, { borderColor: isConnected ? '#4CAF50' : '#f44' }]}
        >
          <Text style={[styles.badgeText, { color: isConnected ? '#4CAF50' : '#f44' }]}>
            {isConnected ? 'Connected' : 'Offline'}
          </Text>
        </View>
      </View>

      {/* Mode indicator */}
      <View style={styles.modeIndicator}>
        <Text style={styles.modeText}>
          {isGroupCall ? '📞 Group Call Mode' : '📻 Walkie-Talkie Mode'}
        </Text>
      </View>

      {/* Peer Connection Input */}
      {showPeerInput && (
        <View style={styles.peerConnectContainer}>
          <Text style={styles.myIpText}>Your IP: {myIp}</Text>
          <Text style={styles.instructionText}>
            Enter the server IP (computer running node server.js):
          </Text>
          <View style={styles.peerInputRow}>
            <TextInput
              style={styles.peerInput}
              placeholder="e.g. 192.168.0.205"
              placeholderTextColor="#666"
              value={peerIp}
              onChangeText={setPeerIp}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.connectBtn} onPress={connectToPeer}>
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Activity Log */}
      <View style={styles.logContainer}>
        {messages.length === 0 ? (
          <View style={styles.emptyLog}>
            <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyText}>
              Enter the server IP to connect{'\n'}
              Both phones must be on the same WiFi as the server
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
  // Peer Connect
  peerConnectContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  myIpText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  instructionText: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  peerInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  peerInput: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
  },
  connectBtn: {
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnText: { color: '#fff', fontWeight: 'bold' },
  // Log
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
  emptyText: { color: '#666', textAlign: 'center', lineHeight: 22 },
  messageText: { color: '#999', fontSize: 12, paddingVertical: 2 },
  // PTT
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
  // Group Call
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
