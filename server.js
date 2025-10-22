// server.js — JustListenly live stream backend (Railway)
// Requirements (Railway → Variables):
// PORT=3000
// DEEPGRAM_API_KEY=dg_...
// TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// TWILIO_DOMAIN=https://justlistenly-menu-9576.twil.io   // your Twilio Functions domain
//
// Optional (for your future TTS/reply flow):
// ELEVENLABS_API_KEY=...
// ELEVEN_VOICE_ID_GRAMPA=...
// ELEVEN_VOICE_ID_GRANDMA=...
// ELEVEN_VOICE_ID_MOM=...
// ELEVEN_VOICE_ID_DAD=...

import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import Twilio from 'twilio';

const PORT = process.env.PORT || 3000;

// ---- Safety phrase detection (tune as needed)
const CRISIS_RX =
  /\b(suicide|kill myself|end my life|don't want to live|cant'? ?go on|hurt myself|harm myself|want to die|end it all)\b/i;

// ---- Clients
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_DOMAIN = process.env.TWILIO_DOMAIN; // e.g., https://justlistenly-menu-9576.twil.io
if (!TWILIO_DOMAIN) {
  console.warn(
    '[WARN] TWILIO_DOMAIN not set. 988 playback will fail. Set it in Railway → Variables.'
  );
}

// ---- Express app + health check
const app = express();
app.get('/', (_req, res) => res.send('JustListenly stream is up'));
const server = app.listen(PORT, () =>
  console.log(`[HTTP] Listening on :${PORT}`)
);

// ---- WebSocket: Twilio connects here from /start
const wss = new WebSocketServer({ server, path: '/stream' });

// ---- Tell Twilio to play 988 and hang up immediately
async function sendSafetyAndHangup(callSid) {
  if (!callSid || !TWILIO_DOMAIN) return;
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
    dgConn.on(LiveTranscriptionEvents.Error, (e) =>
      console.error('[DG] error', e)
    );
    dgConn.on(LiveTranscriptionEvents.Close, () => console.log('[DG] close'));

    // Incoming transcripts from Deepgram
    dgConn.on(
      LiveTranscriptionEvents.Transcript,
      async (data /** JSON object */) => {
        if (safetyTriggered) return;

        try {
          const alt = data?.channel?.alternatives?.[0];
          const text = (alt?.transcript || '').t
