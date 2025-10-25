// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();

// Simple health check
app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is awake and ready.');
});

// Create HTTP server
const server = http.createServer(app);

// Create a WebSocket server (not attached globally)
const wss = new WebSocketServer({ noServer: true });

// Handle Twilio's WebSocket upgrade
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

// Handle new WS connection
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio WebSocket CONNECTED');

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (err) {
      console.error('[WS] Bad JSON:', err);
      return;
    }

    switch (data.event) {
      case 'start':
        console.log('[WS] Stream started');
        break;
      case 'media':
        // Avoid spamming logs with media frames
        break;
      case 'stop':
        console.log('[WS] Stream stopped');
        ws.close();
        break;
      default:
        console.log('[WS] Event:', data.event);
    }
  });

  ws.on('close', () => console.log('[WS] Socket closed'));
  ws.on('error', (err) => console.error('[WS] Error:', err));
});

// Force Railway to use the correct port & keep-alive
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening securely on port ${PORT}`);
});
