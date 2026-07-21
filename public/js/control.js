const {
  cleanPin,
  createTimerClient,
  pinFromUrl,
  renderTimer,
  updateConnectionBadge,
} = window.TimerTools;

const joinForm = document.querySelector("#join-form");
const joinPanel = document.querySelector("#join-panel");
const timerPanel = document.querySelector("#timer-panel");
const pinInput = document.querySelector("#pin");
const joinError = document.querySelector("#join-error");
const roomPin = document.querySelector("#room-pin");
const connectionStatus = document.querySelector("#connection-status");
const connectionStatusInline = document.querySelector("#connection-status-inline");
const timerElement = document.querySelector("#timer");
const timerLabel = document.querySelector("#timer-label");
const timeForm = document.querySelector("#time-form");
const minutesInput = document.querySelector("#minutes");
const secondsInput = document.querySelector("#seconds");
const timeError = document.querySelector("#time-error");
const presetButtons = document.querySelectorAll(".preset-button");
const startButton = document.querySelector("#start-button");
const pauseButton = document.querySelector("#pause-button");
const resetButton = document.querySelector("#reset-button");
const blankScreenButton = document.querySelector("#blank-screen-button");
const messageForm = document.querySelector("#message-form");
const screenMessageInput = document.querySelector("#screen-message");
const clearMessageButton = document.querySelector("#clear-message-button");
const displayLink = document.querySelector("#display-link");
const changeRoomButton = document.querySelector("#change-room-button");
const brandingForm = document.querySelector("#branding-form");
const wardNameInput = document.querySelector("#ward-name");
const finishThanksInput = document.querySelector("#finish-thanks");
const finishDoneInput = document.querySelector("#finish-done");
const brandingStatus = document.querySelector("#branding-status");
const controlWardTitle = document.querySelector("#control-ward-title");
const themeToggle = document.querySelector("#theme-toggle");
const timeMeterFill = document.querySelector("#time-meter-fill");
let lastScreenMessage = "";
let isScreenBlank = false;
let lastBrandingKey = "";
let currentTheme = "light";

