// server.js
// JustListenly core server with WebSocket media stream and fallback HTTP handler

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { transcribeChunkToText } from "./transcription.js";

const app = express();

// Health check
app.get("/", (req, res) => {
  res.send("JustListenly core is up");
});

// IMPORTANT: add HTTP handler for /twilio-stream so Railway won't 502 on probe
app.get("/twilio-stream", (req, res) => {
  console.log("🌐 HTTP GET /twilio-stream (likely a probe/preflight)");
  res.status(200).send("twilio-stream endpoint is WebSocket only");
});

const server = http.createServer(app);

// Per-call state
const connectionState = new Map();

// WebSocket endpoint Twilio should connect to
const wss = new WebSocketServer({
  server,
  path: "/twilio-stream"
});

wss.on("connection", (ws, req) => {
  console.log("📞 New call connected to /twilio-stream via WebSocket");

  connectionState.set(ws, {
    partial: "",
    transcript: []
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.error("❌ Bad JSON from Twilio");
      return;
    }

    const state = connectionState.get(ws);

    if (msg.event === "start") {
      console.log("▶️ Stream started for callSid:", msg.start?.callSid);
    }

    if (msg.event === "media") {
      const audioB64 = msg.media?.payload;
      if (audioB64) {
        // Send chunk to STT
        const text = await transcribeChunkToText(audioB64);

        if (text && text.trim() !== "") {
          state.partial += " " + text.trim();
          console.log("🎙 partial so far:", state.partial.trim());
        }
      }
    }

    if (msg.event === "stop") {
      console.log("⏹ Stream stopped for callSid:", msg.stop?.callSid);

      if (state.partial.trim() !== "") {
        state.transcript.push(state.partial.trim());
        console.log("📝 final chunk:", state.partial.trim());
        state.partial = "";
      }
    }

    if (msg.event === "dtmf") {
      console.log("☎️ Caller pressed:", msg.dtmf?.digits);
    }
  });

  ws.on("close", () => {
    console.log("❌ Call / stream disconnected");

    const state = connectionState.get(ws);
    if (state) {
      console.log("📄 full transcript of call:", state.transcript);
      connectionState.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("🚀 Server listening on port", PORT);
});
