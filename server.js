// JustListenly Core Server (Twilio -> Deepgram -> OpenAI -> ElevenLabs -> Twilio)
// Current version with "Grampa" persona spelling.

import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Deepgram } from '@deepgram/sdk';
import { OpenAI } from 'openai';
import WebSocket from 'ws';

const app = express();
const server = app.listen(process.env.PORT || 8080, () =>
  console.log('Listening on', server.address().port)
);
const wss = new WebSocketServer({ server, path: '/stream' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const dg = new Deepgram(process.env.DEEPGRAM_API_KEY);

// Personas: put your ElevenLabs voice IDs as env vars in Railway.
const PERSONAS = {
  grampa: {
    voiceId: process.env.ELEVEN_GRAMPA || '',
    opening: "I'm ready, kiddo. Tell me what you've got.",
    nudgeCooldownMs: 35000
  },
  grandma: {
    voiceId: process.env.ELEVEN_GRANDMA || '',
    opening: "I’m right here with you.",
    nudgeCooldownMs: 40000
  },
  mom: {
    voiceId: process.env.ELEVEN_MOM || '',
    opening: "I’m here. Take your time.",
    nudgeCooldownMs: 28000
  },
  dad: {
    voiceId: process.env.ELEVEN_DAD || '',
    opening: "I’m listening. Go ahead.",
    nudgeCooldownMs: 28000
  }
};

// Tuning
const SILENCE_MS = 1800;        // wait ~1.8s of silence before speaking
const WINDOW_MS  = 40000;       // reflect on last ~40s of transcript
const MAX_NUDGES_PER_MIN = 3;   // don't over-speak

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

wss.on('connection', async (twilioWS, req) => {
  console.log('Twilio stream connected');
  const url = new URL(req.url, 'http://x');
  // default to grampa if not provided
  const personaKey = url.searchParams.get('persona') || 'grampa';
  const persona = PERSONAS[personaKey] || PERSONAS.grampa;
  const nudgeCooldownMs = persona.nudgeCooldownMs;

  let transcript = [];     // [{t, text}]
  let lastSpeechEnd = Date.now();
  let nudges = [];         // timestamps
  let speakingBack = false;
  let elevenWS = null;

  // Deepgram streaming STT (Twilio sends 8k mu-law)
  const dgConn = await dg.listen.live({
    model: 'nova-2',
    encoding: 'mulaw',
    sample_rate: 8000,
    interim_results: true,
    smart_format: true,
    vad_events: true
  });

  // Receive audio from Twilio and forward to Deepgram
  twilioWS.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.event === 'media' && data.media?.payload) {
        const audio = Buffer.from(data.media.payload, 'base64');
        dgConn.send(audio);
      }
    } catch {}
  });

  twilioWS.on('close', () => {
    try { dgConn.finish(); } catch {}
    try { if (elevenWS) elevenWS.close(); } catch {}
    console.log('Twilio stream closed');
  });

  // Collect final transcripts into rolling window
  dgConn.addListener('transcriptReceived', (dgData) => {
    const ch = dgData.channel?.alternatives?.[0];
    if (!ch) return;
    if (ch.transcript && dgData.is_final) {
      transcript.push({ t: Date.now(), text: ch.transcript });
      const cutoff = Date.now() - WINDOW_MS;
      transcript = transcript.filter(x => x.t >= cutoff);
    }
  });

  // VAD: caller started speaking — cut any AI speech immediately
  dgConn.addListener('speechStarted', () => {
    if (speakingBack && elevenWS && elevenWS.readyState === WebSocket.OPEN) {
      try { elevenWS.close(); } catch {}
      speakingBack = false;
    }
  });

  // VAD: caller stopped speaking — maybe reflect after SILENCE_MS
  dgConn.addListener('speechEnded', () => {
    lastSpeechEnd = Date.now();
    setTimeout(maybeReflect, SILENCE_MS + 50);
  });

  // Persona opener once connected
  setTimeout(() => speakIntoCall(persona.opening, persona.voiceId), 250);

  function canNudge() {
    const now = Date.now();
    nudges = nudges.filter(t => now - t < 60000); // only keep last 60s
    const cooled = (now - lastSpeechEnd) >= SILENCE_MS;
    return cooled && nudges.length < MAX_NUDGES_PER_MIN && !speakingBack;
  }

  async function maybeReflect() {
    if (!canNudge()) return;
    const windowText = transcript.map(x => x.text).join(' ').trim();
    if (!windowText) return;

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
      out = JSON.parse(resp.choices[0].message.content || '{}');
    } catch (e) {
      console.error('OpenAI error', e?.message || e);
      return;
    }

    if (!out || !out.text || out.intent === 'silence') return;
    nudges.push(Date.now());
    await speakIntoCall(out.text, persona.voiceId);
  }

  async function speakIntoCall(text, voiceId) {
    if (!voiceId) return;
    speakingBack = true;

    // Ask ElevenLabs to stream 8k μ-law so we can pass directly to Twilio
    const qs = new URLSearchParams({
      model_id: 'eleven_monolingual_v1',
      format: 'ulaw_8000'
    });

    elevenWS = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?${qs.toString()}`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
    );

    elevenWS.on('open', () => {
      elevenWS.send(JSON.stringify({
        text,
        voice_settings: { stability: 0.55, similarity_boost: 0.7, style: 0.2, use_speaker_boost: true }
      }));
    });

    elevenWS.on('message', (chunk) => {
      const payload = (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('base64');
      try { twilioWS.send(JSON.stringify({ event: 'media', media: { payload } })); } catch {}
    });

    const endSpeak = () => { speakingBack = false; };
    elevenWS.on('close', endSpeak);
    elevenWS.on('error', endSpeak);
  }
});
