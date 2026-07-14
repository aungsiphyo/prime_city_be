require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const os = require("os");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const setupMQTT = require("./src/services/mqtt");

const app = express();
const PORT = Number(process.env.PORT || 5001);
const VALID_QR_TOKEN =
  process.env.VALID_QR_TOKEN || "VISITOR_ACCESS_2024_SECRET";
const UNLOCK_TIMEOUT = parseInt(process.env.UNLOCK_TIMEOUT_SECS || "30", 10);

function getLocalLanIp() {
  const interfaces = os.networkInterfaces();

  for (const details of Object.values(interfaces)) {
    for (const address of details || []) {
      if (
        address?.family === "IPv4" &&
        !address.internal &&
        !isDockerBridgeIp(address.address)
      ) {
        return address.address;
      }
    }
  }

  return "https://smart-residential.onrender.com/";
}

function isDockerBridgeIp(ip) {
  return /^172\.(1[6-9]|2\d|3[01])\./.test(String(ip || ""));
}

function getRequestBaseUrl(req) {
  const host = req?.get?.("host");
  if (!host) return "";

  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "http";

  return `${protocol}://${host}`;
}

function getRegistrationFormUrl(req) {
  if (process.env.REGISTRATION_FORM_URL) {
    return process.env.REGISTRATION_FORM_URL.trim();
  }

  if (process.env.PUBLIC_BASE_URL) {
    return `${process.env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/register`;
  }

  const requestBaseUrl = getRequestBaseUrl(req);
  if (requestBaseUrl) return `${requestBaseUrl}/register`;

  return `/register`;
}

const sseClients = new Map();
let nextSseClientId = 1;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  }),
);

app.use(express.static(path.join(__dirname, "public")));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ DB Error:", err));

app.set("sseClients", sseClients);

app.get("/api/events", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);

  const clientId = nextSseClientId++;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;

    cleanedUp = true;
    clearInterval(keepAlive);
    sseClients.delete(clientId);

    if (!res.writableEnded) {
      res.end();
    }
  };

  sseClients.set(clientId, { req, res, cleanup });

  res.write("retry: 3000\n");
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      ok: true,
      registrationUrl: getRegistrationFormUrl(req),
      timestamp: new Date().toISOString(),
    })}\n\n`,
  );

  const keepAlive = setInterval(() => {
    if (req.destroyed || res.writableEnded) {
      cleanup();
      return;
    }

    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", cleanup);
  req.on("end", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
});

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const [clientId, client] of sseClients.entries()) {
    const { req, res, cleanup } = client;

    if (req.destroyed || res.writableEnded) {
      cleanup();
      continue;
    }

    try {
      res.write(msg);
      res.flush?.();
    } catch (err) {
      console.error(`SSE write failed for client ${clientId}:`, err.message);
      cleanup();
    }
  }
}

app.post("/api/qr-scan", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "No token provided",
    });
  }

  if (token !== VALID_QR_TOKEN) {
    console.log("❌ Invalid badge token received");
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }

  console.log(
    "✅ Valid visitor badge scanned — broadcasting unlock to display",
  );

  broadcastSSE("unlock", {
    url: getRegistrationFormUrl(req),
    timeout: UNLOCK_TIMEOUT,
    timestamp: new Date().toISOString(),
  });

  const io = app.get("io");
  if (io) {
    io.emit("visitor:badge-scanned", {
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    message: "Display unlocked",
  });
});

app.get("/api/qr-image", async (req, res) => {
  try {
    const text = String(req.query.text || "").trim();
    const requestedSize = Number(req.query.size || 260);
    const size = Math.max(160, Math.min(requestedSize || 260, 1200));

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "Missing text query parameter",
      });
    }

    const png = await QRCode.toBuffer(text, {
      type: "png",
      width: size,
      margin: 1,
      color: {
        dark: "#1A1A2E",
        light: "#FFFFFF",
      },
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
  } catch (err) {
    console.error("QR image generation failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate QR image",
    });
  }
});

// ================= EXISTING ROUTES =================
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/protected", require("./src/routes/protected"));
app.use("/api/admin", require("./src/routes/admin"));
app.use("/api/rooms", require("./src/routes/roomRoutes"));
app.use("/api/advertisements", require("./src/routes/advertisementRoutes"));
app.use("/api/notifications", require("./src/routes/notification"));
app.use("/api/sos", require("./src/routes/sos"));

app.use("/api/parking", require("./src/routes/parking"));
app.use("/api/announcements", require("./src/routes/announcement"));
app.use("/api/reports", require("./src/routes/report"));
app.use("/api/helper-requests", require("./src/routes/helperRequest"));
app.use("/api/helpers", require("./src/routes/helper"));
app.use("/api/bills", require("./src/routes/serviceBill"));
app.use("/api/visitors", require("./src/routes/visitor"));
app.use("/api/knowledge", require("./src/routes/knowledge.routes"));
app.use("/api/ai", require("./src/routes/ai.routes"));
app.use("/api/mcp", require("./src/routes/mcp.routes"));
app.use("/api/rfid", require("./src/routes/rfid.routes"));

app.get("/display", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "display.html")),
);

app.get("/register", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "register.html")),
);

app.get("/", (req, res) => res.send("🚀 API Running..."));

app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    uptime: process.uptime(),
    registrationUrl: getRegistrationFormUrl(req),
    sseClients: sseClients.size,
  }),
);

const server = http.createServer(app);
server.timeout = 0;
server.requestTimeout = 0;

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

const onlineUsers = {};

io.on("connection", (socket) => {
  console.log("⚡ Socket connected:", socket.id);

  socket.on("register", (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`👤 User registered: ${userId} → ${socket.id}`);
  });

  socket.on("disconnect", () => {
    const uid = Object.keys(onlineUsers).find(
      (k) => onlineUsers[k] === socket.id,
    );

    if (uid) delete onlineUsers[uid];

    console.log("❌ Socket disconnected:", socket.id);
  });
});

app.set("io", io);
app.set("onlineUsers", onlineUsers);

setupMQTT(io);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`   Dashboard  : https://smart-residential.onrender.com`);
  console.log(`   Display    : https://smart-residential.onrender.com/display`);
  console.log(`   Register   : ${getRegistrationFormUrl()}`);
  console.log(`   ESP32 scan : POST https://smart-residential.onrender.com/api/qr-scan`);
  console.log(`   Rooms API  : https://smart-residential.onrender.com/api/rooms`);
  console.log(`   Ads API    : https://smart-residential.onrender.com/api/advertisements`);
});
