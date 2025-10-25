// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();

// Simple health check route
app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is awake and ready.');
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server (noServer mode lets us manually accept upgrades)
const wss = new WebSocketServer({ noServer: true });

// Handle Twilio WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
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

// Handle live WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio WebSocket CONNECTED');

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (err) {
      console.error('[WS] Invalid JSON received:', err);
      return;
    }

    switch (data.event) {
      case 'start':
        console.log('[WS] Stream started');
        console.log('[WS] Persona:', data.start?.customParameters?.persona || 'unknown');
        console.log('[WS] Stream SID:', data.start?.streamSid || 'none');
        break;

      case 'media':
        // Log only the first few characters of the first few frames
        // (Twilio sends 50 frames per second — don’t log all)
        if (!ws.loggedFirstFrame) {
          console.log('[WS] First media frame received (base64 preview):', data.media.payload.slice(0, 30) + '...');
          ws.loggedFirstFrame = true;
        }
        break;

      case 'stop':
        console.log('[WS] Stream stopped');
        console.log('[WS] Socket closing now...');
        ws.close();
        break;

      default:
        console.log('[WS] Unhandled event type:', data.event);
    }
  });

  ws.on('close', () => console.log('[WS] Socket closed'));
  ws.on('error', (err) => console.error('[WS] Error:', err));
});

// Force Railway to use correct port
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
