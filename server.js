// server.js — JustListenly live stream backend (Railway)
// Env (Railway → Variables):
// PORT=3000
// DEEPGRAM_API_KEY=dg_...
// TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// TWILIO_DOMAIN=https://justlistenly-menu-9576.twil.io   // your Twilio Functions domain

import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import Twilio from 'twilio';

const PORT = process.env.PORT || 3000;

// ---- Safety phrase detection (tune as needed)
const CRISIS_RX =
  /\b(suicide|kill myself|end my life|don't want to live|cant'? ?go on|hurt myself|harm myself|want to die|end it all)\b/i;

// ---- Clients
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramApiKey) {
  console.warn('[WARN] DEEPGRAM_API_KEY not set; transcription will fail.');
}
const deepgram = createClient(deepgramApiKey || '');

const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
if (!twilioSid || !twilioToken) {
  console.warn('[WARN] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set; safety hangup will fail.');
}
const twilioClient = Twilio(twilioSid || '', twilioToken || '');

const TWILIO_DOMAIN = process.env.TWILIO_DOMAIN; // e.g., https://justlistenly-menu-9576.twil.io
if (!TWILIO_DOMAIN) {
  console.warn('[WARN] TWILIO_DOMAIN not set. 988 playback will fail.');
}

// ---- Express app + health check
const app = express();
app.get('/', (_req, res) => res.send('JustListenly stream is up'));
const server = app.listen(PORT, () => {
  console.log(`[HTTP] Listening on :${PORT}`);
});

// ---- WebSocket: Twilio connects here from /start
const wss = new WebSocketServer({ server, path: '/stream' });

// ---- Tell Twilio to play 988 and hang up immediately
async function sendSafetyAndHangup(callSid) {
  if (!callSid || !TWILIO_DOMAIN || !twilioSid || !twilioToken) return;
  try {
    await twilioClient.calls(callSid).update({
      twiml: `
        <Response>
          <Play>${TWILIO_DOMAIN}/assets/greeter_safety_988.mp3</Play>
          <Hangup/>
        </Response>
      `,
    });
    console.log(`[SAFETY] Played 988 & hung up (CallSid=${callSid})`);
  } catch (err) {
    console.error('[SAFETY] Twilio update failed:', err?.message || err);
  }
}

wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio connected');

  // Per-call state
  let callSid = null;
  let persona = 'grampa'; // default spelling per your system
  let dgConn = null;
  let safetyTriggered = false;

  // Open Deepgram live transcription (v3 API)
  async function openDeepgram() {
    if (dgConn) return;

    dgConn = await deepgram.listen.live({
      model: 'nova-2',
      interim_results: true,
      punctuate: true,
      encoding: 'mulaw', // Twilio Media Streams sends PCMU
      sample_rate: 8000,
      diarize: false,
    });

    dgConn.on(LiveTranscriptionEvents.Open, () => console.log('[DG] open'));
    dgConn.on(LiveTranscriptionEvents.Error, (e) => console.error('[DG] error', e));
    dgConn.on(LiveTranscriptionEvents.Close, () => console.log('[DG] close'));

    // Incoming transcripts from Deepgram
    dgConn.on(LiveTranscriptionEvents.Transcript, async (data) => {
      if (safetyTriggered) return;

      try {
        const alt = data?.channel?.alternatives?.[0];
        const text = (alt?.transcript || '').trim();
        if (!text) return;

        // ---- SAFETY: detect crisis phrases
        if (CRISIS_RX.test(text)) {
          console.log('[SAFETY] Crisis phrase:', text);
          safetyTriggered = true;

          // Interrupt call: play 988 recording + hang up
          await sendSafetyAndHangup(callSid);

          // Clean up streams
          try { dgConn?.finish(); } catch {}
          try { ws?.close(); } catch {}
          return;
        }

        // ---- TODO: NORMAL REPLY PIPELINE (your AI)
        // 1) Build a brief, empathetic listener response text (model of your choice).
        // 2) Convert to speech via ElevenLabs (voice mapped by persona).
        // 3) Deliver audio back to the caller.
      } catch (e) {
        console.error('[DG] transcript handler error', e);
      }
    });
  }

  // Handle Twilio Media Stream messages
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'start': {
        // Twilio provides CallSid in the start frame
        callSid = msg?.start?.callSid || callSid;
        console.log('[WS] start', { callSid });

        // Read persona from WS query param (?persona=grampa)
        try {
          const url = new URL(req.url, 'wss://placeholder');
          const qp = url.searchParams.get('persona');
          if (qp) persona = qp.toLowerCase();
          console.log('[WS] persona', persona);
        } catch {}

        await openDeepgram();
        break;
      }

      case 'media': {
        // Base64 PCMU frame from Twilio
        const payload = msg?.media?.payload;
        if (dgConn && payload && !safetyTriggered) {
          const buf = Buffer.from(payload, 'base64');
          // Send raw μ-law bytes to Deepgram
          dgConn.send(buf);
        }
        break;
      }

      case 'stop': {
        console.log('[WS] stop');
        try { dgConn?.finish(); } catch {}
        break;
      }

      default:
        // mark, clear, etc.
        break;
    }
  });

  ws.on('close', () => {
    try { dgConn?.finish(); } catch {}
    console.log('[WS] closed');
  });
});

