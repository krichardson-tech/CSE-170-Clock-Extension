const DEFAULT_SETTINGS = {
  defaultMode: "pomodoro25",
  customFocusMinutes: 30,
  customBreakMinutes: 10,
  flaggedSites: [],
  soundEnabled: true
};

const defaultModeEl = document.getElementById("defaultMode");
const customFocusEl = document.getElementById("customFocusMinutes");
const customBreakEl = document.getElementById("customBreakMinutes");
const soundEnabledEl = document.getElementById("soundEnabled");

const siteInputEl = document.getElementById("siteInput");
const addSiteBtn = document.getElementById("addSiteBtn");
const siteListEl = document.getElementById("siteList");
const saveBtn = document.getElementById("saveBtn");
const statusTextEl = document.getElementById("statusText");

let flaggedSites = [];

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result));
  });
}

function storageSet(payload) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(payload, () => resolve());
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

function renderSites() {
  siteListEl.innerHTML = "";

  if (!flaggedSites.length) {
    const empty = document.createElement("li");
    empty.textContent = "No flagged sites yet.";
    empty.style.color = "#5e6d79";
    siteListEl.appendChild(empty);
    return;
  }

  flaggedSites.forEach((site) => {
    const item = document.createElement("li");
    item.className = "siteItem";

    const label = document.createElement("span");
    label.textContent = site;

    const removeBtn = document.createElement("button");
    removeBtn.className = "removeBtn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      flaggedSites = flaggedSites.filter((entry) => entry !== site);
      renderSites();
    });

    item.appendChild(label);
    item.appendChild(removeBtn);
    siteListEl.appendChild(item);
  });
}

function setStatus(text) {
  statusTextEl.textContent = text;
  if (text) {
    setTimeout(() => {
      statusTextEl.textContent = "";
    }, 1800);
  }
}

addSiteBtn.addEventListener("click", () => {
  const normalized = normalizeSite(siteInputEl.value);
  if (!normalized) {
    setStatus("Enter a valid domain.");
    return;
  }

  if (flaggedSites.includes(normalized)) {
    setStatus("Domain already added.");
    return;
  }

  flaggedSites.push(normalized);
  flaggedSites = flaggedSites.sort((a, b) => a.localeCompare(b));
  siteInputEl.value = "";
  renderSites();
});

saveBtn.addEventListener("click", async () => {
  const payload = {
    defaultMode: defaultModeEl.value,
    customFocusMinutes: Math.max(1, Number(customFocusEl.value) || DEFAULT_SETTINGS.customFocusMinutes),
    customBreakMinutes: Math.max(1, Number(customBreakEl.value) || DEFAULT_SETTINGS.customBreakMinutes),
    flaggedSites,
    soundEnabled: soundEnabledEl.checked
  };

  await storageSet(payload);
  setStatus("Saved.");
});

async function init() {
  const settings = await storageGet(DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  defaultModeEl.value = merged.defaultMode;
  customFocusEl.value = merged.customFocusMinutes;
  customBreakEl.value = merged.customBreakMinutes;
  soundEnabledEl.checked = Boolean(merged.soundEnabled);

  flaggedSites = Array.isArray(merged.flaggedSites)
    ? merged.flaggedSites.map((site) => normalizeSite(site)).filter(Boolean)
    : [];

  flaggedSites = [...new Set(flaggedSites)].sort((a, b) => a.localeCompare(b));
  renderSites();
}

init();
