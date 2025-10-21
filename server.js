// JustListenly Core (Deepgram v3 compatible) — Twilio -> Deepgram -> OpenAI -> ElevenLabs -> Twilio
import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { OpenAI } from 'openai';
import WebSocket from 'ws';

// --- App & health ---
const app = express();
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log('Listening on', PORT);
});

);

// --- Crash guards ---
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

// --- Env helpers ---
function need(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) console.warn(`WARN: Missing env ${name}`);
  return v;
}
const OPENAI_API_KEY = need('OPENAI_API_KEY');
const DEEPGRAM_API_KEY = need('DEEPGRAM_API_KEY');
const ELEVENLABS_API_KEY = need('ELEVENLABS_API_KEY');

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const deepgram = createClient(DEEPGRAM_API_KEY);

// Personas (Grampa spelling)
const PERSONAS = {
  grampa: { voiceId: process.env.ELEVEN_GRAMPA || '', opening: "I'm ready, kiddo. Tell me what you've got." },
  grandma:{ voiceId: process.env.ELEVEN_GRANDMA || '', opening: "I’m right here with you." },
  mom:    { voiceId: process.env.ELEVEN_MOM || '',     opening: "I’m here. Take your time." },
  dad:    { voiceId: process.env.ELEVEN_DAD || '',     opening: "I’m listening. Go ahead." }
};

// Tuning
const SILENCE_MS = 1800;      // reflect after ~1.8s of silence
const WINDOW_MS  = 40000;     // look back ~40s
const MAX_NUDGES_PER_MIN = 3; // guardrail

const EMPATHY_PROMPT = `
You are a nonjudgmental, empathetic listener.
Return ONLY JSON: {"intent":"reflect|affirm|celebrate|clarify|silence","text":"...","wait_seconds": number}
Rules:
- ≤14 words. Echo content or feeling. Warm and gentle.
- No advice, no should/could/would, no judgments, no contradictions.
- Match emotional tone (sad/mad/anxious/proud). If unsure, neutral support.
- If long pause and they seem stuck, you MAY ask one open question.
- If self-harm/danger implied: intent="affirm" and text="I’m here with you. You’re not alone."
`;

