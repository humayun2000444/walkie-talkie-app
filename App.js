import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PermissionsAndroid, Platform, Alert } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ChannelScreen from './src/screens/ChannelScreen';

async function requestAllPermissions() {
  if (Platform.OS !== 'android') return;

  const perms = [
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];
  if (Platform.Version >= 33) {
    perms.push('android.permission.NEARBY_WIFI_DEVICES');
  }

  const results = await PermissionsAndroid.requestMultiple(perms);
  const denied = Object.entries(results)
    .filter(([, v]) => v !== PermissionsAndroid.RESULTS.GRANTED)
    .map(([k]) => k.split('.').pop());

  if (denied.length > 0) {
    Alert.alert(
      'Permissions Required',
      `Please grant: ${denied.join(', ')}.\n\nGo to Settings → Apps → Walkie Talkie → Permissions.`
    );
  }
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [config, setConfig] = useState({ userName: '', channelName: '', mode: 'walkie-talkie' });

  useEffect(() => {
    requestAllPermissions();
  }, []);

  const joinChannel = (userName, channelName, mode) => {
    setConfig({ userName, channelName, mode });
    setScreen('channel');
  };

  return (
    <>
      <StatusBar style="light" />
      {screen === 'home' ? (
        <HomeScreen onJoinChannel={joinChannel} />
      ) : (
        <ChannelScreen
          userName={config.userName}
          channelName={config.channelName}
          mode={config.mode}
          onBack={() => setScreen('home')}
        />
      )}
    </>
  );
}
