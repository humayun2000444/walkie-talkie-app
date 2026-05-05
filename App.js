import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import ChannelScreen from './src/screens/ChannelScreen';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [config, setConfig] = useState({ userName: '', channelName: '', mode: 'walkie-talkie' });

  const joinChannel = (userName, channelName, mode) => {
    setConfig({ userName, channelName, mode });
    setScreen('channel');
  };

  const goBack = () => {
    setScreen('home');
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
          onBack={goBack}
        />
      )}
    </>
  );
}
