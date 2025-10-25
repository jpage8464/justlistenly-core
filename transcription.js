// transcription.js — final stable version for Whisper on Railway
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1" // explicitly set for Railway connectivity
});

// Convert base64 μ-law audio to a buffer
function base64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

// Add minimal WAV header for μ-law 8kHz mono (Twilio format)
function makeWavMuLaw(bufferMulaw) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bytesPerSample = 1;
  const dataSize = bufferMulaw.length;
  const headerSize = 44;
  const fileSize = headerSize - 8 + dataSize;

  const header = Buffer.alloc(headerSize);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(7, 20); // 7 = μ-law
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  header.writeUInt16LE(numChannels * bytesPerSample, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, bufferMulaw]);
}

export async function transcribeChunkToText(b64audio) {
  try {
    const rawMulaw = base64ToBuffer(b64audio);
    const wavBuffer = makeWavMuLaw(rawMulaw);

    // Save a temporary file for Whisper
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const tmpPath = path.join(__dirname, `chunk_${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, wavBuffer);

    console.log("🧠 Sending chunk to Whisper...");

    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
