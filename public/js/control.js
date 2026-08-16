const {
  cleanPin,
  createTimerClient,
  displayShareUrl,
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
const blankScreenLabel = document.querySelector("#blank-screen-label");
const messageForm = document.querySelector("#message-form");
const screenMessageInput = document.querySelector("#screen-message");
const clearMessageButton = document.querySelector("#clear-message-button");
const displayLink = document.querySelector("#display-link");
const changeRoomButton = document.querySelector("#change-room-button");
const copyDisplayLinkButton = document.querySelector("#copy-display-link");
const whatsappShare = document.querySelector("#whatsapp-share");
const sharePin = document.querySelector("#share-pin");
const shareStatus = document.querySelector("#share-status");
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

const THEME_ICON_SUN =
  '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" />' +
  '<path d="M12 5v1.2M12 17.8V19M5 12h1.2M17.8 12H19M7.1 7.1l.85.85M16.05 16.05l.85.85M16.9 7.1l-.85.85M7.95 16.05l-.85.85" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />';
const THEME_ICON_MOON =
  '<path d="M15.8 13.4A5.8 5.8 0 0 1 10.2 6.6 6.2 6.2 0 1 0 15.8 13.4z" fill="none" stroke="currentColor" stroke-width="1.6" />';

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  const isDark = currentTheme === "dark";
  const label = themeToggle.querySelector(".theme-toggle-label");
  if (label) label.textContent = isDark ? "DISPLAY: Oscuro" : "DISPLAY: Claro";
  const themeIcon = themeToggle.querySelector("#theme-icon");
  if (themeIcon) {
    themeIcon.innerHTML = isDark ? THEME_ICON_MOON : THEME_ICON_SUN;
  }
  themeToggle.classList.toggle("is-active", isDark);
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.title = isDark ? "DISPLAY: Oscuro" : "DISPLAY: Claro";
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

function updateShareLinks(pin) {
  const url = displayShareUrl(pin);
  sharePin.textContent = pin;
  displayLink.href = url;
  const message = `Abre la pantalla de Pulpit Timer:\n${url}`;
  whatsappShare.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
}

async function copyDisplayLink() {
  const pin = client.getPin();
  const url = displayShareUrl(pin);
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    shareStatus.textContent = "Enlace copiado. Pégalo en WhatsApp o SMS.";
  } catch {
    shareStatus.textContent = url;
  }
}

function showJoinPanel() {
  joinError.textContent = "";
  timerPanel.classList.add("is-hidden");
  joinPanel.classList.remove("is-hidden");
  shareStatus.textContent = "";
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
    blankScreenLabel.textContent = isScreenBlank ? "Mostrar" : "Ocultar pantalla";
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
  updateShareLinks(result.pin);
  shareStatus.textContent = "";
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
copyDisplayLinkButton.addEventListener("click", copyDisplayLink);

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

const panelThemeButton = document.querySelector("#panel-theme-button");
const panelThemeLabel = document.querySelector("#panel-theme-label");
const panelThemeOptions = document.querySelector("#panel-theme-options");
const panelThemeOptionButtons = document.querySelectorAll(".panel-theme-option");

const CONTROL_THEME_LABELS = {
  classic: "PANEL: Clásico",
  kiosk: "PANEL: Kiosk",
  print: "PANEL: Print",
  accessible: "PANEL: Accesible",
};

function setControlTheme(theme) {
  const valid = CONTROL_THEME_LABELS[theme] ? theme : "classic";
  document.body.classList.remove(
    "control-theme-classic",
    "control-theme-kiosk",
    "control-theme-print",
    "control-theme-accessible",
  );
  if (valid !== "classic") document.body.classList.add(`control-theme-${valid}`);
  panelThemeLabel.textContent = CONTROL_THEME_LABELS[valid];
  for (const option of panelThemeOptionButtons) {
    const selected = option.dataset.controlTheme === valid;
    option.setAttribute("aria-selected", String(selected));
  }
  try {
    localStorage.setItem("pulpit-panel-theme", valid);
  } catch {
    // localStorage no disponible: el tema aplica solo en esta sesión.
  }
}

function setPanelThemeMenuOpen(open) {
  panelThemeOptions.classList.toggle("is-hidden", !open);
  panelThemeButton.setAttribute("aria-expanded", String(open));
}

panelThemeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setPanelThemeMenuOpen(panelThemeOptions.classList.contains("is-hidden"));
});

for (const option of panelThemeOptionButtons) {
  option.addEventListener("click", () => {
    setControlTheme(option.dataset.controlTheme);
    setPanelThemeMenuOpen(false);
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".panel-theme-menu")) {
    setPanelThemeMenuOpen(false);
  }
});

let storedControlTheme = "classic";
try {
  storedControlTheme = localStorage.getItem("pulpit-panel-theme") || "classic";
} catch {
  // sin localStorage
}
setControlTheme(storedControlTheme);

client.socket.on("room:error", (message) => {
  timeError.textContent = message;
  brandingStatus.textContent = message;
});

const initialPin = pinFromUrl();
if (initialPin) {
  pinInput.value = initialPin;
  enterRoom(initialPin);
}
