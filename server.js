// server.js
// JustListenly Core - WebSocket bridge for Twilio
// ESM-compatible (because package.json uses "type": "module")

import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

// 1. Create Express app (for health check / browser test)
const app = express();

app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

// 2. Create raw HTTP server so we can control WebSocket upgrades
const server = http.createServer(app);

// 3. Create a WebSocket server that we’ll manually attach to /stream
const wss = new WebSocketServer({ noServer: true });

// 4. Accept WebSocket upgrade ONLY on /stream
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

// 5. Handle active WS connection from Twilio
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio connected to /stream');

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      console.error('[WS] Failed to parse message as JSON', err);
      return;
    }

    // Twilio media stream events look like:
    // { "event": "start", "start": { "streamSid": "...", "customParameters": { "persona": "grandpa" } } }
    // { "event": "media", "media": { "payload": "base64..." } }
    // { "event": "stop", "stop": { ... } }

    if (data.event === 'start') {
      console.log('[WS] Stream started');
      console.log('[WS] Stream SID:', data.start?.streamSid);
      console.log('[WS] Persona:', data.start?.customParameters?.persona);
    }

    if (data.event === 'media') {
      // Caller audio chunk (base64 PCM16 8k mono).
      // We are not responding yet, so we do nothing here.
      // Silence is fine. Twilio will keep the call open.
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

// 6. Start HTTP server on Railway’s port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});

