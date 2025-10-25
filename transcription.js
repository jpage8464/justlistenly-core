// transcription.js — stable Whisper integration for JustListenly
// Converts Twilio base64 μ-law audio chunks into text using OpenAI Whisper

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1" // force explicit endpoint for Railway
});

// Turn base64 (mulaw audio from Twilio Media Stream) into a Buffer
function base64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

// Wrap μ-law 8kHz mono raw audio in a WAV header Whisper will accept
function makeWavMuLaw(bufferMulaw) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bytesPerSample = 1; // 8-bit μ-law

  const dataSize = bufferMulaw.length;
  const headerSize = 44;
  const fileSize = headerSize - 8 + dataSize;

  const header = Buffer.alloc(headerSize);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(7, 20);         // format 7 = μ-law
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
  header.writeUInt16LE(numChannels * bytesPerSample, 32);              // block align
  header.writeUInt16LE(8, 34);         // bits per sample (μ-law is 8-bit)

  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, bufferMulaw]);
}

// Main function we call from server.js
export async function transcribeChunkToText(b64audio) {
  try {
    const rawMulaw = base64ToBuffer(b64audio);
    const wavBuffer = makeWavMuLaw(rawMulaw);

    // Write temp .wav for Whisper
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const tmpPath = path.join(__dirname, `chunk_${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, wavBuffer);

    console.log("🧠 Sending chunk to Whisper...");

    // Send to Whisper
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1"
    });

    // Clean up temp file
    fs.unlinkSync(tmpPath);

    console.log("🗣 Whisper response:", resp.text);

    // Return text (or empty string if nothing detected)
    return resp.text || "";
  } catch (err) {
    console.error(
      "🛑 STT error:",
      err?.response?.status || err.code || err.message || err
    );
    return "";
  }
}
