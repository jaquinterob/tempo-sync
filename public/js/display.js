const {
  cleanPin,
  createTimerClient,
  pinFromUrl,
  renderTimer,
  updateConnectionBadge,
} = window.TimerTools;

const joinForm = document.querySelector("#join-form");
const joinPanel = document.querySelector("#join-panel");
const displayPanel = document.querySelector("#display-panel");
const pinInput = document.querySelector("#pin");
const joinError = document.querySelector("#join-error");
const roomPin = document.querySelector("#room-pin");
const connectionStatus = document.querySelector("#connection-status");
const timerElement = document.querySelector("#timer");
const timerLabel = document.querySelector("#timer-label");

const client = createTimerClient({
  onConnection: (connected) => updateConnectionBadge(connectionStatus, connected),
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
