let overlayEl = null;
let dismissed = false;

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

function normalizeSite(input) {
  const trimmed = (input || "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const noProtocol = trimmed.replace(/^https?:\/\//, "");
  const [domainOnly] = noProtocol.split("/");
  return domainOnly.replace(/^www\./, "");
}

function isFlaggedHost(hostname, flaggedSites) {
  const host = normalizeSite(hostname);
  if (!host) {
    return false;
  }

  return flaggedSites.some((entry) => {
    const normalized = normalizeSite(entry);
    return normalized && (host === normalized || host.endsWith(`.${normalized}`));
  });
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function createOverlay() {
  if (overlayEl) {
    return overlayEl;
  }

  const wrapper = document.createElement("div");
  wrapper.id = "focusguard-overlay";
  wrapper.style.position = "fixed";
  wrapper.style.inset = "0";
  wrapper.style.zIndex = "2147483647";
  wrapper.style.background = "linear-gradient(155deg, rgba(14, 26, 18, 0.94), rgba(9, 14, 22, 0.95))";
  wrapper.style.display = "grid";
  wrapper.style.placeItems = "center";
  wrapper.style.padding = "24px";

  const panel = document.createElement("div");
  panel.style.width = "min(560px, 100%)";
  panel.style.background = "#f4f8f4";
  panel.style.borderRadius = "16px";
  panel.style.padding = "24px";
  panel.style.boxShadow = "0 20px 50px rgba(0, 0, 0, 0.28)";
  panel.style.fontFamily = "Segoe UI, Tahoma, sans-serif";
  panel.style.color = "#162316";

  const title = document.createElement("h2");
  title.textContent = "Stay Focused";
  title.style.margin = "0 0 10px";
  title.style.fontSize = "32px";

  const message = document.createElement("p");
  message.textContent = "This site is on your flagged list while a focus session is active.";
  message.style.margin = "0 0 18px";
  message.style.fontSize = "17px";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.style.border = "none";
  dismissBtn.style.padding = "10px 16px";
  dismissBtn.style.borderRadius = "10px";
  dismissBtn.style.cursor = "pointer";
  dismissBtn.style.background = "#d8dfd8";
  dismissBtn.style.color = "#162316";

  dismissBtn.addEventListener("click", () => {
    dismissed = true;
    removeOverlay();
  });

  const endSessionBtn = document.createElement("button");
  endSessionBtn.textContent = "End Session";
  endSessionBtn.style.border = "none";
  endSessionBtn.style.padding = "10px 16px";
  endSessionBtn.style.borderRadius = "10px";
  endSessionBtn.style.cursor = "pointer";
  endSessionBtn.style.background = "#155f3f";
  endSessionBtn.style.color = "#ffffff";

  endSessionBtn.addEventListener("click", async () => {
    await sendMessage({ type: "endSession" });
    dismissed = false;
    removeOverlay();
  });

  actions.appendChild(dismissBtn);
  actions.appendChild(endSessionBtn);

  panel.appendChild(title);
  panel.appendChild(message);
  panel.appendChild(actions);
  wrapper.appendChild(panel);

  overlayEl = wrapper;
  return overlayEl;
}

async function evaluateFocusOverlay() {
  const settings = await storageGet({ flaggedSites: [] });
  const flaggedSites = Array.isArray(settings.flaggedSites) ? settings.flaggedSites : [];

  const focusResponse = await sendMessage({ type: "isFocusActive" });
  const focusActive = Boolean(focusResponse && focusResponse.ok && focusResponse.active);
  const onFlaggedSite = isFlaggedHost(window.location.hostname, flaggedSites);

  if (focusActive && onFlaggedSite && !dismissed) {
    if (!overlayEl) {
      document.documentElement.appendChild(createOverlay());
    }
    return;
  }

  removeOverlay();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "timerStateChanged") {
    return;
  }

  // When timer state changes, allow overlay to reappear if focus resumes.
  dismissed = false;
  evaluateFocusOverlay();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.flaggedSites) {
    evaluateFocusOverlay();
  }
});

evaluateFocusOverlay();
