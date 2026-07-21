const {
  cleanPin,
  createTimerClient,
  pinFromUrl,
  renderTimer,
} = window.TimerTools;

const joinForm = document.querySelector("#join-form");
const joinPanel = document.querySelector("#join-panel");
const displayPanel = document.querySelector("#display-panel");
const pinInput = document.querySelector("#pin");
const joinError = document.querySelector("#join-error");
const timerElement = document.querySelector("#timer");
const timerLabel = document.querySelector("#timer-label");
const timeMeterFill = document.querySelector("#time-meter-fill");
const finishSequence = document.querySelector("#finish-sequence");
const messageBanner = document.querySelector("#screen-message-banner");
const messageElement = document.querySelector("#screen-message");
const fullscreenButton = document.querySelector("#fullscreen-button");
const changeRoomButton = document.querySelector("#change-room-button");
const displayRoomPin = document.querySelector("#display-room-pin");
const displayChurchName = document.querySelector("#display-church-name");
const displayWardName = document.querySelector("#display-ward-name");
const finalThanks = document.querySelector("#final-thanks");
const finalAlertText = document.querySelector("#final-alert-text");
let wakeLock = null;
let lastScreenMessage = "";
let finishPhase = "idle";
let finishTimers = [];

function clearFinishTimers() {
  for (const id of finishTimers) clearTimeout(id);
  finishTimers = [];
}

function resetFinishSequence() {
  clearFinishTimers();
  finishPhase = "idle";
  finishSequence.hidden = true;
  finishSequence.setAttribute("aria-hidden", "true");
  document.body.classList.remove(
    "timer-finished",
    "finish-entering",
    "finish-visible",
    "finish-settled",
  );
  document.body.style.removeProperty("--finish-accent");
  document.body.style.removeProperty("--finish-ink");
}

function beginFinishSequence(accentColor) {
  if (finishPhase !== "idle") return;

  finishPhase = "entering";
  clearFinishTimers();

  const accent = accentColor || (document.body.classList.contains("display-dark") ? "#b56a5c" : "#9a5348");
  document.body.style.setProperty("--finish-accent", accent);
  document.body.style.setProperty(
    "--finish-ink",
    document.body.classList.contains("display-dark") ? "#e7e5e4" : "#5c4038",
  );
  document.body.classList.add("timer-finished", "finish-entering");
  finishSequence.hidden = false;
  finishSequence.setAttribute("aria-hidden", "false");

  finishTimers.push(
    setTimeout(() => {
      document.body.classList.add("finish-visible");
    }, 220),
  );

  finishTimers.push(
    setTimeout(() => {
      document.body.classList.remove("finish-entering");
      document.body.classList.add("finish-settled");
      finishPhase = "settled";
    }, 1700),
  );
}

function applyBranding(branding) {
  if (!branding) return;
  displayChurchName.textContent = branding.churchName;
  displayWardName.textContent = branding.wardName;
  finalThanks.textContent = branding.finishThanks;
  finalAlertText.textContent = branding.finishDone;
  document.title = `Pantalla · ${branding.wardName}`;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("display-dark", isDark);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute("content", isDark ? "#171614" : "#f7f4ef");
  }
}

function updateScreenMessage(value) {
  const message = String(value ?? "");
  if (message === lastScreenMessage) return;

  lastScreenMessage = message;
  messageElement.textContent = message;
  messageBanner.classList.toggle("is-hidden", !message);

  if (message) {
    const duration = Math.min(32, Math.max(12, 8 + message.length * 0.16));
    messageElement.style.setProperty("--message-duration", `${duration}s`);
    messageElement.style.animation = "none";
    void messageElement.offsetWidth;
    messageElement.style.animation = "";
  }
}

function showJoinPanel() {
  joinError.textContent = "";
  displayPanel.classList.add("is-hidden");
  resetFinishSequence();
  document.body.classList.remove("screen-blanked");
  joinPanel.classList.remove("is-hidden");
  history.replaceState(null, "", window.location.pathname);
  pinInput.focus();
  pinInput.select();
}

