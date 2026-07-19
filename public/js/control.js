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
const timerElement = document.querySelector("#timer");
const timerLabel = document.querySelector("#timer-label");
const timeForm = document.querySelector("#time-form");
const minutesInput = document.querySelector("#minutes");
const secondsInput = document.querySelector("#seconds");
const timeError = document.querySelector("#time-error");
const startButton = document.querySelector("#start-button");
const pauseButton = document.querySelector("#pause-button");
const resetButton = document.querySelector("#reset-button");
const displayLink = document.querySelector("#display-link");

const client = createTimerClient({
  onConnection: (connected) => updateConnectionBadge(connectionStatus, connected),
  onState: (state) => {
    const totalSeconds = Math.round(state.durationMs / 1000);
    minutesInput.value = Math.floor(totalSeconds / 60);
    secondsInput.value = totalSeconds % 60;
    startButton.disabled = state.isRunning;
    pauseButton.disabled = !state.isRunning;
  },
});

renderTimer({ client, timerElement, labelElement: timerLabel });

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

startButton.addEventListener("click", () => client.socket.emit("timer:start"));
pauseButton.addEventListener("click", () => client.socket.emit("timer:pause"));
resetButton.addEventListener("click", () => client.socket.emit("timer:reset"));

client.socket.on("room:error", (message) => {
  timeError.textContent = message;
});

const initialPin = pinFromUrl();
if (initialPin) {
  pinInput.value = initialPin;
  enterRoom(initialPin);
}
