// Simple LAN relay server for Walkie Talkie
// Run this on any device on the same WiFi: node server.js
// Both phones connect to this server's IP

const http = require('http');

const channels = {}; // { channelName: { audioQueue: [], users: [] } }

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // POST /join - Join a channel
  if (req.method === 'POST' && req.url === '/join') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { channel, user } = JSON.parse(body);
      if (!channels[channel]) {
        channels[channel] = { audioQueue: [], users: [] };
      }
      if (!channels[channel].users.includes(user)) {
        channels[channel].users.push(user);
      }
      console.log(`[${channel}] ${user} joined. Users: ${channels[channel].users.join(', ')}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        users: channels[channel].users,
        userCount: channels[channel].users.length
      }));
    });
    return;
  }

  // POST /send - Send audio to channel
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { channel, from, audio } = JSON.parse(body);
      if (!channels[channel]) {
        channels[channel] = { audioQueue: [], users: [] };
      }
      channels[channel].audioQueue.push({ from, audio, timestamp: Date.now() });
      // Keep only last 10 audio clips
      if (channels[channel].audioQueue.length > 10) {
        channels[channel].audioQueue.shift();
      }
      console.log(`[${channel}] Audio from ${from} (${(audio.length / 1024).toFixed(1)} KB)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // GET /receive?channel=X&user=Y&since=timestamp - Get new audio
  if (req.method === 'GET' && req.url.startsWith('/receive')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channel = url.searchParams.get('channel');
    const user = url.searchParams.get('user');
    const since = parseInt(url.searchParams.get('since') || '0');

    if (!channels[channel]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audio: null, users: [] }));
      return;
    }

    // Get audio NOT from this user, newer than 'since'
    const newAudio = channels[channel].audioQueue.find(
      (a) => a.from !== user && a.timestamp > since
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      audio: newAudio || null,
      users: channels[channel].users,
      userCount: channels[channel].users.length,
    }));
    return;
  }

  // GET /status - Server status
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: true,
      channels: Object.keys(channels).map((ch) => ({
        name: ch,
        users: channels[ch].users,
      })),
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = 8765;
server.listen(PORT, '0.0.0.0', () => {
  const interfaces = require('os').networkInterfaces();
  let localIp = 'localhost';
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        localIp = addr.address;
        break;
      }
    }
  }
  console.log(`\n🎙️  Walkie Talkie Relay Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Running on: http://${localIp}:${PORT}`);
  console.log(`\nTell both phones to enter this IP: ${localIp}`);
  console.log(`Both phones must be on the same WiFi network.\n`);
});
