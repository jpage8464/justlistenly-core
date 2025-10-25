// server.js
// JustListenly Layer 2: live transcription from Twilio stream
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { transcribeChunkToText } from "./transcription.js";

const app = express();
const server = http.createServer(app);

// quick health check endpoint
app.get("/", (req, res) => {
  res.send("JustListenly core is up");
});

// keep per-connection state
const connectionState = new Map();

// WebSocket Twilio connects to
const wss = new WebSocketServer({ server, path: "/twilio-stream" });

wss.on("connection", (ws) => {
  console.log("📞 New call connected to /twilio-stream");

  connectionState.set(ws, {
    partial: "",
    transcript: []
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    const state = connectionState.get(ws);

    if (msg.event === "start") {
      console.log("▶️ Stream started for callSid:", msg.start?.callSid);
    }

    if (msg.event === "media") {
      const audioB64 = msg.media?.payload;
      if (audioB64) {
        // send each chunk to transcription
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🚀 Server listening on port", PORT));
