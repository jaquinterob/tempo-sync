(function exposeTimerTools() {
  function cleanPin(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12);
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
    }

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  let warmupTimeoutIds = [];

  function clearWarmupKeepAlive() {
    for (const id of warmupTimeoutIds) clearTimeout(id);
    warmupTimeoutIds = [];
  }

  // Tras usar la app, mantiene despierto Render Free ~70 min (10 pings cada 7 min).
  function startWarmupKeepAlive({
    intervalMs = 7 * 60 * 1000,
    times = 10,
    path = "/api/warmup",
  } = {}) {
    clearWarmupKeepAlive();
    const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;

    for (let index = 0; index < times; index += 1) {
      const id = setTimeout(() => {
        fetch(url, { cache: "no-store", credentials: "omit" }).catch(() => {});
      }, index * intervalMs);
      warmupTimeoutIds.push(id);
    }
  }

  function readStoredControlToken(pin) {
    const clean = cleanPin(pin);
    if (!clean) return "";
    try {
      return String(sessionStorage.getItem(`pulpit-control-token:${clean}`) || "");
    } catch {
      return "";
    }
  }

  function storeControlToken(pin, token) {
    const clean = cleanPin(pin);
    if (!clean || !token) return;
    try {
      sessionStorage.setItem(`pulpit-control-token:${clean}`, token);
    } catch {
      // sin sessionStorage
    }
  }

  function clearControlToken(pin) {
    const clean = cleanPin(pin);
    if (!clean) return;
    try {
      sessionStorage.removeItem(`pulpit-control-token:${clean}`);
    } catch {
      // sin sessionStorage
    }
  }

  function createTimerClient({ onState, onConnection, role = "display" }) {
    const socket = io();
    let pin = null;
    let controlToken = null;
    let clientRole = role === "control" ? "control" : "display";
    let state = null;
    let serverOffset = 0;

    function receiveState(nextState) {
      state = nextState;
      serverOffset = nextState.serverNow - Date.now();
      onState?.(nextState);
    }

    function createRoom() {
      return new Promise((resolve) => {
        socket.emit("room:create", (result) => {
          if (result?.ok) {
            pin = result.pin;
            controlToken = result.controlToken;
            clientRole = "control";
            storeControlToken(pin, controlToken);
            receiveState(result.state);
            startWarmupKeepAlive();
          }
          resolve(result);
        });
      });
    }

    function join(nextPin, options = {}) {
      pin = cleanPin(nextPin);
      const nextRole = options.role === "control" ? "control" : "display";
      controlToken =
        nextRole === "control"
          ? String(options.controlToken || readStoredControlToken(pin) || "")
          : null;
      clientRole = nextRole;

      return new Promise((resolve) => {
        socket.emit(
          "room:join",
          {
            pin,
            role: nextRole,
            controlToken: controlToken || undefined,
          },
          (result) => {
            if (result?.ok) {
              pin = result.pin;
              clientRole = result.role;
              if (result.controlToken) {
                controlToken = result.controlToken;
                storeControlToken(pin, controlToken);
              }
              receiveState(result.state);
              startWarmupKeepAlive();
            }
            resolve(result);
          },
        );
      });
    }

    function leave() {
      return new Promise((resolve) => {
        socket.emit("room:leave", () => {
          // Conserva el token en sessionStorage para poder volver a la misma sala.
          pin = null;
          controlToken = null;
          state = null;
          resolve({ ok: true });
        });
      });
    }

    socket.on("connect", () => {
      onConnection?.(true);
      if (!pin) return;
      if (clientRole === "control") {
        join(pin, { role: "control", controlToken });
      } else {
        join(pin, { role: "display" });
      }
    });
    socket.on("disconnect", () => onConnection?.(false));
    socket.on("timer:state", receiveState);

    return {
      socket,
      createRoom,
      join,
      leave,
      getPin: () => pin,
      getRole: () => clientRole,
      getControlToken: () => controlToken,
      getState: () => state,
      getRemaining: () => {
        if (!state) return 0;
        if (!state.isRunning || state.endsAt === null) return state.remainingMs;
        return Math.max(0, state.endsAt - (Date.now() + serverOffset));
      },
    };
  }

  function renderTimer({ client, timerElement, labelElement }) {
    let previousText = "";

    function frame() {
      const state = client.getState();
      if (state) {
        const remaining = client.getRemaining();
        const text = formatTime(remaining);
        if (text !== previousText) {
          timerElement.textContent = text;
          previousText = text;
        }

        const finished = remaining <= 0;
        timerElement.classList.toggle("timer-finished", finished);
        labelElement.textContent = finished
          ? "Tiempo terminado"
          : state.isRunning
            ? "En curso"
            : remaining < state.durationMs
              ? "En pausa"
              : "Listo para iniciar";
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function updateConnectionBadge(element, connected) {
    if (!element) return;
    const label = connected ? "En línea" : "Sin conexión";
    element.textContent = label;
    element.title = label;
    element.setAttribute("aria-label", label);
    element.classList.toggle("status-online", connected);
    element.classList.toggle("status-offline", !connected);
  }

  function pinFromUrl() {
    return cleanPin(new URLSearchParams(window.location.search).get("pin"));
  }

  function keyFromUrl() {
    return String(new URLSearchParams(window.location.search).get("key") ?? "").trim();
  }

  function shouldCreateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("create") === "1";
  }

  function wardFromUrl() {
    return String(new URLSearchParams(window.location.search).get("ward") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  }

  const UNIT_PLACEHOLDER = "Tu unidad";

  function normalizeUnitText(value, maxLength = 60) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function displayUnitLabel(value) {
    return normalizeUnitText(value, 60) || UNIT_PLACEHOLDER;
  }

  let shareOrigin = window.location.origin;

  function isLoopbackHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }

  function isPrivateHost(hostname) {
    return (
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  }

  function normalizeShareOrigin(origin) {
    try {
      const url = new URL(origin);
      if (isLoopbackHost(url.hostname) || isPrivateHost(url.hostname)) {
        url.protocol = "http:";
      }
      return url.origin;
    } catch {
      return String(origin || "").replace(/^https:/i, "http:");
    }
  }

  async function prepareShareOrigin() {
    shareOrigin = normalizeShareOrigin(window.location.origin);

    try {
      const response = await fetch("/api/warmup");
      if (!response.ok) return shareOrigin;
      const data = await response.json();
      const lanOrigin = Array.isArray(data.lanOrigins) ? data.lanOrigins[0] : "";
      const currentHost = new URL(shareOrigin).hostname;
      if (lanOrigin && isLoopbackHost(currentHost)) {
        shareOrigin = normalizeShareOrigin(lanOrigin);
      }
    } catch {
      // conservar origin actual
    }
    return shareOrigin;
  }

  function getShareOrigin() {
    return normalizeShareOrigin(shareOrigin || window.location.origin);
  }

  function displayShareUrl(pin) {
    const clean = cleanPin(pin);
    if (!clean) return "";
    return `${getShareOrigin()}/display?pin=${encodeURIComponent(clean)}`;
  }

  window.TimerTools = {
    UNIT_PLACEHOLDER,
    cleanPin,
    clearWarmupKeepAlive,
    createTimerClient,
    displayShareUrl,
    displayUnitLabel,
    formatTime,
    getShareOrigin,
    keyFromUrl,
    normalizeUnitText,
    pinFromUrl,
    prepareShareOrigin,
    readStoredControlToken,
    shouldCreateFromUrl,
    startWarmupKeepAlive,
    storeControlToken,
    wardFromUrl,
    renderTimer,
    updateConnectionBadge,
  };
})();
