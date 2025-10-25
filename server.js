// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();

// Basic health check endpoint so you can wake the service in browser
app.get("/", (req, res) => {
  res.status(200).send("✅ JustListenly core running");
});

// Create the raw HTTP server that powers Express
const server = http.createServer(app);

// Create a WebSocketServer in "noServer" mode.
// We'll manually accept upgrades only on /stream.
const wss = new WebSocketServer({ noServer: true });

// Twilio will request wss://.../stream with Upgrade: websocket
// This MUST respond with a 101 Switching Protocols or Twilio will hang up.
server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/stream")) {
    console.log("[UPGRADE] Incoming upgrade for", req.url);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    console.log("[UPGRADE] Rejected upgrade for path:", req.url);
    socket.destroy();
  }
});

// Once Twilio is upgraded to WS, we'll start getting "start", "media", "stop" events
wss.on("connection", (ws, req) => {
  console.log("[WS] Twilio WebSocket CONNECTED");

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[WS] Failed to parse incoming message as JSON:", err);
      return;
    }

    if (data.event === "start") {
      console.log("[WS] Stream started");
      console.log("[WS] Persona:", data.start?.customParameters?.persona || "(none)");
      console.log("[WS] Stream SID:", data.start?.streamSid || "(no sid)");
    }

    if (data.event === "media") {
      // base64-encoded PCM16 mono 8kHz chunks from caller
      if (!ws._loggedFirstFrame) {
        console.log(
          "[WS] First media frame (base64 preview):",
          data.media?.payload?.slice(0, 30) + "..."
        );
        ws._loggedFirstFrame = true;
      }
    }

    if (data.event === "stop") {
      console.log("[WS] Stream stopped");
      ws.close();
    }
  });

  ws.on("close", () => {
    console.log("[WS] Socket closed");
  });

  ws.on("error", (err) => {
    console.error("[WS] Socket error:", err);
  });
});

// Listen on Railway's assigned port
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
