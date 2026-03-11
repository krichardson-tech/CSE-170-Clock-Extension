const TIMER_ALARM_NAME = "focusguard-timer";

const DEFAULT_SETTINGS = {
  defaultMode: "pomodoro25",
  customFocusMinutes: 30,
  customBreakMinutes: 10,
  flaggedSites: [],
  soundEnabled: true
};

const DEFAULT_STATE = {
  modeKey: "pomodoro25",
  focusMinutes: 25,
  breakMinutes: 5,
  phase: "focus",
  status: "idle", // idle | running | paused
  remainingSeconds: 25 * 60,
  endTime: null,
  cycleCount: 0,
  isLongBreak: false
};

function withStorageGet(area, keys) {
  return new Promise((resolve) => {
    chrome.storage[area].get(keys, (result) => resolve(result));
  });
}

function withStorageSet(area, payload) {
  return new Promise((resolve) => {
    chrome.storage[area].set(payload, () => resolve());
  });
}

function withAlarmCreate(name, info) {
  return new Promise((resolve) => {
    chrome.alarms.create(name, info);
    resolve();
  });
}

function withAlarmClear(name) {
  return new Promise((resolve) => {
    chrome.alarms.clear(name, () => resolve());
  });
}

function withNotificationCreate(options) {
  return new Promise((resolve) => {
    chrome.notifications.create(options, () => resolve());
  });
}

function getModeDurations(modeKey, settings) {
  if (modeKey === "pomodoro15") {
    return { focusMinutes: 15, breakMinutes: 5 };
  }

  if (modeKey === "custom") {
    return {
      focusMinutes: Math.max(1, Number(settings.customFocusMinutes) || 30),
      breakMinutes: Math.max(1, Number(settings.customBreakMinutes) || 10)
    };
  }

  return { focusMinutes: 25, breakMinutes: 5 };
}

function sanitizeModeKey(modeKey) {
  if (modeKey === "pomodoro15" || modeKey === "pomodoro25" || modeKey === "custom") {
    return modeKey;
  }

  return "pomodoro25";
}

function sanitizeCustomMinutes(value, fallback) {
  return Math.max(1, Number(value) || fallback);
}

function getTimeRemainingSeconds(state) {
  if (state.status !== "running" || !state.endTime) {
    return Math.max(0, state.remainingSeconds);
  }

  return Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
}

