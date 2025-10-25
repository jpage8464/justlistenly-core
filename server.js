// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  console.log('[UPGRADE] Request for', req.url);

  // Accept Twilio’s /stream and /stream?query=... paths
  if (req.url && req.url.startsWith('/stream')) {
    console.log('[UPGRADE] Accepting WebSocket upgrade...');
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log('[UPGRADE] Rejected upgrade for', req.url);
    socket.destroy();
  }
});

// When Twilio connects
wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio connected to /stream');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === 'start') {
        console.log('[WS] Stream started');
        console.log('Stream SID:', data.start?.streamSid);
        console.log('Persona:', data.start?.customParameters?.persona);
      }

      if (data.event === 'media') {
        // Incoming audio chunks
      }

      if (data.event === 'stop') {
        console.log('[WS] Stream stopped by Twilio');
        ws.close();
      }
    } catch (err) {
      console.error('[WS] Message error:', err);
    }
  });

  ws.on('close', () => console.log('[WS] Closed'));
  ws.on('error', (err) => console.error('[WS] Error', err));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
