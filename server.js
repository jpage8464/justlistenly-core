// server.js (final WebSocket-compatible version)
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);

// Health check
app.get("/", (req, res) => res.send("✅ JustListenly core running"));

// Create WebSocket server and attach to HTTP server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrades manually for Twilio streaming
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Handle connected WebSocket clients
wss.on("connection", (ws, req) => {
  console.log("[WS] Twilio WebSocket CONNECTED");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.event === "start") {
        console.log("[WS] Stream started");
        console.log("[WS] Persona:", msg.start?.customParameters?.persona);
      } else if (msg.event === "media") {
        // You can stream audio data here
      } else if (msg.event === "stop") {
        console.log("[WS] Stream stopped");
      }
    } catch (err) {
      console.error("[WS] Error parsing message:", err);
    }
  });

  ws.on("close", () => console.log("[WS] Socket closed"));
  ws.on("error", (err) => console.error("[WS] Socket error:", err));
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
});
