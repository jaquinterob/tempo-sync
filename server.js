const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const express = require("express");
const { Server } = require("socket.io");

const DEFAULT_DURATION_MS = 5 * 60 * 1000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function normalizePin(value) {
  const pin = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(pin) ? pin : null;
}

function createRoom() {
  return {
    durationMs: DEFAULT_DURATION_MS,
    remainingMs: DEFAULT_DURATION_MS,
    isRunning: false,
    endsAt: null,
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
    revision: room.revision,
    serverNow: now,
  };
}

function createTimerServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map();

  app.use(express.static(path.join(__dirname, "public")));
  app.get("/", (_request, response) => response.redirect("/control.html"));

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
    console.log(`Control local: http://localhost:${port}/control.html`);
    console.log(`Pantalla local: http://localhost:${port}/display.html`);
    for (const address of getLocalAddresses()) {
      console.log(`Red Wi-Fi: http://${address}:${port}`);
    }
  });
}

module.exports = {
  createTimerServer,
  currentRemaining,
  normalizePin,
  serializeRoom,
};
