// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();

// Health check
app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

const server = http.createServer(app);

// Create WS server, manually upgraded
const wss = new WebSocketServer({ noServer: true });

// 1. Log EVERY upgrade attempt, even if it's not /stream
server.on('upgrade', (req, socket, head) => {
  console.log('---');
  console.log('[UPGRADE] Got upgrade attempt');
  console.log('[UPGRADE] URL:', req.url);
  console.log('[UPGRADE] Headers:', req.headers);

  // Accept /stream OR /stream?anything
  if (req.url && req.url.startsWith('/stream')) {
    console.log('[UPGRADE] -> Accepting as Twilio stream');
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log('[UPGRADE] -> Rejecting (not /stream)');
    socket.destroy();
  }
});

// 2. When Twilio is connected over WS
wss.on('connection', (ws, req) => {
  console.log('[WS] ✅ Twilio WebSocket CONNECTED');

  ws.on('message', (message) => {
    console.log('[WS] Raw message from Twilio:', message.toString());

    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (err) {
      console.error('[WS] Failed to parse as JSON:', err);
      return;
    }

    if (data.event === 'start') {
      console.log('[WS] Stream START event');
      console.log('[WS] Stream SID:', data.start?.streamSid);
      console.log('[WS] Persona:', data.start?.customParameters?.persona);
    }

    if (data.event === 'media') {
      console.log('[WS] MEDIA chunk received (caller audio)');
      // data.media.payload = base64 PCM16 mono 8kHz
    }

    if (data.event === 'stop') {
      console.log('[WS] STOP event from Twilio');
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[WS] Socket CLOSED');
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket ERROR', err);
  });
});

// 3. Start server using Railway PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});

