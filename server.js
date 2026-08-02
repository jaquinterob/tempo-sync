const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const express = require("express");
const { Server } = require("socket.io");

const ADMIN_USER = process.env.ADMIN_USER || "SA";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwe123";
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_DURATION_MS = 7 * 60 * 1000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 60 * 60 * 60 * 1000;

const DEFAULT_BRANDING = {
  churchName: "La Iglesia de Jesucristo de los Santos de los Últimos Días",
  wardName: "Barrio Sabaneta",
  finishThanks: "Agradecemos su discurso.",
  finishDone: "Su tiempo ha terminado.",
};

function normalizePin(value) {
  const pin = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(pin) ? pin : null;
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function createRoom() {
  return {
    durationMs: DEFAULT_DURATION_MS,
    remainingMs: DEFAULT_DURATION_MS,
    isRunning: false,
    endsAt: null,
    message: "",
    isBlank: false,
    theme: "light",
    branding: { ...DEFAULT_BRANDING },
    revision: 0,
  };
}

function currentRemaining(room, now = Date.now()) {
  if (!room.isRunning || room.endsAt === null) {
    return room.remainingMs;
  }

  return Math.max(0, room.endsAt - now);
}

function serializeRoom(room, now = Date.now()) {
  return {
    durationMs: room.durationMs,
    remainingMs: currentRemaining(room, now),
    isRunning: room.isRunning,
    endsAt: room.endsAt,
    message: room.message,
    isBlank: room.isBlank,
    theme: room.theme === "dark" ? "dark" : "light",
    branding: room.branding,
    revision: room.revision,
    serverNow: now,
  };
}

function createTimerServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map();
  const adminSessions = new Map();

  app.use(express.json());

  function requireAdmin(request, response, next) {
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const session = token ? adminSessions.get(token) : null;

    if (!session) {
      response.status(401).json({ ok: false, error: "No autorizado." });
      return;
    }

    if (session.expiresAt < Date.now()) {
      adminSessions.delete(token);
      response.status(401).json({ ok: false, error: "Sesión expirada." });
      return;
    }

    request.adminToken = token;
    next();
  }

  function listConnections() {
    const connections = [];
    const now = Date.now();

    for (const socket of io.sockets.sockets.values()) {
      connections.push({
        id: socket.id,
        address: socket.handshake?.address ?? null,
        pin: socket.data.pin ?? null,
        connectedAt: socket.data.connectedAt ?? null,
        connectedForMs: now - (socket.data.connectedAt ?? now),
        rooms: [...(socket.rooms ?? [])].filter((name) => name !== socket.id),
      });
    }

    connections.sort((a, b) => (a.connectedAt ?? 0) - (b.connectedAt ?? 0));
    return connections;
  }

  app.get("/admin", (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "admin.html"));
  });

  app.post("/api/admin/login", (request, response) => {
    const user = String(request.body?.user ?? "").trim();
    const password = String(request.body?.password ?? "");

    if (user !== ADMIN_USER || password !== ADMIN_PASSWORD) {
      response.status(401).json({ ok: false, error: "Credenciales inválidas." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    adminSessions.set(token, { user, expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
    response.json({ ok: true, token });
  });

  app.post("/api/admin/logout", requireAdmin, (request, response) => {
    adminSessions.delete(request.adminToken);
    response.json({ ok: true });
  });

  app.get("/api/admin/connections", requireAdmin, (_request, response) => {
    response.json({ ok: true, connections: listConnections() });
  });

  app.post("/api/admin/kick", requireAdmin, (request, response) => {
    const socketId = String(request.body?.socketId ?? "");
    const socket = io.sockets.sockets.get(socketId);

    if (!socket) {
      response.status(404).json({ ok: false, error: "Conexión no encontrada." });
      return;
    }

    socket.emit("server:kick", { reason: "Desconectado por el administrador." });
    socket.disconnect(true);
    response.json({ ok: true });
  });

  app.get("/control.html", (_request, response) => {
    response.redirect(301, "/control");
  });

  app.get("/display.html", (_request, response) => {
    response.redirect(301, "/display");
  });

  app.use(
    express.static(path.join(__dirname, "public"), {
      setHeaders: (response, filePath) => {
        if (filePath.endsWith(".css") || filePath.endsWith(".js")) {
          response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );
  app.get("/", (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.get("/control", (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "control.html"));
  });

  app.get("/display", (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "display.html"));
  });

  function roomFor(pin) {
    if (!rooms.has(pin)) {
      rooms.set(pin, createRoom());
    }
    return rooms.get(pin);
  }

  function broadcast(pin) {
    const room = roomFor(pin);
    io.to(pin).emit("timer:state", serializeRoom(room));
  }

  function updateRoom(socket, updater) {
    const pin = socket.data.pin;
    if (!pin) {
      socket.emit("room:error", "Primero debes entrar a una sala.");
      return;
    }

    const room = roomFor(pin);
    updater(room);
    room.revision += 1;
    broadcast(pin);
  }

  io.on("connection", (socket) => {
    socket.data.connectedAt = Date.now();

    socket.on("room:join", (rawPin, acknowledge = () => {}) => {
      const pin = normalizePin(rawPin);
      if (!pin) {
        acknowledge({ ok: false, error: "Usa un PIN de 3 a 12 letras o números." });
        return;
      }

      if (socket.data.pin) {
        socket.leave(socket.data.pin);
      }

      socket.data.pin = pin;
      socket.join(pin);
      acknowledge({ ok: true, pin, state: serializeRoom(roomFor(pin)) });
    });

    socket.on("timer:set", (durationMs) => {
      const parsedDuration = Number(durationMs);
      if (
        !Number.isFinite(parsedDuration) ||
        parsedDuration < MIN_DURATION_MS ||
        parsedDuration > MAX_DURATION_MS
      ) {
        socket.emit("room:error", "El tiempo debe estar entre 1 segundo y 24 horas.");
        return;
      }

      updateRoom(socket, (room) => {
        room.durationMs = Math.round(parsedDuration);
        room.remainingMs = room.durationMs;
        room.isRunning = false;
        room.endsAt = null;
      });
    });

    socket.on("timer:start", () => {
      updateRoom(socket, (room) => {
        const remaining = currentRemaining(room);
        if (remaining <= 0) {
          room.remainingMs = room.durationMs;
        } else {
          room.remainingMs = remaining;
        }
        room.endsAt = Date.now() + room.remainingMs;
        room.isRunning = true;
      });
    });

    socket.on("timer:pause", () => {
      updateRoom(socket, (room) => {
        room.remainingMs = currentRemaining(room);
        room.isRunning = false;
        room.endsAt = null;
      });
    });

    socket.on("timer:reset", () => {
      updateRoom(socket, (room) => {
        room.remainingMs = room.durationMs;
        room.isRunning = false;
        room.endsAt = null;
      });
    });

    socket.on("timer:message", (value) => {
      const message = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

      if (message.length > 180) {
        socket.emit("room:error", "El mensaje no puede superar 180 caracteres.");
        return;
      }

      updateRoom(socket, (room) => {
        room.message = message;
      });
    });

    socket.on("display:blank", (value) => {
      updateRoom(socket, (room) => {
        room.isBlank = Boolean(value);
      });
    });

    socket.on("branding:update", (payload = {}) => {
      const wardName = cleanText(payload.wardName, 60);
      const finishThanks = cleanText(payload.finishThanks, 80);
      const finishDone = cleanText(payload.finishDone, 80);

      if (!wardName || !finishThanks || !finishDone) {
        socket.emit("room:error", "Completa barrio y mensajes finales.");
        return;
      }

      updateRoom(socket, (room) => {
        room.branding = {
          churchName: DEFAULT_BRANDING.churchName,
          wardName,
          finishThanks,
          finishDone,
        };
      });
    });

    socket.on("theme:update", (value) => {
      const theme = value === "dark" ? "dark" : "light";
      updateRoom(socket, (room) => {
        room.theme = theme;
      });
    });
  });

  const completionInterval = setInterval(() => {
    const now = Date.now();
    for (const [pin, room] of rooms) {
      if (room.isRunning && currentRemaining(room, now) === 0) {
        room.remainingMs = 0;
        room.isRunning = false;
        room.endsAt = null;
        room.revision += 1;
        io.to(pin).emit("timer:state", serializeRoom(room, now));
      }
    }
  }, 250);
  completionInterval.unref();

  httpServer.on("close", () => clearInterval(completionInterval));

  return { app, httpServer, io, rooms };
}

function getLocalAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces ?? []) {
      if (network.family === "IPv4" && !network.internal) {
        addresses.push(network.address);
      }
    }
  }
  return addresses;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createTimerServer();

  httpServer.listen(port, "0.0.0.0", () => {
    const addresses = getLocalAddresses();

    console.log(`Pulpit Timer`);
    console.log(`Local`);
    console.log(`  Inicio:   http://localhost:${port}/`);
    console.log(`  Control:  http://localhost:${port}/control`);
    console.log(`  Pantalla: http://localhost:${port}/display`);

    if (addresses.length === 0) {
      console.log(`Red Wi-Fi: (sin IP local detectada)`);
      return;
    }

    for (const address of addresses) {
      console.log(`Red Wi-Fi (${address})`);
      console.log(`  Inicio:   http://${address}:${port}/`);
      console.log(`  Control:  http://${address}:${port}/control`);
      console.log(`  Pantalla: http://${address}:${port}/display`);
    }
  });
}

module.exports = {
  createTimerServer,
  currentRemaining,
  normalizePin,
  serializeRoom,
};
