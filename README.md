# Walkie-Talkie App — WiFi Direct Mesh

Offline walkie-talkie for Android using WiFi Direct mesh networking. No internet, no WiFi router, no relay server required.

## How It Works

- Devices discover each other via WiFi Direct (P2P radio)
- One device becomes **Group Owner** (hub) immediately on join — skips slow negotiation
- Other devices auto-connect as clients (~3–5 seconds)
- Channel codes filter who can talk to whom — only devices on the same code communicate
- **Mesh relay**: if A connects to C and C connects to B, audio forwards A→C→B automatically

## Features

- PTT (Push-to-Talk) mode
- Group Call mode (continuous audio)
- Channel/room codes for private groups
- Mesh relay for extended range
- Fully offline — works with no network infrastructure

## Architecture

```
App (React Native / Expo)
│
├── src/screens/ChannelScreen.js   — UI, PTT/call logic, channel handshake
├── App.js                         — Permission requests on launch
│
└── modules/wifi-direct/           — Native Expo module
    ├── index.js                   — JS bridge (requireNativeModule)
    └── android/
        └── .../wifidirect/
            ├── WifiDirectManager.kt     — P2P logic, mesh relay, sockets
            └── WifiDirectExpoModule.kt  — Expo module definition
```

## Connection Flow

1. App opens → requests `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES`
2. User enters channel code → join
3. **`createGroup()`** called → device tries to become Group Owner immediately
4. **`startDiscovery()`** → scans for nearby P2P devices
5. On discovery:
   - If we are GO → wait for clients to connect to us
   - If peer is also GO with lower MAC → we yield, remove group, connect as client
   - If we are not GO → connect to any discovered peer
6. On WiFi Direct link established → send `CHAN:` handshake packet
7. Peer checks channel code → if match, joins the channel peer list
8. PTT/call audio flows between confirmed channel peers

## Channel Handshake Protocol

After every WiFi Direct connection, devices exchange a small JSON packet:
```
CHAN:{"channel":"mycode","user":"Alice"}
```
Only devices with matching channel codes become active peers. Others are ignored.

## Audio Mesh Relay

When the Group Owner receives audio from peer B, it forwards to all other connected peers (e.g., peer C). This enables A↔C↔B communication even if A and B can't see each other directly.

## Build & Deploy

### Requirements
- Android Studio / JDK 17
- Node.js + npm
- `adb` in PATH

### Build APK

```bash
# Install JS dependencies
npm install

# Build (no JS bundle — app fetches from Metro for hot reload)
cd android
./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Hot Reload (JS changes only)

```bash
# Start Metro bundler
npx expo start

# Forward Metro port to device
adb reverse tcp:8081 tcp:8081

# Reload app on device
curl -X POST http://localhost:8081/reload
```

> Native (Kotlin) changes always require a full `./gradlew assembleDebug` rebuild.

### Wireless ADB

```bash
# Pair (one-time per device)
adb pair <IP>:<PAIR_PORT> <CODE>

# Connect
adb connect <IP>:<MAIN_PORT>

# Forward Metro
adb -s <IP>:<PORT> reverse tcp:8081 tcp:8081
```

## Permissions

| Permission | Reason |
|---|---|
| `RECORD_AUDIO` | PTT and group call recording |
| `ACCESS_FINE_LOCATION` | Required by WiFi Direct peer discovery on Android |
| `NEARBY_WIFI_DEVICES` | Required on Android 13+ for WiFi Direct |

## Known Behavior

- First connection: **3–8 seconds** (Group Owner already formed, client just joins)
- Reconnection: **2–4 seconds** (persistent group invitation)
- `BUSY` from P2P stack means an invitation is being processed — no retry needed, broadcast will confirm result
- Two devices both becoming GO: higher MAC address yields automatically
