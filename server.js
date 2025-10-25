// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();

// Health check so hitting the root URL wakes the service
app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

const server = http.createServer(app);

// Create WS server but don't attach globally
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrades from Twilio
server.on('upgrade', (req, socket, head) => {
  // Accept /stream or /stream?...
  if (req.url && req.url.startsWith('/stream')) {
    console.log('[UPGRADE] Accepting WS upgrade for', req.url);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log('[UPGRADE] Rejecting upgrade for', req.url);
    socket.destroy();
  }
});

// When Twilio successfully connects
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio WebSocket CONNECTED');

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (err) {
      console.error('[WS] Could not parse incoming message as JSON', err);
      return;
    }

    if (data.event === 'start') {
      console.log('[WS] Stream started');
      console.log('[WS] Persona:', data.start?.customParameters?.persona);
      console.log('[WS] Stream SID:', data.start?.streamSid);
    }

    if (data.event === 'media') {
      // Caller audio frames
      // We can add console.log here later, but logging every chunk can be VERY spammy.
    }

    if (data.event === 'stop') {
      console.log('[WS] Stream stopped');
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[WS] Socket closed');
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error', err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});

