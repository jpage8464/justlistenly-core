// server.js
// Layer 1 of JustListenly:
// - Twilio calls us over WebSocket
// - We log live audio chunks so we know the stream is working

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);

// health check route (lets you hit the URL in a browser)
app.get("/", (req, res) => {
  res.send("JustListenly core is up");
});

// WebSocket endpoint Twilio will connect to
const wss = new WebSocketServer({
  server,
  path: "/twilio-stream"
});

wss.on("connection", (ws, req) => {
  console.log("📞 New call connected to /twilio-stream");

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error("❌ Could not parse incoming WS message", err);
      return;
    }

    // Twilio Media Stream messages have `event` types.
    // Common ones are: "start", "media", "dtmf", "stop"

    if (msg.event === "start") {
      // when the stream starts
      const callSid = msg.start?.callSid;
      console.log("▶️ Stream started for callSid:", callSid);
    }

    if (msg.event === "media") {
      // this is BASE64 encoded audio from the caller's mic
      const audioB64 = msg.media?.payload;
      if (audioB64) {
        // for Layer 1 we just prove we are receiving live audio chunks
        console.log("🎙 audio chunk length (base64):", audioB64.length);
      }
    }

    if (msg.event === "dtmf") {
      // caller pressed a key (like 1,2,3,4)
      const digit = msg.dtmf?.digits;
      console.log("☎️ Caller pressed:", digit);
    }

    if (msg.event === "stop") {
      // Twilio tells us the stream is ending
      const callSid = msg.stop?.callSid;
      console.log("⏹ Stream stopped for callSid:", callSid);
    }
  });

  ws.on("close", () => {
    console.log("❌ Call / stream disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 Server listening on port", PORT);
});

