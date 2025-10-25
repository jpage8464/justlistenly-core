// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();

// Health check so you can hit the root in a browser and wake Railway
app.get("/", (req, res) => {
  res.status(200).send("✅ JustListenly core running");
});

// Create raw HTTP server that Express sits on
const server = http.createServer(app);

// Make a WebSocketServer in "noServer" mode.
// We will ONLY attach it for /stream upgrades.
const wss = new WebSocketServer({ noServer: true });

// This is the critical part for Twilio streaming.
// Twilio calls wss://<your-domain>/stream and expects a WS upgrade.
// We MUST answer with 101 Switching Protocols here.
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

// Handle an accepted WebSocket connection from Twilio
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

    // Twilio sends three event types: start, media, stop
    if (data.event === "start") {
      console.log("[WS] Stream started");
      console.log("[WS] Persona:", data.start?.customParameters?.persona || "(none)");
      console.log("[WS] Stream SID:", data.start?.streamSid || "(no sid)");
    }

    if (data.event === "media") {
      // Caller audio chunk, base64 PCM16 mono 8kHz
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

// Start the server on the port Railway gives us
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
