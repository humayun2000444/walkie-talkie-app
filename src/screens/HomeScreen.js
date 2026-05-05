import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';

export default function HomeScreen({ onJoinChannel }) {
  const [userName, setUserName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [selectedMode, setSelectedMode] = useState('walkie-talkie');

  const handleJoin = () => {
    if (!userName.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!channelName.trim()) {
      Alert.alert('Error', 'Please enter a channel name');
      return;
    }
    onJoinChannel(userName.trim(), channelName.trim(), selectedMode);
  };

  return (
    <View style={styles.container}>
      {/* App Icon */}
      <View style={styles.iconContainer}>
        <Text style={styles.iconText}>📡</Text>
      </View>

      <Text style={styles.title}>Walkie Talkie</Text>
      <Text style={styles.subtitle}>WiFi Direct • No Internet Required</Text>

      {/* Name Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputIcon}>👤</Text>
        <TextInput
          style={styles.input}
          placeholder="Your Name"
          placeholderTextColor="#666"
          value={userName}
          onChangeText={setUserName}
        />
      </View>

      {/* Channel Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputIcon}>📻</Text>
        <TextInput
          style={styles.input}
          placeholder="Channel Name"
          placeholderTextColor="#666"
          value={channelName}
          onChangeText={setChannelName}
        />
      </View>

      {/* Mode Selection */}
      <Text style={styles.modeLabel}>Select Mode</Text>
      <View style={styles.modeContainer}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            selectedMode === 'walkie-talkie' && styles.modeButtonActive,
          ]}
          onPress={() => setSelectedMode('walkie-talkie')}
        >
          <Text style={styles.modeIcon}>🎤</Text>
          <Text
            style={[
              styles.modeButtonText,
              selectedMode === 'walkie-talkie' && styles.modeButtonTextActive,
            ]}
          >
            Walkie-Talkie
          </Text>
          <Text style={styles.modeDesc}>Push to Talk</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.modeButton,
            selectedMode === 'group-call' && styles.modeButtonActive,
          ]}
          onPress={() => setSelectedMode('group-call')}
        >
          <Text style={styles.modeIcon}>📞</Text>
          <Text
            style={[
              styles.modeButtonText,
              selectedMode === 'group-call' && styles.modeButtonTextActive,
            ]}
          >
            Group Call
          </Text>
          <Text style={styles.modeDesc}>Open Mic</Text>
        </TouchableOpacity>
      </View>

      {/* Join Button */}
      <TouchableOpacity style={styles.joinButton} onPress={handleJoin}>
        <Text style={styles.joinButtonText}>
          {selectedMode === 'group-call' ? 'Join Group Call' : 'Join Channel'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.rangeText}>Range: ~200m via WiFi Direct</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 165, 0, 0.2)',
    borderWidth: 2,
    borderColor: '#FF8C00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconText: {
    fontSize: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  inputIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 52,
    color: '#fff',
    fontSize: 16,
  },
  modeLabel: {
    color: '#888',
    fontSize: 13,
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginTop: 8,
  },
  modeContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginBottom: 20,
  },
  modeButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: '#FF8C00',
    backgroundColor: 'rgba(255, 140, 0, 0.1)',
  },
  modeIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  modeButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modeButtonTextActive: {
    color: '#FF8C00',
  },
  modeDesc: {
    color: '#555',
    fontSize: 11,
    marginTop: 4,
  },
  joinButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#FF8C00',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  rangeText: {
    color: '#555',
    fontSize: 12,
    marginTop: 16,
  },
});
