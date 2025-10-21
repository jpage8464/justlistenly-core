// server.js
import express from 'express';
import { WebSocketServer } from 'ws';
import { Deepgram } from '@deepgram/sdk';
import Twilio from 'twilio';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Init clients
const dg = new Deepgram(process.env.DEEPGRAM_API_KEY);
const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_DOMAIN = process.env.TWILIO_DOMAIN; // e.g. https://justlistenly-core.twil.io

// --- Simple health check
app.get('/', (_req, res) => res.send('JustListenly stream is up'));
const server = app.listen(PORT, () => console.log(`HTTP on :${PORT}`));

// --- WebSocket for Twilio Media Streams
const wss = new WebSocketServer({ server, path: '/stream' });

// Crisis phrase regex (tune as needed)
const CRISIS_RX = /\b(suicide|kill myself|end my life|don't want to live|cant'? go on|hurt myself|harm myself|want to die|end it all)\b/i;

// Helper: send 988 + hangup NOW
async function sendSafetyAndHangup(callSid) {
  if (!callSid || !TWILIO_DOMAIN) return;
  try {
    await twilioClient.calls(callSid).update({
      twiml: `
        <Response>
          <Play>${TWILIO_DOMAIN}/assets/greeter_safety_988.mp3</Play>
          <Hangup/>
        </Response>
      `
    });
    console.log(`[SAFETY] Played 988 & hung up for CallSid=${callSid}`);
  } catch (err) {
    console.error('[SAFETY] Twilio update failed:', err?.message || err);
  }
}

wss.on('connection', (ws, req) => {
  console.log('[WS] Twilio connected');

  // We’ll stash per-call context here
  let callSid = null;
  let persona = 'grandpa';
  let dgConn = null;
  let safetyTriggered = false;

  // Open Deepgram live transcription connection as soon as we get Twilio "start"
  async function openDeepgram() {
    if (dgConn) return;
    dgConn = await dg.transcription.live({
      model: 'nova-2',
      interim_results: true,
      punctuate: true,
      encoding: 'mulaw',      // Twilio sends PCMU
      sample_rate: 8000,
      diarize: false
    });

    dgConn.addListener('open', () => console.log('[DG] open'));
    dgConn.addListener('error', (e) => console.error('[DG] error', e));
    dgConn.addListener('close', () => console.log('[DG] close'));

    // Receive transcripts from Deepgram
    dgConn.addListener('transcriptReceived', async (msg) => {
      if (safetyTriggered) return; // already handled
      try {
        const data = JSON.parse(msg);
        const alts = data?.channel?.alternatives?.[0];
        const text = (alts?.transcript || '').trim();
        const isFinal = data?.is_final;

        if (!text) return;

        // --- SAFETY CHECK (this is the bit you asked about) ---
        if (CRISIS_RX.test(text)) {
          console.log('[SAFETY] Crisis phrase detected:', text);
          safetyTriggered = true;

          // Tell Twilio to play 988 + hang up
          await sendSafetyAndHangup(callSid);

          // Close streams
          try { dgConn?.finish(); } catch {}
          try { ws?.close(); } catch {}
          return;
        }

        // TODO: Your normal AI reply pipeline goes here when not in crisis:
        // 1) Build a gentle listener response (text) from your model.
        // 2) Call ElevenLabs TTS (via your /tts endpoint) to get audio/mpeg.
        // 3) Stream TTS audio back to the caller (e.g., using <Stream> bidirectional bridge or Play URLs).
        // For now, we’re focusing only on safety interrupt.
      } catch (e) {
        console.error('[DG] transcript parse error', e);
      }
    });
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.event) {
        case 'start': {
          // Option 1: Twilio sends CallSid here
          callSid = msg?.start?.callSid || callSid;

          // Option 2: We also sent it from Twilio Function as a <Parameter>
          // Twilio Media Streams may include custom params separately; if you passed them,
          // you can read them here as needed.

          console.log('[WS] start', { callSid });

          // If you passed persona from Twilio Function:
          // e.g., in /start you did stream.parameter({name:'persona', value:'dad'})
          // In Media Streams, the `start.customParameters` is not standard; easiest is you also
          // pass persona in the WebSocket query string (?persona=dad) OR keep one persona per callSid in your own map.
          // If you used query string: e.g., wss://.../stream?persona=dad
          try {
            const url = new URL(req.url, 'wss://placeholder');
            const qPersona = url.searchParams.get('persona');
            if (qPersona) persona = qPersona.toLowerCase();
          } catch {}

          await openDeepgram();
          break;
        }
        case 'media': {
          // Twilio sends base64 PCMU frames
          const payload = msg.media?.payload;
          if (dgConn && payload && !safetyTriggered) {
            const buf = Buffer.from(payload, 'base64');
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
          // other events: mark, etc.
          break;
      }
    } catch (e) {
      console.error('[WS] message parse error', e);
    }
  });

  ws.on('close', () => {
    try { dgConn?.finish(); } catch {}
    console.log('[WS] closed');
  });
});

