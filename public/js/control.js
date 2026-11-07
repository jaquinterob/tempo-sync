const {
  cleanPin,
  createTimerClient,
  displayShareUrl,
  displayUnitLabel,
  getShareOrigin,
  keyFromUrl,
  normalizeUnitText,
  pinFromUrl,
  prepareShareOrigin,
  readStoredControlToken,
  shouldCreateFromUrl,
  storeControlToken,
  wardFromUrl,
  renderTimer,
  updateConnectionBadge,
} = window.TimerTools;

const joinForm = document.querySelector("#join-form");
const joinPanel = document.querySelector("#join-panel");
const timerPanel = document.querySelector("#timer-panel");
const pinInput = document.querySelector("#pin");
const joinError = document.querySelector("#join-error");
const createRoomButton = document.querySelector("#create-room-button");
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
const shareSheetButton = document.querySelector("#share-sheet-button");
const sharePin = document.querySelector("#share-pin");
const shareStatus = document.querySelector("#share-status");
const brandingForm = document.querySelector("#branding-form");
const unitNameInput = document.querySelector("#unit-name");
const finishThanksInput = document.querySelector("#finish-thanks");
const finishDoneInput = document.querySelector("#finish-done");
const brandingStatus = document.querySelector("#branding-status");
const controlWardTitle = document.querySelector("#control-ward-title");
const themeToggle = document.querySelector("#theme-toggle");
const timeMeterFill = document.querySelector("#time-meter-fill");
const shareGate = document.querySelector("#share-gate");
const shareGatePin = document.querySelector("#share-gate-pin");
const shareGateShare = document.querySelector("#share-gate-share");
const shareGateDone = document.querySelector("#share-gate-done");
const shareGateStatus = document.querySelector("#share-gate-status");
const shareMenu = document.querySelector("#share-menu");
const shareMenuWhatsapp = document.querySelector("#share-menu-whatsapp");
const shareMenuCopy = document.querySelector("#share-menu-copy");
const shareMenuSms = document.querySelector("#share-menu-sms");
const shareMenuClose = document.querySelector("#share-menu-close");
const shareMenuBackdrop = document.querySelector("#share-menu-backdrop");
let lastScreenMessage = "";
let isScreenBlank = false;
let lastBrandingKey = "";
let currentTheme = "light";
let joining = false;
let shareStatusTarget = shareStatus;
let brandingSaveTimer = 0;
let lastSentBrandingKey = "";

function currentUnitLabel() {
  return normalizeUnitText(unitNameInput.value, 60);
}

function fillUnitFields(wardName) {
  if (document.activeElement !== unitNameInput) {
    unitNameInput.value = normalizeUnitText(wardName, 60);
  }
}

function syncConnectionBadge(connected) {
  updateConnectionBadge(connectionStatus, connected);
  updateConnectionBadge(connectionStatusInline, connected);
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  const isDark = currentTheme === "dark";
  const label = themeToggle.querySelector(".theme-toggle-label");
  if (label) label.textContent = isDark ? "DISPLAY: Oscuro" : "DISPLAY: Claro";
  const themeIcon = themeToggle.querySelector("#theme-icon");
  if (themeIcon && window.PulpitIcons) {
    window.PulpitIcons.setIcon(
      themeIcon,
      isDark ? "moon" : "sun",
      "ui-icon lucide",
    );
  }
  themeToggle.classList.toggle("is-active", isDark);
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.title = isDark ? "DISPLAY: Oscuro" : "DISPLAY: Claro";
}

function applyBranding(branding) {
  if (!branding) return;
  const key = `${branding.wardName}|${branding.finishThanks}|${branding.finishDone}`;
  controlWardTitle.textContent = displayUnitLabel(branding.wardName);
  controlWardTitle.classList.toggle("is-placeholder", !normalizeUnitText(branding.wardName));

  if (key === lastBrandingKey) return;
  lastBrandingKey = key;

  fillUnitFields(branding.wardName);
  if (document.activeElement !== finishThanksInput) {
    finishThanksInput.value = branding.finishThanks;
  }
  if (document.activeElement !== finishDoneInput) {
    finishDoneInput.value = branding.finishDone;
  }
}

