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

  function createTimerClient({ onState, onConnection }) {
    const socket = io();
    let pin = null;
    let state = null;
    let serverOffset = 0;

    function receiveState(nextState) {
      state = nextState;
      serverOffset = nextState.serverNow - Date.now();
      onState?.(nextState);
    }

    function join(nextPin) {
      pin = cleanPin(nextPin);
      return new Promise((resolve) => {
        socket.emit("room:join", pin, (result) => {
          if (result.ok) {
            pin = result.pin;
            receiveState(result.state);
          }
          resolve(result);
        });
      });
    }

    socket.on("connect", () => {
      onConnection?.(true);
      if (pin) {
        join(pin);
      }
    });
    socket.on("disconnect", () => onConnection?.(false));
    socket.on("timer:state", receiveState);

    return {
      socket,
      join,
      getPin: () => pin,
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
    const terminal = document.body.classList.contains("control-page");
    element.textContent = connected
      ? terminal
        ? "En línea"
        : "Conectado"
      : "Desconectado";
    element.classList.toggle("status-online", connected);
    element.classList.toggle("status-offline", !connected);
  }

  function pinFromUrl() {
    return cleanPin(new URLSearchParams(window.location.search).get("pin"));
  }

  function createRoomPin() {
    return String(1000 + Math.floor(Math.random() * 9000));
  }

  function displayShareUrl(pin) {
    const clean = cleanPin(pin);
    if (!clean) return "";
    return `${window.location.origin}/display.html?pin=${encodeURIComponent(clean)}`;
  }

  window.TimerTools = {
    cleanPin,
    createRoomPin,
    createTimerClient,
    displayShareUrl,
    formatTime,
    pinFromUrl,
    renderTimer,
    updateConnectionBadge,
  };
})();
