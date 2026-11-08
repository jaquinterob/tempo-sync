const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { io: createClient } = require("socket.io-client");
const { createTimerServer, normalizePin } = require("../server");

let server;
let baseUrl;
const clients = [];

function connectClient() {
  return new Promise((resolve, reject) => {
    const client = createClient(baseUrl, {
      forceNew: true,
      transports: ["websocket"],
    });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function createRoom(client) {
  return new Promise((resolve) => client.emit("room:create", resolve));
}

function joinRoom(client, payload) {
  return new Promise((resolve) => client.emit("room:join", payload, resolve));
}

function nextState(client, predicate = () => true, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("timer:state", listener);
      reject(new Error("No se recibió el estado esperado."));
    }, timeoutMs);

    function listener(state) {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      client.off("timer:state", listener);
      resolve(state);
    }

    client.on("timer:state", listener);
  });
}

before(async () => {
  server = createTimerServer();
  await new Promise((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const client of clients) {
    client.disconnect();
  }
  await new Promise((resolve) => server.io.close(resolve));
  server.httpServer.close();
});

test("normaliza y valida los PIN", () => {
  assert.equal(normalizePin(" sala7 "), "SALA7");
  assert.equal(normalizePin("ab"), null);
  assert.equal(normalizePin("sala-7"), null);
});

test("sincroniza configuración, inicio, pausa, reinicio y reconexión", async () => {
  const control = await connectClient();
  const display = await connectClient();

  const created = await createRoom(control);
  assert.equal(created.ok, true);
  assert.match(created.pin, /^[A-Z0-9]{6}$/);
  assert.ok(created.controlToken);

  const displayJoin = await joinRoom(display, {
    pin: created.pin,
    role: "display",
  });
  assert.equal(displayJoin.ok, true);
  assert.equal(displayJoin.state.durationMs, 480_000);

  const stranger = await connectClient();
  const strangerJoin = await joinRoom(stranger, {
    pin: created.pin,
    role: "control",
  });
  assert.equal(strangerJoin.ok, false);

  const messageOnDisplay = nextState(
    display,
    (state) => state.message === "Por favor, concluya su discurso.",
  );
  control.emit("timer:message", "  Por favor,   concluya su discurso.  ");
  const displayMessage = await messageOnDisplay;
  assert.equal(displayMessage.message, "Por favor, concluya su discurso.");

  const blankOnDisplay = nextState(display, (state) => state.isBlank);
  control.emit("display:blank", true);
  assert.equal((await blankOnDisplay).isBlank, true);

  const brandingOnDisplay = nextState(
    display,
    (state) => state.branding?.wardName === "Barrio Sabaneta Centro",
  );
  control.emit("branding:update", {
    wardName: "Barrio Sabaneta Centro",
    finishThanks: "Agradecemos su participación.",
    finishDone: "Su tiempo ha concluido.",
  });
  const branded = await brandingOnDisplay;
  assert.equal(branded.branding.wardName, "Barrio Sabaneta Centro");
  assert.match(branded.branding.churchName, /Santos de los Últimos Días/);

  const visibleOnDisplay = nextState(display, (state) => !state.isBlank);
  control.emit("display:blank", false);
  await visibleOnDisplay;

  const configuredOnControl = nextState(control, (state) => state.durationMs === 3_000);
  const configuredOnDisplay = nextState(display, (state) => state.durationMs === 3_000);
  control.emit("timer:set", 3_000);
  const [controlConfigured, displayConfigured] = await Promise.all([
    configuredOnControl,
    configuredOnDisplay,
  ]);
  assert.equal(controlConfigured.remainingMs, 3_000);
  assert.deepEqual(controlConfigured, displayConfigured);

  const startedOnControl = nextState(control, (state) => state.isRunning);
  const startedOnDisplay = nextState(display, (state) => state.isRunning);
  control.emit("timer:start");
  const [controlStarted, displayStarted] = await Promise.all([startedOnControl, startedOnDisplay]);
  assert.equal(controlStarted.isRunning, true);
  assert.ok(controlStarted.endsAt > controlStarted.serverNow);
  assert.equal(controlStarted.revision, displayStarted.revision);

  await new Promise((resolve) => setTimeout(resolve, 120));
  const pausedOnControl = nextState(control, (state) => !state.isRunning);
  const pausedOnDisplay = nextState(display, (state) => !state.isRunning);
  control.emit("timer:pause");
  const [controlPaused, displayPaused] = await Promise.all([pausedOnControl, pausedOnDisplay]);
  assert.ok(controlPaused.remainingMs < 3_000);
  assert.ok(controlPaused.remainingMs > 2_500);
  assert.equal(controlPaused.revision, displayPaused.revision);

  const resetOnDisplay = nextState(display, (state) => state.remainingMs === 3_000);
  control.emit("timer:reset");
  const displayReset = await resetOnDisplay;
  assert.equal(displayReset.isRunning, false);

  display.disconnect();
  const reconnectedDisplay = await connectClient();
  const rejoined = await joinRoom(reconnectedDisplay, {
    pin: created.pin,
    role: "display",
  });
  assert.equal(rejoined.state.remainingMs, 3_000);
  assert.equal(rejoined.state.isRunning, false);
  assert.equal(rejoined.state.message, "Por favor, concluya su discurso.");
});

test("rechaza display sin sala y control sin token", async () => {
  const display = await connectClient();
  const missing = await joinRoom(display, { pin: "ABCDEF", role: "display" });
  assert.equal(missing.ok, false);

  const control = await connectClient();
  const created = await createRoom(control);
  const hijack = await connectClient();
  const denied = await joinRoom(hijack, {
    pin: created.pin,
    role: "control",
    controlToken: "token-falso",
  });
  assert.equal(denied.ok, false);

  const displayOnly = await connectClient();
  const displayOk = await joinRoom(displayOnly, {
    pin: created.pin,
    role: "display",
  });
  assert.equal(displayOk.ok, true);
  const error = await new Promise((resolve) => {
    displayOnly.once("room:error", resolve);
    displayOnly.emit("timer:start");
  });
  assert.match(error, /control/i);
});

test("marca el temporizador como terminado al llegar a cero", async () => {
  const control = await connectClient();
  const created = await createRoom(control);
  assert.equal(created.ok, true);

  const configured = nextState(control, (state) => state.durationMs === 1_000);
  control.emit("timer:set", 1_000);
  await configured;

  const completed = nextState(
    control,
    (state) => !state.isRunning && state.remainingMs === 0,
    2_500,
  );
  control.emit("timer:start");
  const finalState = await completed;
  assert.equal(finalState.endsAt, null);
});

test("responde el endpoint de warmup", async () => {
  const response = await fetch(`${baseUrl}/api/warmup`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "pulpit-timer");
  assert.equal(typeof body.warmedAt, "string");
  assert.ok(body.uptimeSec >= 0);
  assert.ok(Array.isArray(body.lanOrigins));
  assert.ok(body.warmupTotal >= 1);
});

test("torre de control admin requiere autenticación y reporta sockets", async () => {
  const denied = await fetch(`${baseUrl}/api/admin/tower`);
  assert.equal(denied.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: "SA", password: "qwe123" }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);

  const control = await connectClient();
  const created = await createRoom(control);
  assert.equal(created.ok, true);

  await fetch(`${baseUrl}/api/warmup`);

  const tower = await fetch(`${baseUrl}/api/admin/tower`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(tower.status, 200);
  const body = await tower.json();
  assert.equal(body.ok, true);
  assert.ok(body.socket.sockets >= 1);
  assert.ok(body.rooms.some((room) => room.pin === created.pin));
  assert.ok(body.warmup);
  assert.ok(body.warmup.total >= 1);
  assert.ok(Array.isArray(body.warmup.recent));
  assert.ok(body.warmup.recent.length >= 1);
  assert.ok(body.warmup.lastAt);

  control.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const towerAfterLeave = await fetch(`${baseUrl}/api/admin/tower`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const afterLeave = await towerAfterLeave.json();
  const idleRoom = afterLeave.rooms.find((room) => room.pin === created.pin);
  assert.ok(idleRoom);
  assert.equal(idleRoom.inactive, true);

  const purge = await fetch(`${baseUrl}/api/admin/rooms/purge-inactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(purge.status, 200);
  const purged = await purge.json();
  assert.ok(purged.removed.includes(created.pin));

  const towerClean = await fetch(`${baseUrl}/api/admin/tower`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const clean = await towerClean.json();
  assert.equal(
    clean.rooms.some((room) => room.pin === created.pin),
    false,
  );
});
