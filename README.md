# Walkie-Talkie App — WiFi Direct Mesh

Offline walkie-talkie for Android using WiFi Direct mesh networking. No internet, no WiFi router, no relay server required.

## How It Works

- Devices discover each other via WiFi Direct (P2P radio)
- Manual peer discovery — tap a nearby device to connect
- Channel codes filter who can talk to whom — only devices on the same code communicate
- **Mesh relay**: if A connects to C and C connects to B, audio forwards A→C→B automatically

## Features

- PTT (Push-to-Talk) mode — hold to talk, release to send
- Group Call mode — native real-time audio streaming with echo cancellation
- Manual peer discovery with tap-to-connect UI
- Channel/room codes for private groups
- Mesh relay for extended range
- Fully offline — works with no network infrastructure

## Architecture

```
App (React Native / Expo)
│
├── src/screens/
│   ├── HomeScreen.js          — Name, channel code, mode selection
│   └── ChannelScreen.js       — PTT/call logic, peer list, channel handshake
├── App.js                     — Permission requests on launch
│
└── modules/wifi-direct/       — Native Expo module
    ├── index.js               — JS bridge (requireNativeModule)
    └── android/
        └── .../wifidirect/
            ├── WifiDirectManager.kt      — P2P logic, bidirectional sockets, mesh relay
            ├── WifiDirectExpoModule.kt   — Expo module bridge
            └── AudioStreamer.kt          — Native real-time audio (AudioRecord/AudioTrack + AEC)
```

## Native Audio Streaming (Group Call)

Group call uses native Android audio APIs for WhatsApp-like quality:

- **AudioRecord** with `VOICE_COMMUNICATION` source — enables platform-level echo cancellation
- **AudioTrack** in `STREAM_VOICE_CALL` mode — low-latency playback
- **AcousticEchoCanceler** — prevents hearing your own voice echoed back
- **NoiseSuppressor** — reduces background noise
- **20ms PCM frames** (640 bytes at 16kHz mono 16-bit) — near real-time
- **No file I/O, no base64** — raw PCM bytes sent directly over persistent TCP sockets

## Connection Flow

1. App opens → requests `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES`
2. User enters name + channel code → join
3. `startDiscovery()` scans for nearby P2P devices
4. Discovered devices appear in **"Nearby Devices"** list
5. User taps a device → `connectToPeer()` initiates WiFi Direct connection
6. Other device accepts invitation (first time only — Android remembers pairing)
7. Bidirectional persistent TCP socket established between peers
8. `CHAN:` handshake verifies both peers are on the same channel
9. PTT or Group Call audio flows between confirmed channel peers

## Network Architecture

```
┌─────────────┐     Persistent TCP      ┌─────────────┐
│   Client     │◄──── (bidirectional) ───►│  Group Owner │
│  AudioRecord │      Port 9876          │  AudioRecord │
│  AudioTrack  │      TCP_NODELAY        │  AudioTrack  │
│  AEC + NS    │      64KB buffers       │  AEC + NS    │
└─────────────┘                          └─────────────┘
```

- Single socket per peer pair — used for both sending and receiving
- `TCP_NODELAY` disables Nagle's algorithm for instant sends
- 64KB buffered I/O streams for throughput
- Type=1: file-based audio (PTT), Type=3: streaming PCM (group call)

## Channel Handshake Protocol

After WiFi Direct connection, devices exchange a JSON packet:
```
CHAN:{"channel":"mycode","user":"Alice"}
```
Only devices with matching channel codes become active peers. Reply sent only once per new peer to prevent flooding.

## Build & Deploy

### Requirements
- Android Studio / JDK 17
- Node.js + npm
- `adb` in PATH

### Build APK

```bash
npm install

# Full build (JS + native)
npx expo export --platform android
cp dist/_expo/static/js/android/*.hbc android/app/src/main/assets/index.android.bundle
cd android && ./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Native-only rebuild (Kotlin changes)

```bash
cd android && ./gradlew assembleDebug
```

### JS-only rebuild

```bash
npx expo export --platform android
cp dist/_expo/static/js/android/*.hbc android/app/src/main/assets/index.android.bundle
cd android && ./gradlew assembleDebug
```

### Wireless ADB

```bash
adb pair <IP>:<PAIR_PORT> <CODE>
adb connect <IP>:<PORT>
```

## Permissions

| Permission | Reason |
|---|---|
| `RECORD_AUDIO` | PTT and group call recording |
| `ACCESS_FINE_LOCATION` | Required by WiFi Direct peer discovery on Android |
| `NEARBY_WIFI_DEVICES` | Required on Android 13+ for WiFi Direct |

## Known Behavior

- First connection: **3–8 seconds** (WiFi Direct pairing + invitation)
- Reconnection: **2–4 seconds** (Android remembers pairing)
- Discovery auto-retries when P2P stack is busy
- End call stops both recording and playback immediately
- Disconnect auto-restarts discovery for reconnection
- Server socket properly cleaned up on destroy (no port-busy on restart)
