const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const express = require("express");
const { Server } = require("socket.io");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ADMIN_USER = process.env.ADMIN_USER || (IS_PRODUCTION ? "" : "SA");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "qwe123");
const ADMIN_ENABLED = Boolean(ADMIN_USER && ADMIN_PASSWORD);
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;

const DEFAULT_DURATION_MS = 8 * 60 * 1000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const PIN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PIN_LENGTH = 6;

const DEFAULT_BRANDING = {
  churchName: "La Iglesia de Jesucristo de los Santos de los Últimos Días",
  wardName: "",
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

function generatePin() {
  const bytes = crypto.randomBytes(PIN_LENGTH);
  let pin = "";
  for (let index = 0; index < PIN_LENGTH; index += 1) {
    pin += PIN_ALPHABET[bytes[index] % PIN_ALPHABET.length];
  }
  return pin;
}

function createRoom(controlToken) {
  return {
    controlToken,
    durationMs: DEFAULT_DURATION_MS,
    remainingMs: DEFAULT_DURATION_MS,
    isRunning: false,
    endsAt: null,
    message: "",
    isBlank: false,
    theme: "light",
    branding: { ...DEFAULT_BRANDING },
    revision: 0,
    createdAt: Date.now(),
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
  const adminLoginAttempts = new Map();
  const WARMUP_HISTORY_LIMIT = 40;
  const warmupRecent = [];
  let warmupTotal = 0;
  let warmupLastAt = null;

  app.use(express.json({ limit: "10kb" }));

  function clientIp(request) {
    return (
      request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      request.socket?.remoteAddress ||
      "unknown"
    );
  }

  function recordWarmup(request) {
    const at = Date.now();
    warmupTotal += 1;
    warmupLastAt = at;
    warmupRecent.unshift({
      at: new Date(at).toISOString(),
      ip: clientIp(request),
      ua: String(request.headers["user-agent"] || "").slice(0, 140),
    });
    if (warmupRecent.length > WARMUP_HISTORY_LIMIT) {
      warmupRecent.length = WARMUP_HISTORY_LIMIT;
    }
  }

  function consumeAdminLoginAttempt(ip) {
    const now = Date.now();
    const entry = adminLoginAttempts.get(ip) || { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + ADMIN_LOGIN_WINDOW_MS;
    }
    entry.count += 1;
    adminLoginAttempts.set(ip, entry);
    return entry.count <= ADMIN_LOGIN_MAX_ATTEMPTS;
  }

  function requireAdmin(request, response, next) {
    if (!ADMIN_ENABLED) {
      response.status(404).json({ ok: false, error: "Admin no disponible." });
      return;
    }

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
        role: socket.data.role ?? null,
        connectedAt: socket.data.connectedAt ?? null,
        connectedForMs: now - (socket.data.connectedAt ?? now),
        rooms: [...(socket.rooms ?? [])].filter((name) => name !== socket.id),
      });
    }

    connections.sort((a, b) => (a.connectedAt ?? 0) - (b.connectedAt ?? 0));
    return connections;
  }

  function buildTowerSnapshot() {
    const now = Date.now();
    const connections = listConnections();
    const roomSummaries = [];

    for (const [pin, room] of rooms) {
      const socketsInRoom = connections.filter((item) => item.pin === pin);
      const controls = socketsInRoom.filter((item) => item.role === "control").length;
      const displays = socketsInRoom.filter((item) => item.role === "display").length;
      const socketCount = socketsInRoom.length;
      roomSummaries.push({
        pin,
        sockets: socketCount,
        controls,
        displays,
        inactive: socketCount === 0,
        durationMs: room.durationMs,
        remainingMs: currentRemaining(room, now),
        isRunning: room.isRunning,
        isBlank: room.isBlank,
        theme: room.theme,
        revision: room.revision,
        wardName: room.branding?.wardName || "",
        churchName: room.branding?.churchName || "",
        finishThanks: room.branding?.finishThanks || "",
        finishDone: room.branding?.finishDone || "",
        message: room.message || "",
        createdAt: room.createdAt ?? null,
        ageMs: room.createdAt ? now - room.createdAt : null,
      });
    }

    roomSummaries.sort(
      (a, b) =>
        Number(a.inactive) - Number(b.inactive) ||
        (b.sockets || 0) - (a.sockets || 0) ||
        String(a.pin).localeCompare(String(b.pin)),
    );

    const memory = process.memoryUsage();
    return {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      server: {
        service: "pulpit-timer",
        env: process.env.NODE_ENV || "development",
        uptimeSec: Math.round(process.uptime()),
        memory: {
          rssMb: Math.round(memory.rss / 1024 / 1024),
          heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        },
      },
      socket: {
        engineClients: io.engine?.clientsCount ?? connections.length,
        sockets: connections.length,
        roomsTracked: rooms.size,
        roomsInactive: roomSummaries.filter((room) => room.inactive).length,
        controls: connections.filter((item) => item.role === "control").length,
        displays: connections.filter((item) => item.role === "display").length,
        idle: connections.filter((item) => !item.pin).length,
      },
      rooms: roomSummaries,
      connections,
      warmup: {
        total: warmupTotal,
        lastAt: warmupLastAt ? new Date(warmupLastAt).toISOString() : null,
        recent: warmupRecent,
      },
    };
  }

  function destroyRoom(pin, reason = "Sala eliminada por el administrador.") {
    const room = rooms.get(pin);
    if (!room) return { ok: false, removed: false, kicked: 0 };

    let kicked = 0;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.pin !== pin) continue;
      socket.emit("server:kick", { reason });
      socket.leave(pin);
      socket.data.pin = null;
      socket.data.role = null;
      socket.data.controlToken = null;
      socket.disconnect(true);
      kicked += 1;
    }

    rooms.delete(pin);
    return { ok: true, removed: true, kicked, pin };
  }

  function allocatePin() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pin = generatePin();
      if (!rooms.has(pin)) return pin;
    }
    throw new Error("No se pudo crear un código único.");
  }

  app.get("/api/warmup", (request, response) => {
    recordWarmup(request);
    const port = Number(process.env.PORT) || request.socket?.localPort || 3000;
    const protocol = request.headers["x-forwarded-proto"] || request.protocol || "http";
    const hostHeader = request.headers.host || `localhost:${port}`;
    const lanOrigins = getLocalAddresses().map((ip) => `http://${ip}:${port}`);

    response.json({
      ok: true,
      service: "pulpit-timer",
      warmedAt: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      origin: `${protocol}://${hostHeader}`,
      lanOrigins,
      warmupTotal,
    });
  });

  app.get("/admin", (_request, response) => {
    if (!ADMIN_ENABLED) {
      response.status(404).type("text/plain").send("Admin no disponible.");
      return;
    }
    response.sendFile(path.join(__dirname, "public", "admin.html"));
  });

  app.post("/api/admin/login", (request, response) => {
    if (!ADMIN_ENABLED) {
      response.status(404).json({ ok: false, error: "Admin no disponible." });
      return;
    }

    const ip = clientIp(request);
    if (!consumeAdminLoginAttempt(ip)) {
      response.status(429).json({
        ok: false,
        error: "Demasiados intentos. Espera 15 minutos.",
      });
      return;
    }

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

  app.get("/api/admin/tower", requireAdmin, (_request, response) => {
    response.json(buildTowerSnapshot());
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

  app.post("/api/admin/rooms/delete", requireAdmin, (request, response) => {
    const pin = normalizePin(request.body?.pin);
    if (!pin || !rooms.has(pin)) {
      response.status(404).json({ ok: false, error: "Sala no encontrada." });
      return;
    }

    const result = destroyRoom(pin);
    response.json(result);
  });

  app.post("/api/admin/rooms/purge-inactive", requireAdmin, (_request, response) => {
    const removed = [];
    for (const [pin] of [...rooms.entries()]) {
      const occupied = [...io.sockets.sockets.values()].some((socket) => socket.data.pin === pin);
      if (occupied) continue;
      destroyRoom(pin, "Sala inactiva eliminada por el administrador.");
      removed.push(pin);
    }
    response.json({ ok: true, removed, count: removed.length });
  });

  app.get("/control.html", (_request, response) => {
    response.redirect(301, "/control");
  });

  app.get("/display.html", (_request, response) => {
    response.redirect(301, "/display");
  });

  if (!ADMIN_ENABLED) {
    app.get("/admin.html", (_request, response) => {
      response.status(404).type("text/plain").send("Admin no disponible.");
    });
  }

  app.use(
    express.static(path.join(__dirname, "public"), {
      setHeaders: (response, filePath) => {
        if (filePath.endsWith(".css") || filePath.endsWith(".js")) {
          response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
        if (path.basename(filePath) === "sw.js") {
          response.setHeader("Service-Worker-Allowed", "/");
          response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
        if (filePath.endsWith(".webmanifest")) {
          response.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
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

  function broadcast(pin) {
    const room = rooms.get(pin);
    if (!room) return;
    io.to(pin).emit("timer:state", serializeRoom(room));
  }

  function requireControl(socket) {
    if (!socket.data.pin) {
      socket.emit("room:error", "Primero debes entrar a una sala.");
      return false;
    }
    if (socket.data.role !== "control") {
      socket.emit("room:error", "Solo el celular de control puede hacer esto.");
      return false;
    }
    if (!rooms.has(socket.data.pin)) {
      socket.emit("room:error", "La sala ya no existe. Crea una nueva.");
      return false;
    }
    return true;
  }

  function updateRoom(socket, updater) {
    if (!requireControl(socket)) return;

    const pin = socket.data.pin;
    const room = rooms.get(pin);
    updater(room);
    room.revision += 1;
    broadcast(pin);
  }

  function leaveCurrentRoom(socket) {
    const pin = socket.data.pin;
    if (!pin) return;
    socket.leave(pin);
    socket.data.pin = null;
    socket.data.role = null;
    socket.data.controlToken = null;
  }

  io.on("connection", (socket) => {
    socket.data.connectedAt = Date.now();

    socket.on("room:create", (acknowledge = () => {}) => {
      try {
        leaveCurrentRoom(socket);
        const pin = allocatePin();
        const controlToken = crypto.randomBytes(16).toString("hex");
        rooms.set(pin, createRoom(controlToken));
        socket.data.pin = pin;
        socket.data.role = "control";
        socket.data.controlToken = controlToken;
        socket.join(pin);
        acknowledge({
          ok: true,
          pin,
          controlToken,
          role: "control",
          state: serializeRoom(rooms.get(pin)),
        });
      } catch {
        acknowledge({ ok: false, error: "No se pudo crear la sala. Intenta de nuevo." });
      }
    });

    socket.on("room:join", (payload, acknowledge = () => {}) => {
      const raw =
        typeof payload === "string" || typeof payload === "number"
          ? { pin: payload, role: "display" }
          : payload || {};
      const pin = normalizePin(raw.pin);
      const role = raw.role === "control" ? "control" : "display";
      const controlToken = String(raw.controlToken ?? "");

      if (!pin) {
        acknowledge({
          ok: false,
          error: "Usa un código de 3 a 12 letras o números.",
        });
        return;
      }

      if (!rooms.has(pin)) {
        acknowledge({
          ok: false,
          error:
            role === "display"
              ? "No hay sala con ese código. Revisa el mensaje o pide el código otra vez."
              : "Sala no encontrada. Crea una sala nueva desde el inicio.",
        });
        return;
      }

      const room = rooms.get(pin);

      if (role === "control") {
        if (!controlToken || controlToken !== room.controlToken) {
          acknowledge({
            ok: false,
            error:
              "Este código solo abre la pantalla. Para controlar, crea la sala desde este celular.",
          });
          return;
        }
      }

      leaveCurrentRoom(socket);
      socket.data.pin = pin;
      socket.data.role = role;
      socket.data.controlToken = role === "control" ? controlToken : null;
      socket.join(pin);
      acknowledge({
        ok: true,
        pin,
        role,
        controlToken: role === "control" ? controlToken : undefined,
        state: serializeRoom(room),
      });
    });

    socket.on("room:leave", (acknowledge = () => {}) => {
      leaveCurrentRoom(socket);
      acknowledge({ ok: true });
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
        socket.emit("room:error", "Completa el nombre de la unidad y los mensajes finales.");
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

    socket.on("disconnect", () => {
      leaveCurrentRoom(socket);
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

  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions) {
      if (session.expiresAt < now) adminSessions.delete(token);
    }
    for (const [ip, entry] of adminLoginAttempts) {
      if (entry.resetAt < now) adminLoginAttempts.delete(ip);
    }
  }, 60_000);
  sessionCleanupInterval.unref();

  httpServer.on("close", () => {
    clearInterval(completionInterval);
    clearInterval(sessionCleanupInterval);
  });

  return { app, httpServer, io, rooms, adminEnabled: ADMIN_ENABLED };
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

function printStartupBanner(port, addresses) {
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const reset = "\x1b[0m";

  console.log("");
  console.log(
    `${cyan}${bold}` +
      [
        "     ██╗ ██████╗ ██╗  ██╗███╗   ██╗ ██████╗",
        "     ██║██╔═══██╗██║  ██║████╗  ██║██╔═══██╗",
        "     ██║██║   ██║███████║██╔██╗ ██║██║   ██║",
        "██   ██║██║▄▄ ██║██╔══██║██║╚██╗██║██║▄▄ ██║",
        "╚█████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝",
        " ╚════╝  ╚══▀▀═╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚══▀▀═╝",
      ].join("\n") +
      reset
  );
  console.log(`${bold}  PULPIT TIMER${reset}${dim}  ·  Developer: JohnQ${reset}`);
  console.log(`${dim}  ────────────────────────────────────────${reset}`);
  if (IS_PRODUCTION && !ADMIN_ENABLED) {
    console.log(`${yellow}  Admin deshabilitado (define ADMIN_USER y ADMIN_PASSWORD).${reset}`);
  }
  console.log("");

  console.log(`${green}${bold}Local${reset}`);
  console.log(`${dim}  Inicio:${reset}  http://localhost:${port}/`);
  console.log(`${dim}  Control:${reset} http://localhost:${port}/control`);
  console.log(`${dim}  Pantalla:${reset} http://localhost:${port}/display`);

  if (addresses.length === 0) {
    console.log(`${dim}${red}Red Wi-Fi: (sin IP local detectada)${reset}`);
    console.log("");
    return;
  }

  for (const address of addresses) {
    console.log("");
    console.log(`${cyan}${bold}Red Wi-Fi${reset} ${dim}(${address})${reset}`);
    console.log(`${dim}  Inicio:${reset}  http://${address}:${port}/`);
    console.log(`${dim}  Control:${reset} http://${address}:${port}/control`);
    console.log(`${dim}  Pantalla:${reset} http://${address}:${port}/display`);
  }

  console.log("");
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createTimerServer();

  httpServer.listen(port, "0.0.0.0", () => {
    printStartupBanner(port, getLocalAddresses());
  });
}

module.exports = {
  createTimerServer,
  currentRemaining,
  normalizePin,
  serializeRoom,
  generatePin,
};