function syncConnectionBadge(connected) {
  updateConnectionBadge(connectionStatus, connected);
  updateConnectionBadge(connectionStatusInline, connected);
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  const isDark = currentTheme === "dark";
  themeToggle.textContent = isDark ? "TEMA: OSCURO" : "TEMA: CLARO";
  themeToggle.classList.toggle("is-active", isDark);
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function applyBranding(branding) {
  if (!branding) return;
  const key = `${branding.wardName}|${branding.finishThanks}|${branding.finishDone}`;
  controlWardTitle.textContent = branding.wardName;

  if (key === lastBrandingKey) return;
  lastBrandingKey = key;

  if (document.activeElement !== wardNameInput) {
    wardNameInput.value = branding.wardName;
  }
  if (document.activeElement !== finishThanksInput) {
    finishThanksInput.value = branding.finishThanks;
  }
  if (document.activeElement !== finishDoneInput) {
    finishDoneInput.value = branding.finishDone;
  }
}

function showJoinPanel() {
  joinError.textContent = "";
  timerPanel.classList.add("is-hidden");
  joinPanel.classList.remove("is-hidden");
  history.replaceState(null, "", window.location.pathname);
  pinInput.focus();
  pinInput.select();
}

const client = createTimerClient({
  onConnection: syncConnectionBadge,
  onState: (state) => {
    const totalSeconds = Math.round(state.durationMs / 1000);
    minutesInput.value = Math.floor(totalSeconds / 60);
    secondsInput.value = totalSeconds % 60;
    startButton.disabled = state.isRunning;
    pauseButton.disabled = !state.isRunning;
    isScreenBlank = state.isBlank;
    blankScreenButton.textContent = isScreenBlank ? "[ MOSTRAR ]" : "[ VACIA ]";
    blankScreenButton.classList.toggle("is-active", isScreenBlank);
    blankScreenButton.setAttribute("aria-pressed", String(isScreenBlank));
    applyBranding(state.branding);
    applyTheme(state.theme);
    for (const button of presetButtons) {
      const isActive = Number(button.dataset.durationMs) === state.durationMs;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
    if (
      state.message !== lastScreenMessage &&
      document.activeElement !== screenMessageInput
    ) {
      screenMessageInput.value = state.message;
    }
    lastScreenMessage = state.message;
  },
});

renderTimer({ client, timerElement, labelElement: timerLabel });

function updateControlMeter() {
  const state = client.getState();
  const remaining = client.getRemaining();
  const duration = Math.max(1, state?.durationMs ?? 1);
  const ratio = Math.min(1, Math.max(0, remaining / duration));

  let color = "";
  if (state && ratio <= 0.2) {
    const urgency = Math.min(1, Math.max(0, 1 - ratio / 0.2));
    const hue = 28 - urgency * 20;
    const saturation = 34 + urgency * 22;
    const lightness = 44 - urgency * 8;
    color = `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  if (color) {
    document.body.style.setProperty("--meter-color", color);
  } else {
    document.body.style.removeProperty("--meter-color");
  }

  if (timeMeterFill) {
    timeMeterFill.style.transform = `scaleX(${ratio})`;
  }

  requestAnimationFrame(updateControlMeter);
}

requestAnimationFrame(updateControlMeter);

async function enterRoom(rawPin) {
  const pin = cleanPin(rawPin);
  joinError.textContent = "";

  const result = await client.join(pin);
  if (!result.ok) {
    joinError.textContent = result.error;
    return;
  }

  pinInput.value = result.pin;
  roomPin.textContent = result.pin;
  joinPanel.classList.add("is-hidden");
  timerPanel.classList.remove("is-hidden");
  displayLink.href = `/display.html?pin=${encodeURIComponent(result.pin)}`;
  history.replaceState(null, "", `?pin=${encodeURIComponent(result.pin)}`);
}

pinInput.addEventListener("input", () => {
  pinInput.value = cleanPin(pinInput.value);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enterRoom(pinInput.value);
});

changeRoomButton.addEventListener("click", showJoinPanel);

timeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  timeError.textContent = "";

  const minutes = Number(minutesInput.value);
  const seconds = Number(secondsInput.value);
  const durationMs = (minutes * 60 + seconds) * 1000;

  if (
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    minutes < 0 ||
    seconds < 0 ||
    seconds > 59 ||
    durationMs < 1_000 ||
    durationMs > 24 * 60 * 60 * 1000
  ) {
    timeError.textContent = "Usa un tiempo entre 1 segundo y 24 horas.";
    return;
  }

  client.socket.emit("timer:set", durationMs);
});

for (const button of presetButtons) {
  button.addEventListener("click", () => {
    timeError.textContent = "";
    client.socket.emit("timer:set", Number(button.dataset.durationMs));
  });
}

startButton.addEventListener("click", () => client.socket.emit("timer:start"));
pauseButton.addEventListener("click", () => client.socket.emit("timer:pause"));
resetButton.addEventListener("click", () => client.socket.emit("timer:reset"));
blankScreenButton.addEventListener("click", () => {
  client.socket.emit("display:blank", !isScreenBlank);
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  client.socket.emit("timer:message", screenMessageInput.value);
});

clearMessageButton.addEventListener("click", () => {
  screenMessageInput.value = "";
  client.socket.emit("timer:message", "");
});

brandingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  brandingStatus.textContent = "";
  client.socket.emit("branding:update", {
    wardName: wardNameInput.value,
    finishThanks: finishThanksInput.value,
    finishDone: finishDoneInput.value,
  });
  brandingStatus.textContent = "CFG guardada.";
});

themeToggle.addEventListener("click", () => {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  client.socket.emit("theme:update", nextTheme);
});

client.socket.on("room:error", (message) => {
  timeError.textContent = message;
  brandingStatus.textContent = message;
});

const initialPin = pinFromUrl();
if (initialPin) {
  pinInput.value = initialPin;
  enterRoom(initialPin);
}
