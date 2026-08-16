const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const express = require("express");
const { Server } = require("socket.io");

const DEFAULT_DURATION_MS = 8 * 60 * 1000;
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

  app.use(express.static(path.join(__dirname, "public")));

  // Pretty request logs (terminal).
  const logHttpRequest = (req, res, next) => {
    const start = Date.now();
    const pathName = String(req.path || "");

    // Evita ruido de assets/handshakes frecuentes.
    const isNoisy =
      pathName.startsWith("/css/") ||
      pathName.startsWith("/js/") ||
      pathName.startsWith("/assets/") ||
      pathName === "/socket.io/" ||
      pathName.startsWith("/socket.io/");

    if (isNoisy) return next();

    res.on("finish", () => {
      const ms = Date.now() - start;
      const method = req.method;
      const status = res.statusCode;
      const statusColor = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
      const reset = "\x1b[0m";
      const dim = "\x1b[2m";
      const bold = "\x1b[1m";
      console.log(
        `${dim}${bold}${method}${reset} ${req.originalUrl} ${statusColor}${status}${reset} ${dim}${ms}ms${reset}`
      );
    });

    next();
  };

  app.use(logHttpRequest);

  app.get("/", (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "index.html"));
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
    const reset = "\x1b[0m";
    const dim = "\x1b[2m";
    const bold = "\x1b[1m";
    const cyan = "\x1b[36m";
    const green = "\x1b[32m";
    const yellow = "\x1b[33m";
    const red = "\x1b[31m";

    console.log(
      `${dim}${bold}WS${reset} ${cyan}${socket.id}${reset} ${dim}from ${socket.handshake.address}${reset}`
    );

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
      const stateForLog = serializeRoom(roomFor(pin));
      // Para evitar ruido: no hace falta loguear el `serverNow` dinámico.
      delete stateForLog.serverNow;
      console.log(
        `${green}${bold}JOIN${reset} room=${yellow}${pin}${reset} socket=${cyan}${socket.id}${reset} state=${JSON.stringify(
          stateForLog
        )}`
      );
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
      console.log(
        `${bold}SET${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} durationMs=${parsedDuration}`
      );
    });

    socket.on("timer:start", () => {
      let remainingBeforeStart = 0;
      updateRoom(socket, (room) => {
        const remaining = currentRemaining(room);
        remainingBeforeStart = remaining;
        if (remaining <= 0) {
          room.remainingMs = room.durationMs;
        } else {
          room.remainingMs = remaining;
        }
        room.endsAt = Date.now() + room.remainingMs;
        room.isRunning = true;
      });
      console.log(
        `${bold}START${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} remainingBeforeStartMs=${remainingBeforeStart}`
      );
    });

    socket.on("timer:pause", () => {
      let remainingBeforePause = 0;
      updateRoom(socket, (room) => {
        remainingBeforePause = currentRemaining(room);
        room.remainingMs = remainingBeforePause;
        room.isRunning = false;
        room.endsAt = null;
      });
      console.log(
        `${bold}PAUSE${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} remainingBeforePauseMs=${remainingBeforePause}`
      );
    });

    socket.on("timer:reset", () => {
      updateRoom(socket, (room) => {
        room.remainingMs = room.durationMs;
        room.isRunning = false;
        room.endsAt = null;
      });
      console.log(`${bold}RESET${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"}`);
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
      // JSON.stringify mantiene el contenido completo y escapa comillas.
      console.log(
        `${bold}MSG${reset} pin=${
          socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"
        } message=${JSON.stringify(message)}`
      );
    });

    socket.on("display:blank", (value) => {
      updateRoom(socket, (room) => {
        room.isBlank = Boolean(value);
      });
      console.log(`${bold}BLANK${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} -> ${Boolean(value)}`);
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
      console.log(
        `${bold}BRAND${reset} pin=${
          socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"
        } wardName=${JSON.stringify(wardName)} finishThanks=${JSON.stringify(
          finishThanks
        )} finishDone=${JSON.stringify(finishDone)}`
      );
    });

    socket.on("theme:update", (value) => {
      const theme = value === "dark" ? "dark" : "light";
      updateRoom(socket, (room) => {
        room.theme = theme;
      });
      console.log(`${bold}THEME${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} -> ${theme}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `${red}${bold}DISC${reset} socket=${cyan}${socket.id}${reset} pin=${socket.data.pin ? `${yellow}${socket.data.pin}${reset}` : "?"} reason=${reason}`
      );
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
  console.log("");

  console.log(`${green}${bold}Local${reset}`);
  console.log(`${dim}  Inicio:${reset}  http://localhost:${port}/`);
  console.log(`${dim}  Control:${reset} http://localhost:${port}/control.html`);
  console.log(`${dim}  Pantalla:${reset} http://localhost:${port}/display.html`);

  if (addresses.length === 0) {
    console.log(`${dim}${red}Red Wi-Fi: (sin IP local detectada)${reset}`);
    console.log("");
    return;
  }

  for (const address of addresses) {
    console.log("");
    console.log(`${cyan}${bold}Red Wi-Fi${reset} ${dim}(${address})${reset}`);
    console.log(`${dim}  Inicio:${reset}  http://${address}:${port}/`);
    console.log(
      `${dim}  Control:${reset} http://${address}:${port}/control.html`
    );
    console.log(
      `${dim}  Pantalla:${reset} http://${address}:${port}/display.html`
    );
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
};