async function keepScreenAwake() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || wakeLock) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

async function enterFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;

  const page = document.documentElement;
  const requestFullscreen = page.requestFullscreen || page.webkitRequestFullscreen;
  if (!requestFullscreen) return;

  try {
    await requestFullscreen.call(page, { navigationUI: "hide" });
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Safari puede requerir abrir la página desde la pantalla de inicio.
  }
}

async function toggleFullscreen() {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;

  if (fullscreenElement) {
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      await exitFullscreen?.call(document);
    } catch {
      // El navegador puede impedir salir programáticamente.
    }
    return;
  }

  await enterFullscreen();
}

function updateFullscreenButton() {
  const isFullscreen = Boolean(
    document.fullscreenElement || document.webkitFullscreenElement,
  );
  const label = isFullscreen ? "Salir de pantalla completa" : "Pantalla completa";

  fullscreenButton.classList.toggle("is-active", isFullscreen);
  fullscreenButton.setAttribute("aria-label", label);
  fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  fullscreenButton.querySelector("span").textContent = label;
}

function activateDisplay() {
  void toggleFullscreen();
  void keepScreenAwake();
}

fullscreenButton.addEventListener("click", activateDisplay);
changeRoomButton.addEventListener("click", showJoinPanel);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    keepScreenAwake();
  }
});

const client = createTimerClient({
  onState: (state) => {
    const hasFinished = !state.isRunning && state.remainingMs === 0;
    document.body.classList.toggle("screen-blanked", state.isBlank);
    updateScreenMessage(state.message);
    applyBranding(state.branding);
    applyTheme(state.theme);

    if (hasFinished) {
      const accent =
        getComputedStyle(timerElement).color ||
        document.body.style.getPropertyValue("--meter-color") ||
        (document.body.classList.contains("display-dark") ? "#b56a5c" : "#9a5348");
      beginFinishSequence(accent);
    } else if (finishPhase !== "idle") {
      resetFinishSequence();
    }
  },
});

renderTimer({ client, timerElement, labelElement: timerLabel });

function updateTimerColor() {
  const state = client.getState();
  const remaining = client.getRemaining();
  const duration = Math.max(1, state?.durationMs ?? 1);
  const ratio = Math.min(1, Math.max(0, remaining / duration));

  let color = "";
  if (state && ratio <= 0.2 && finishPhase === "idle") {
    // Ámbar cálido → rojo terracota sobrio (encaja con el cierre)
    const urgency = Math.min(1, Math.max(0, 1 - ratio / 0.2));
    const hue = 28 - urgency * 20;
    const saturation = 34 + urgency * 22;
    const isDark = document.body.classList.contains("display-dark");
    const lightness = (isDark ? 58 : 44) - urgency * 8;
    color = `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  if (color) {
    document.body.style.setProperty("--meter-color", color);
    timerElement.style.color = color;
  } else if (finishPhase === "idle") {
    document.body.style.removeProperty("--meter-color");
    timerElement.style.color = "";
  }

  if (timeMeterFill) {
    timeMeterFill.style.transform = `scaleX(${ratio})`;
  }

  requestAnimationFrame(updateTimerColor);
}

requestAnimationFrame(updateTimerColor);

async function enterRoom(rawPin) {
  const pin = cleanPin(rawPin);
  joinError.textContent = "";

  const result = await client.join(pin);
  if (!result.ok) {
    joinError.textContent = result.error;
    return;
  }

  pinInput.value = result.pin;
  displayRoomPin.textContent = result.pin;
  joinPanel.classList.add("is-hidden");
  displayPanel.classList.remove("is-hidden");
  history.replaceState(null, "", `?pin=${encodeURIComponent(result.pin)}`);
}

pinInput.addEventListener("input", () => {
  pinInput.value = cleanPin(pinInput.value);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enterRoom(pinInput.value);
});

client.socket.on("room:error", (message) => {
  joinError.textContent = message;
});

const initialPin = pinFromUrl();
if (initialPin) {
  pinInput.value = initialPin;
  enterRoom(initialPin);
}
