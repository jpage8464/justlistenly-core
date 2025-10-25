// index.js (Railway)
// node index.js

const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const app = express();

// Basic health check so you know deployment is running
app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

// Create raw HTTP server so we can manually handle WebSocket upgrade
const server = http.createServer(app);

// Create a WS server, but DO NOT attach it globally to all routes.
// We'll manually allow only /stream.
const wss = new WebSocket.Server({ noServer: true });

// Upgrade handler: only accept WebSocket if the path is /stream
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/stream') {
    console.log('[UPGRADE] Incoming upgrade for /stream');
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log('[UPGRADE] Rejected upgrade for path:', req.url);
    socket.destroy();
  }
});

// When Twilio successfully connects via <Connect><Stream>, we land here:
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio connected to /stream');

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      console.error('[WS] Failed to parse message as JSON', e);
      return;
    }

    if (data.event === 'start') {
      console.log('[WS] Stream started from Twilio');
      console.log('[WS] Stream SID:', data.start?.streamSid);
      console.log('[WS] Persona from Twilio:', data.start?.customParameters?.persona);
    }

    if (data.event === 'media') {
      // Caller audio chunk
      // data.media.payload is base64-encoded PCM16 8k mono
      // For now we're not replying. Silence is fine.
    }

    if (data.event === 'stop') {
      console.log('[WS] Stream stopped by Twilio');
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[WS] WebSocket closed');
  });

  ws.on('error', (err) => {
    console.error('[WS] WebSocket error', err);
  });
});

// Start HTTP server (and WS upgrade path piggybacks on it)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});

