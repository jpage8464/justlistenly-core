// transcription.js
// Buffer caller audio, then send bigger chunks to Whisper
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1"
});

// Turn Twilio base64 μ-law chunk into raw Buffer
function base64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

// Build an 8kHz mono μ-law WAV wrapper around raw audio
function makeWavMuLaw(bufferMulaw) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bytesPerSample = 1; // μ-law is 8-bit

  const dataSize = bufferMulaw.length;
  const headerSize = 44;
  const fileSize = headerSize - 8 + dataSize;

  const header = Buffer.alloc(headerSize);

  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);     // fmt chunk size
  header.writeUInt16LE(7, 20);      // audio format 7 = μ-law
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
  header.writeUInt16LE(numChannels * bytesPerSample, 32);              // block align
  header.writeUInt16LE(8, 34);      // bits per sample (8-bit μ-law)

  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, bufferMulaw]);
}

// This manages per-call audio buffering so we don't hammer Whisper
export class TranscriptionBuffer {
  constructor() {
    this.bufferParts = []; // raw mulaw chunks
