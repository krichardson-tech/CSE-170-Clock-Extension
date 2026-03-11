const modeLabelEl = document.getElementById("modeLabel");
const timeRemainingEl = document.getElementById("timeRemaining");
const phaseLabelEl = document.getElementById("phaseLabel");
const cycleCountEl = document.getElementById("cycleCount");
const statusTextEl = document.getElementById("statusText");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const openOptionsBtn = document.getElementById("openOptions");
const applyConfigBtn = document.getElementById("applyConfigBtn");
const modeSelectEl = document.getElementById("modeSelect");
const customFocusEl = document.getElementById("customFocus");
const customBreakEl = document.getElementById("customBreak");

let liveState = null;
let tickInterval = null;

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result));
  });
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getPhaseLabel(state) {
  if (!state) {
    return "Focus";
  }

  if (state.phase === "break") {
    return state.isLongBreak ? "Long Break" : "Break";
  }

  return "Focus";
}

function updateButtons(state) {
  const isRunning = state && state.status === "running";
  const isPaused = state && state.status === "paused";

  startBtn.textContent = isPaused ? "Resume" : "Start";
  pauseBtn.disabled = !isRunning;
}

function toggleCustomFields() {
  const customMode = modeSelectEl.value === "custom";
  customFocusEl.disabled = !customMode;
  customBreakEl.disabled = !customMode;
}

function modeLabelFromKey(modeKey) {
  if (modeKey === "pomodoro15") {
    return "Pomodoro 15/5";
  }
  if (modeKey === "custom") {
    return "Custom";
  }
  return "Pomodoro 25/5";
}

function setStatus(message) {
  statusTextEl.textContent = message;
  if (!message) {
    return;
  }

  setTimeout(() => {
    statusTextEl.textContent = "";
  }, 1500);
}

function getConfigPayload() {
  return {
    modeKey: modeSelectEl.value,
    customFocusMinutes: Math.max(1, Number(customFocusEl.value) || 30),
    customBreakMinutes: Math.max(1, Number(customBreakEl.value) || 10)
  };
}

function syncControlsFromState(state) {
  if (!state) {
    return;
  }

  modeSelectEl.value = state.modeKey || "pomodoro25";

  if (state.modeKey === "custom") {
    customFocusEl.value = state.focusMinutes || customFocusEl.value || 30;
    customBreakEl.value = state.breakMinutes || customBreakEl.value || 10;
  }

  toggleCustomFields();
}

function render(state) {
  if (!state) {
    return;
  }

  liveState = state;
  modeLabelEl.textContent = `Mode: ${state.modeLabel || "-"}`;
  phaseLabelEl.textContent = getPhaseLabel(state);
  cycleCountEl.textContent = `Cycles: ${state.cycleCount || 0}`;
  timeRemainingEl.textContent = formatSeconds(state.remainingSeconds);
  updateButtons(state);
  syncControlsFromState(state);
}

function startTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
  }

  tickInterval = setInterval(() => {
    if (!liveState) {
      return;
    }

    if (liveState.status === "running") {
      liveState.remainingSeconds = Math.max(0, liveState.remainingSeconds - 1);
      timeRemainingEl.textContent = formatSeconds(liveState.remainingSeconds);
    }
  }, 1000);
}

async function refreshState() {
  const response = await sendMessage({ type: "getTimerState" });
  if (response && response.ok) {
    render(response.state);
  }
}

async function loadPopupSettings() {
  const settings = await storageGet({
    defaultMode: "pomodoro25",
    customFocusMinutes: 30,
    customBreakMinutes: 10
  });

  modeSelectEl.value = settings.defaultMode;
  customFocusEl.value = settings.customFocusMinutes;
  customBreakEl.value = settings.customBreakMinutes;
  toggleCustomFields();
}

startBtn.addEventListener("click", async () => {
  const config = getConfigPayload();
  const response = await sendMessage({
    type: "startTimer",
    modeKey: config.modeKey,
    config
  });
  if (response && response.ok) {
    render(response.state);
    setStatus("Timer started.");
  }
});

pauseBtn.addEventListener("click", async () => {
  const response = await sendMessage({ type: "pauseTimer" });
  if (response && response.ok) {
    render(response.state);
  }
});

resetBtn.addEventListener("click", async () => {
  const response = await sendMessage({ type: "resetTimer" });
  if (response && response.ok) {
    render(response.state);
    setStatus("Timer reset.");
  }
});

applyConfigBtn.addEventListener("click", async () => {
  const response = await sendMessage({
    type: "updateTimerConfig",
    config: getConfigPayload()
  });

  if (response && response.ok) {
    render(response.state);
    setStatus("Timer updated.");
    return;
  }

  setStatus("Unable to update timer.");
});

modeSelectEl.addEventListener("change", () => {
  toggleCustomFields();
  modeLabelEl.textContent = `Mode: ${modeLabelFromKey(modeSelectEl.value)}`;
});

openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "timerStateChanged" || !message.state) {
    return;
  }

  render({
    ...message.state,
    modeLabel: modeLabelFromKey(message.state.modeKey)
  });
  refreshState();
});

loadPopupSettings().then(() => {
  refreshState();
  startTicking();
});