function buildShareMessage(pin, url) {
  return (
    `Pulpit Timer — abre este enlace en el celular del reloj (horizontal).\n` +
    `Usa http (no https):\n${url}\n\n` +
    `Si el enlace no abre, entra a la app y escribe el código: ${pin}`
  );
}

function whatsappShareHref(pin, url) {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(buildShareMessage(pin, url))}`;
}

function smsShareHref(pin, url) {
  const body = encodeURIComponent(buildShareMessage(pin, url));
  // iOS usa &body=; Android suele aceptar ?body=
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? `sms:&body=${body}`
    : `sms:?body=${body}`;
}

function canUseNativeShare() {
  return typeof navigator.share === "function";
}

function updateShareLinks(pin) {
  const clean = cleanPin(pin);
  const url = displayShareUrl(clean);
  if (sharePin) sharePin.textContent = clean || "—";
  if (displayLink && url) displayLink.href = url;
  if (shareGatePin) shareGatePin.textContent = clean || "—";
  const shareGateUrl = document.querySelector("#share-gate-url");
  if (shareGateUrl) {
    shareGateUrl.textContent = url || "";
    shareGateUrl.hidden = !url;
  }
  if (url) {
    if (shareMenuWhatsapp) shareMenuWhatsapp.href = whatsappShareHref(clean, url);
    if (shareMenuSms) shareMenuSms.href = smsShareHref(clean, url);
  }
}

function showShareMenu() {
  if (!shareMenu) return;
  shareMenu.hidden = false;
  shareMenu.classList.remove("is-hidden");
  document.body.classList.add("share-menu-open");
}

function hideShareMenu() {
  if (!shareMenu) return;
  shareMenu.classList.add("is-hidden");
  shareMenu.hidden = true;
  document.body.classList.remove("share-menu-open");
}

async function openShareSheet(targetStatus = shareStatus) {
  shareStatusTarget = targetStatus || shareStatus;
  await prepareShareOrigin();
  const pin = client.getPin();
  updateShareLinks(pin);
  const url = displayShareUrl(pin);
  if (!url) return;

  const text = buildShareMessage(pin, url);
  if (canUseNativeShare()) {
    try {
      await navigator.share({
        title: "Pulpit Timer",
        text,
        url,
      });
      if (shareStatusTarget) shareStatusTarget.textContent = "Listo.";
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      // Si el sistema falla, cae al menú manual.
    }
  }

  showShareMenu();
}

function shouldShowShareGate(pin) {
  try {
    return sessionStorage.getItem("pulpit-need-share") === pin;
  } catch {
    return false;
  }
}

function markNeedShare(pin) {
  try {
    sessionStorage.setItem("pulpit-need-share", pin);
  } catch {
    // sin sessionStorage
  }
}

function clearShareGateFlag() {
  try {
    sessionStorage.removeItem("pulpit-need-share");
  } catch {
    // sin sessionStorage
  }
}

async function showShareGate(pin) {
  if (!shareGate || !shouldShowShareGate(pin)) return;
  await prepareShareOrigin();
  updateShareLinks(pin);
  if (shareGateStatus) shareGateStatus.textContent = "";
  shareGate.classList.remove("is-hidden");
  document.body.classList.add("share-gate-open");
}

function hideShareGate() {
  if (!shareGate) return;
  clearShareGateFlag();
  hideShareMenu();
  shareGate.classList.add("is-hidden");
  document.body.classList.remove("share-gate-open");
}

async function copyDisplayLink(targetStatus = shareStatus) {
  await prepareShareOrigin();
  const pin = client.getPin();
  updateShareLinks(pin);
  const url = displayShareUrl(pin);
  if (!url) return;

  try {
    await navigator.clipboard.writeText(buildShareMessage(pin, url));
    if (targetStatus) {
      const viaLan = getShareOrigin() !== window.location.origin;
      targetStatus.textContent = viaLan
        ? "Enlace copiado (Wi‑Fi local)."
        : "Enlace copiado.";
    }
  } catch {
    if (targetStatus) targetStatus.textContent = url;
  }
}

function controlUrl(pin, token) {
  const params = new URLSearchParams({
    pin,
    key: token,
  });
  return `?${params.toString()}`;
}

async function showJoinPanel() {
  const lastPin = cleanPin(client.getPin() || pinInput.value);
  joinError.textContent = "";
  await client.leave();
  timerPanel.classList.add("is-hidden");
  joinPanel.classList.remove("is-hidden");
  shareStatus.textContent = "";
  hideShareGate();
  history.replaceState(null, "", window.location.pathname);
  if (lastPin) pinInput.value = lastPin;
  pinInput.focus();
  pinInput.select();
}

const client = createTimerClient({
  role: "control",
  onConnection: syncConnectionBadge,
  onState: (state) => {
    const totalSeconds = Math.round(state.durationMs / 1000);
    minutesInput.value = Math.floor(totalSeconds / 60);
    secondsInput.value = totalSeconds % 60;
    startButton.disabled = state.isRunning;
    pauseButton.disabled = !state.isRunning;
    isScreenBlank = state.isBlank;
    blankScreenLabel.textContent = isScreenBlank ? "Mostrar pantalla" : "Ocultar pantalla";
    blankScreenButton.classList.toggle("is-active", isScreenBlank);
    blankScreenButton.setAttribute("aria-pressed", String(isScreenBlank));
    document.body.classList.toggle("control-blanked", isScreenBlank);
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

function setJoining(isJoining, label = "Crear sala nueva") {
  joining = isJoining;
  if (createRoomButton) {
    createRoomButton.disabled = isJoining;
    createRoomButton.textContent = isJoining ? "Creando…" : label;
  }
  const submit = joinForm.querySelector('button[type="submit"]');
  if (submit) {
    submit.disabled = isJoining;
    submit.textContent = isJoining ? "Entrando…" : "Entrar";
  }
}

function activateControlRoom(result, options = {}) {
  pinInput.value = result.pin;
  roomPin.textContent = result.pin;
  joinPanel.classList.add("is-hidden");
  timerPanel.classList.remove("is-hidden");
  updateShareLinks(result.pin);
  shareStatus.textContent = "";
  storeControlToken(result.pin, result.controlToken || client.getControlToken());
  history.replaceState(
    null,
    "",
    controlUrl(result.pin, result.controlToken || client.getControlToken()),
  );
  if (options.needShare) markNeedShare(result.pin);
  showShareGate(result.pin);

  let wardName = normalizeUnitText(options.wardName, 60);
  if (!wardName) {
    try {
      wardName = normalizeUnitText(localStorage.getItem("pulpit-ward-name"), 60);
    } catch {
      wardName = "";
    }
  }
  if (wardName) {
    fillUnitFields(wardName);
    const finishThanks =
      finishThanksInput.value.trim() || "Agradecemos su discurso.";
    const finishDone = finishDoneInput.value.trim() || "Su tiempo ha terminado.";
    client.socket.emit("branding:update", {
      wardName,
      finishThanks,
      finishDone,
    });
    try {
      localStorage.setItem("pulpit-ward-name", wardName);
    } catch {
      // sin localStorage
    }
  }
}

async function createControlRoom(options = {}) {
  if (joining) return;
  joinError.textContent = "";
  setJoining(true);
  const result = await client.createRoom();
  setJoining(false);
  if (!result?.ok) {
    joinError.textContent = result?.error || "No se pudo crear la sala.";
    return;
  }
  activateControlRoom(result, {
    wardName: options.wardName,
    needShare: options.needShare !== false,
  });
}

async function enterRoom(rawPin, options = {}) {
  if (joining) return;
  const pin = cleanPin(rawPin);
  joinError.textContent = "";
  setJoining(true, "Entrando…");

  const result = await client.join(pin, {
    role: "control",
    controlToken: options.controlToken || readStoredControlToken(pin) || keyFromUrl(),
  });
  setJoining(false);

  if (!result?.ok) {
    joinError.textContent = result?.error || "No se pudo entrar.";
    return;
  }

  activateControlRoom(result, {
    wardName: options.wardName,
    needShare: options.needShare,
  });
}

if (shareGateShare) {
  shareGateShare.addEventListener("click", () => {
    openShareSheet(shareGateStatus);
  });
}
if (shareGateDone) {
  shareGateDone.addEventListener("click", hideShareGate);
}
if (shareSheetButton) {
  shareSheetButton.addEventListener("click", () => {
    openShareSheet(shareStatus);
  });
}
if (shareMenuCopy) {
  shareMenuCopy.addEventListener("click", async () => {
    await copyDisplayLink(shareStatusTarget);
    hideShareMenu();
  });
}
if (shareMenuWhatsapp) {
  shareMenuWhatsapp.addEventListener("click", () => {
    hideShareMenu();
  });
}
if (shareMenuSms) {
  shareMenuSms.addEventListener("click", () => {
    hideShareMenu();
  });
}
if (shareMenuClose) {
  shareMenuClose.addEventListener("click", hideShareMenu);
}
if (shareMenuBackdrop) {
  shareMenuBackdrop.addEventListener("click", hideShareMenu);
}

pinInput.addEventListener("input", () => {
  pinInput.value = cleanPin(pinInput.value);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enterRoom(pinInput.value);
});

if (createRoomButton) {
  createRoomButton.addEventListener("click", () => {
    createControlRoom({ needShare: true });
  });
}

changeRoomButton.addEventListener("click", () => {
  const state = client.getState();
  if (state?.isRunning) {
    const ok = window.confirm(
      "¿Salir del control de esta sala? El reloj en la pantalla grande sigue corriendo.",
    );
    if (!ok) return;
  }
  showJoinPanel();
});
if (copyDisplayLinkButton) {
  copyDisplayLinkButton.addEventListener("click", () => copyDisplayLink());
}

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

function brandingPayload() {
  const wardName = currentUnitLabel();
  const finishThanks = finishThanksInput.value.trim();
  const finishDone = finishDoneInput.value.trim();
  return { wardName, finishThanks, finishDone };
}

function syncLocalUnitTitle(wardName) {
  controlWardTitle.textContent = displayUnitLabel(wardName);
  controlWardTitle.classList.toggle("is-placeholder", !wardName);
}

function saveBranding({ force = false } = {}) {
  if (!client.socket.connected) return;
  const { wardName, finishThanks, finishDone } = brandingPayload();
  if (!wardName || !finishThanks || !finishDone) return;

  const key = `${wardName}|${finishThanks}|${finishDone}`;
  if (!force && key === lastSentBrandingKey) return;

  lastSentBrandingKey = key;
  lastBrandingKey = key;
  client.socket.emit("branding:update", {
    wardName,
    finishThanks,
    finishDone,
  });
  try {
    localStorage.setItem("pulpit-ward-name", wardName);
  } catch {
    // sin localStorage
  }
  brandingStatus.textContent = "Guardado";
}

function scheduleBrandingSave() {
  window.clearTimeout(brandingSaveTimer);
  brandingSaveTimer = window.setTimeout(() => {
    saveBranding();
  }, 320);
}

function onBrandingFieldInput() {
  syncLocalUnitTitle(currentUnitLabel());
  scheduleBrandingSave();
}

brandingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(brandingSaveTimer);
  const { wardName } = brandingPayload();
  if (!wardName) {
    brandingStatus.textContent = "Escribe el nombre de la unidad.";
    unitNameInput.focus();
    return;
  }
  saveBranding({ force: true });
});

for (const input of [unitNameInput, finishThanksInput, finishDoneInput]) {
  input.addEventListener("input", onBrandingFieldInput);
  input.addEventListener("change", () => {
    window.clearTimeout(brandingSaveTimer);
    saveBranding({ force: true });
  });
}

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
const initialKey = keyFromUrl();
const initialWard = wardFromUrl();
const wantsCreate = shouldCreateFromUrl();

prepareShareOrigin().finally(() => {
  if (wantsCreate) {
    createControlRoom({ wardName: initialWard, needShare: true });
  } else if (initialPin && (initialKey || readStoredControlToken(initialPin))) {
    pinInput.value = initialPin;
    enterRoom(initialPin, {
      wardName: initialWard,
      controlToken: initialKey || readStoredControlToken(initialPin),
      needShare: false,
    });
  }
});
