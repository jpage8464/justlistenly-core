// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();

// Health check so you can ping the root in a browser
app.get("/", (req, res) => {
  res.status(200).send("✅ JustListenly core running");
});

// Create a raw HTTP server that Express sits on
const server = http.createServer(app);

// Create a WebSocket server, but don't bind it to a path yet.
// We'll manually upgrade only /stream.
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests (Twilio will hit /stream with Upgrade: websocket)
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

// When Twilio has successfully upgraded to WebSocket
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

    // Twilio sends JSON events: start, media, stop
    if (data.event === "start") {
      console.log("[WS] Stream started");
      console.log("[WS] Persona:", data.start?.customParameters?.persona || "(none)");
      console.log("[WS] Stream SID:", data.start?.streamSid || "(no sid)");
    }

    if (data.event === "media") {
      // This is caller audio. It's base64 PCM16 8kHz mono.
      // We won't log every frame (too spammy), but we can log the first frame.
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

// Start listening on the port Railway assigned
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