const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', async (twilioWS, req) => {
  console.log('Twilio stream connected');

  const url = new URL(req.url, 'http://x');
  const personaKey = url.searchParams.get('persona') || 'grampa';
  const persona = PERSONAS[personaKey] || PERSONAS.grampa;

  // State
  let transcript = []; // [{t, text}]
  let lastFinalAt = Date.now();
  let nudges = [];     // timestamps
  let silenceTimer = null;
  let speakingBack = false;
  let elevenWS = null;

  // --- Deepgram v3 live connection ---
  let dgConn;
  try {
    dgConn = deepgram.listen.live({
      model: 'nova-2',
      encoding: 'mulaw',
      sample_rate: 8000,
      interim_results: true,
      smart_format: true
      // NOTE: VAD events changed in v3; we implement silence with a timer instead.
    });
  } catch (e) {
    console.error('Deepgram connect failed:', e?.message || e);
    try { twilioWS.close(); } catch {}
    return;
  }

  // Open: send opener (if voice configured)
  dgConn.on(LiveTranscriptionEvents.Open, () => {
    if (persona.voiceId && ELEVENLABS_API_KEY) {
      setTimeout(() => speakIntoCall(persona.opening, persona.voiceId), 250);
    } else {
      console.warn('No voice configured for persona:', personaKey);
    }
  });

  // Each transcript packet (final or interim)
  dgConn.on(LiveTranscriptionEvents.Transcript, (data) => {
    try {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt) return;
      const text = alt.transcript || '';
      if (!text) return;

      // If the caller is speaking (we get audio), force barge-in: stop AI immediately
      if (speakingBack && elevenWS && elevenWS.readyState === WebSocket.OPEN) {
        try { elevenWS.close(); } catch {}
        speakingBack = false;
      }

      // Only aggregate finals into our rolling window
      if (data.is_final) {
        transcript.push({ t: Date.now(), text });
        const cutoff = Date.now() - WINDOW_MS;
        transcript = transcript.filter(x => x.t >= cutoff);
        lastFinalAt = Date.now();

        // restart silence timer
        if (silenceTimer) { clearTimeout(silenceTimer); }
        silenceTimer = setTimeout(maybeReflect, SILENCE_MS);
      }
    } catch (e) {
      console.error('Transcript handler error:', e?.message || e);
    }
  });

  dgConn.on(LiveTranscriptionEvents.Close, () => {
    // Deepgram closed; end call stream gracefully
    try { if (elevenWS) elevenWS.close(); } catch {}
    try { twilioWS.close(); } catch {}
  });

  dgConn.on(LiveTranscriptionEvents.Error, (e) => {
    console.error('Deepgram error:', e);
  });

  // Forward audio from Twilio -> Deepgram
  twilioWS.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.event === 'media' && data.media?.payload) {
        const audio = Buffer.from(data.media.payload, 'base64');
        dgConn.send(audio);
      }
    } catch (e) {
      console.error('Parse/forward error:', e?.message || e);
    }
  });

  twilioWS.on('close', () => {
    console.log('Twilio stream closed');
    try { dgConn.close(); } catch {}
    try { if (elevenWS) elevenWS.close(); } catch {}
    if (silenceTimer) clearTimeout(silenceTimer);
  });

  function canNudge() {
    const now = Date.now();
    nudges = nudges.filter(t => now - t < 60000);
    const enoughSilence = (now - lastFinalAt) >= SILENCE_MS;
    return enoughSilence && nudges.length < MAX_NUDGES_PER_MIN && !speakingBack;
  }

  async function maybeReflect() {
    if (!canNudge()) return;
    const windowText = transcript.map(x => x.text).join(' ').trim();
    if (!windowText) return;
    if (!openai) { console.warn('No OPENAI_API_KEY; skipping reflection'); return; }

    let out;
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: EMPATHY_PROMPT },
          { role: 'user', content: `USER WINDOW (last ~40s): ${windowText}` }
        ]
      });
      const content = resp?.choices?.[0]?.message?.content || '';
      out = JSON.parse(content);
    } catch (e) {
      console.error('OpenAI or JSON parse error:', e?.message || e);
      return;
    }

    if (!out || !out.text || out.intent === 'silence') return;
    nudges.push(Date.now());
    await speakIntoCall(out.text, persona.voiceId);
  }

  async function speakIntoCall(text, voiceId) {
    if (!voiceId) { console.warn('speakIntoCall called without voiceId'); return; }
    if (!ELEVENLABS_API_KEY) { console.warn('No ELEVENLABS_API_KEY set'); return; }
    speakingBack = true;

    const qs = new URLSearchParams({ model_id: 'eleven_monolingual_v1', format: 'ulaw_8000' });

    let ws;
    try {
      ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?${qs.toString()}`,
        { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
      );
      elevenWS = ws;
    } catch (e) {
      console.error('ElevenLabs WS create error:', e?.message || e);
      speakingBack = false;
      return;
    }

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          text,
          voice_settings: { stability: 0.55, similarity_boost: 0.7, style: 0.2, use_speaker_boost: true }
        }));
      } catch (e) {
        console.error('ElevenLabs send error:', e?.message || e);
      }
    });

    ws.on('message', (chunk) => {
      try {
        const payload = (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('base64');
        twilioWS.send(JSON.stringify({ event: 'media', media: { payload } }));
      } catch (e) {
        console.error('Forward to Twilio error:', e?.message || e);
      }
    });

    const endSpeak = () => { speakingBack = false; };
    ws.on('close', endSpeak);
    ws.on('error', (e) => { console.error('ElevenLabs WS error:', e?.message || e); endSpeak(); });
  }
});

