// server.js
import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('JustListenly core is running');
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

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

    if (data.event === 'start') {
      console.log('[WS] Stream started');
      console.log('[WS] Stream SID:', data.start?.streamSid);
      console.log('[WS] Persona:', data.start?.customParameters?.persona);
    }

    if (data.event === 'media') {
      // audio chunks
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});