async function getSettings() {
  const stored = await withStorageGet("sync", DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function getState() {
  const stored = await withStorageGet("local", { timerState: null });
  if (!stored.timerState) {
    const settings = await getSettings();
    const { focusMinutes, breakMinutes } = getModeDurations(settings.defaultMode, settings);
    const state = {
      ...DEFAULT_STATE,
      modeKey: settings.defaultMode,
      focusMinutes,
      breakMinutes,
      remainingSeconds: focusMinutes * 60
    };
    await setState(state);
    return state;
  }

  return { ...DEFAULT_STATE, ...stored.timerState };
}

async function setState(state) {
  await withStorageSet("local", { timerState: state });
}

function modeLabel(modeKey) {
  if (modeKey === "pomodoro15") {
    return "Pomodoro 15/5";
  }
  if (modeKey === "custom") {
    return "Custom";
  }
  return "Pomodoro 25/5";
}

async function notify(title, message) {
  const settings = await getSettings();
  await withNotificationCreate({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    silent: !settings.soundEnabled
  });
}

async function broadcastTimerStateChanged() {
  const state = await getState();
  const payload = {
    type: "timerStateChanged",
    state: {
      ...state,
      remainingSeconds: getTimeRemainingSeconds(state)
    }
  };

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) {
        return;
      }
      chrome.tabs.sendMessage(tab.id, payload, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

async function scheduleTimerAlarm(state) {
  const remaining = Math.max(1, getTimeRemainingSeconds(state));
  await withAlarmCreate(TIMER_ALARM_NAME, { delayInMinutes: remaining / 60 });
}

async function startSession(modeKey) {
  const settings = await getSettings();
  const requestedMode = sanitizeModeKey(modeKey || settings.defaultMode);
  const incomingState = await getState();
  let state = { ...incomingState };

  if (requestedMode !== state.modeKey) {
    const durations = getModeDurations(requestedMode, settings);
    state = {
      ...state,
      modeKey: requestedMode,
      focusMinutes: durations.focusMinutes,
      breakMinutes: durations.breakMinutes,
      phase: "focus",
      remainingSeconds: durations.focusMinutes * 60,
      status: "idle",
      endTime: null,
      isLongBreak: false
    };
  }

  if (state.status === "running") {
    return { ...state, remainingSeconds: getTimeRemainingSeconds(state) };
  }

  const remaining = state.status === "paused" ? state.remainingSeconds : (state.phase === "focus" ? state.focusMinutes * 60 : state.remainingSeconds);
  const nextState = {
    ...state,
    status: "running",
    remainingSeconds: remaining,
    endTime: Date.now() + remaining * 1000
  };

  await withAlarmClear(TIMER_ALARM_NAME);
  await scheduleTimerAlarm(nextState);
  await setState(nextState);
  await broadcastTimerStateChanged();

  return { ...nextState, remainingSeconds: getTimeRemainingSeconds(nextState) };
}

async function updateTimerConfig(config) {
  const currentSettings = await getSettings();
  const modeKey = sanitizeModeKey(config && config.modeKey ? config.modeKey : currentSettings.defaultMode);
  const customFocusMinutes = sanitizeCustomMinutes(
    config && config.customFocusMinutes,
    currentSettings.customFocusMinutes
  );
  const customBreakMinutes = sanitizeCustomMinutes(
    config && config.customBreakMinutes,
    currentSettings.customBreakMinutes
  );

  const nextSettings = {
    ...currentSettings,
    defaultMode: modeKey,
    customFocusMinutes,
    customBreakMinutes
  };

  await withStorageSet("sync", nextSettings);

  const state = await getState();
  if (state.status !== "running") {
    const durations = getModeDurations(modeKey, nextSettings);
    const nextState = {
      ...state,
      modeKey,
      focusMinutes: durations.focusMinutes,
      breakMinutes: durations.breakMinutes,
      phase: "focus",
      status: "idle",
      remainingSeconds: durations.focusMinutes * 60,
      endTime: null,
      cycleCount: 0,
      isLongBreak: false
    };

    await withAlarmClear(TIMER_ALARM_NAME);
    await setState(nextState);
    await broadcastTimerStateChanged();
    return { ...nextState, modeLabel: modeLabel(nextState.modeKey) };
  }

  await broadcastTimerStateChanged();
  return { ...(await getViewState()) };
}

async function pauseSession() {
  const state = await getState();

  if (state.status !== "running") {
    return { ...state, remainingSeconds: getTimeRemainingSeconds(state) };
  }

  const remaining = getTimeRemainingSeconds(state);
  const nextState = {
    ...state,
    status: "paused",
    remainingSeconds: remaining,
    endTime: null
  };

  await withAlarmClear(TIMER_ALARM_NAME);
  await setState(nextState);
  await broadcastTimerStateChanged();

  return nextState;
}

async function resetSession() {
  const settings = await getSettings();
  const state = await getState();
  const modeToUse = state.modeKey || settings.defaultMode;
  const { focusMinutes, breakMinutes } = getModeDurations(modeToUse, settings);

  const nextState = {
    ...DEFAULT_STATE,
    modeKey: modeToUse,
    focusMinutes,
    breakMinutes,
    remainingSeconds: focusMinutes * 60
  };

  await withAlarmClear(TIMER_ALARM_NAME);
  await setState(nextState);
  await broadcastTimerStateChanged();

  return nextState;
}

async function endSessionFromContent() {
  const reset = await resetSession();
  await notify("Session ended", "Focus session was ended from the distraction overlay.");
  return reset;
}

async function handleTimerAlarm() {
  const state = await getState();

  if (state.status !== "running") {
    return;
  }

  if (state.phase === "focus") {
    const cycleCount = state.cycleCount + 1;
    const isLongBreak = cycleCount % 3 === 0;
    const breakSeconds = state.breakMinutes * 60 * (isLongBreak ? 3 : 1);

    await notify("Focus complete", "Great work. Time for a break.");
    if (isLongBreak) {
      await notify("Long break", "You completed 3 cycles. Take a longer break.");
    }

    const nextState = {
      ...state,
      phase: "break",
      status: "running",
      cycleCount,
      isLongBreak,
      remainingSeconds: breakSeconds,
      endTime: Date.now() + breakSeconds * 1000
    };

    await setState(nextState);
    await withAlarmClear(TIMER_ALARM_NAME);
    await scheduleTimerAlarm(nextState);
    await broadcastTimerStateChanged();
    return;
  }

  await notify("Break complete", "Break finished. Back to focus.");
  const focusSeconds = state.focusMinutes * 60;
  const nextState = {
    ...state,
    phase: "focus",
    status: "running",
    isLongBreak: false,
    remainingSeconds: focusSeconds,
    endTime: Date.now() + focusSeconds * 1000
  };

  await setState(nextState);
  await withAlarmClear(TIMER_ALARM_NAME);
  await scheduleTimerAlarm(nextState);
  await broadcastTimerStateChanged();
}

async function getViewState() {
  const state = await getState();
  return {
    ...state,
    modeLabel: modeLabel(state.modeKey),
    remainingSeconds: getTimeRemainingSeconds(state)
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  const existing = await withStorageGet("local", { timerState: null });

  if (!existing.timerState) {
    const { focusMinutes, breakMinutes } = getModeDurations(settings.defaultMode, settings);
    await setState({
      ...DEFAULT_STATE,
      modeKey: settings.defaultMode,
      focusMinutes,
      breakMinutes,
      remainingSeconds: focusMinutes * 60
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.status === "running") {
    const remaining = getTimeRemainingSeconds(state);
    if (remaining <= 0) {
      await handleTimerAlarm();
      return;
    }

    const restored = {
      ...state,
      remainingSeconds: remaining,
      endTime: Date.now() + remaining * 1000
    };

    await setState(restored);
    await withAlarmClear(TIMER_ALARM_NAME);
    await scheduleTimerAlarm(restored);
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.defaultMode || changes.customFocusMinutes || changes.customBreakMinutes) {
    const state = await getState();
    if (state.status === "idle") {
      const settings = await getSettings();
      const modeToApply = settings.defaultMode;
      const durations = getModeDurations(modeToApply, settings);
      const nextState = {
        ...state,
        modeKey: modeToApply,
        focusMinutes: durations.focusMinutes,
        breakMinutes: durations.breakMinutes,
        phase: "focus",
        remainingSeconds: durations.focusMinutes * 60,
        endTime: null,
        isLongBreak: false
      };

      await setState(nextState);
      await broadcastTimerStateChanged();
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TIMER_ALARM_NAME) {
    return;
  }

  handleTimerAlarm().catch((error) => {
    console.error("FocusGuard alarm handler error", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  (async () => {
    if (message.type === "getTimerState") {
      sendResponse({ ok: true, state: await getViewState() });
      return;
    }

    if (message.type === "startTimer") {
      if (message.config) {
        await updateTimerConfig(message.config);
      }

      const state = await startSession(message.modeKey);
      sendResponse({ ok: true, state: { ...state, modeLabel: modeLabel(state.modeKey) } });
      return;
    }

    if (message.type === "updateTimerConfig") {
      const state = await updateTimerConfig(message.config || {});
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === "pauseTimer") {
      const state = await pauseSession();
      sendResponse({ ok: true, state: { ...state, modeLabel: modeLabel(state.modeKey) } });
      return;
    }

    if (message.type === "resetTimer") {
      const state = await resetSession();
      sendResponse({ ok: true, state: { ...state, modeLabel: modeLabel(state.modeKey) } });
      return;
    }

    if (message.type === "endSession") {
      const state = await endSessionFromContent();
      sendResponse({ ok: true, state: { ...state, modeLabel: modeLabel(state.modeKey) } });
      return;
    }

    if (message.type === "isFocusActive") {
      const state = await getState();
      sendResponse({
        ok: true,
        active: state.status === "running" && state.phase === "focus",
        state: { ...state, remainingSeconds: getTimeRemainingSeconds(state) }
      });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});
