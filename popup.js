/**
 * aClicker — Popup Script
 *
 * Manages extension popup UI: status indicators, start/stop actions,
 * quick toggles (driven by SETTINGS_SCHEMA), and institution auto-login selection.
 */

// ─── DOM Helper ───────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ─── DOM References ───────────────────────────────────────────────────────────

const startBtn      = $("startBtn");
const stopBtn       = $("stopBtn");
const statusDot     = $("statusDot");
const statusMsg     = $("statusMsg");
const quickSettings = $("quickSettings");
const schoolSection = $("schoolSection");
const schoolDisplay = $("schoolDisplay");
const schoolSelect  = $("schoolSelect");
const schoolLiveWrap = $("schoolLiveWrap");
const schoolStatus  = $("schoolStatus");
const openSettings  = $("openSettings");
const popup         = $("popup");

// ─── Status Configuration ─────────────────────────────────────────────────────

const STATUS_MAP = Object.freeze({
  standby:  Object.freeze({ cls: "dot--standby",  defaultMsg: "Waiting for question…" }),
  working:  Object.freeze({ cls: "dot--working",  defaultMsg: "Determining answer…" }),
  complete: Object.freeze({ cls: "dot--complete", defaultMsg: "Question answered successfully" }),
  warning:  Object.freeze({ cls: "dot--warning",  defaultMsg: "An error occurred" }),
  stopped:  Object.freeze({ cls: "dot--inactive", defaultMsg: "Extension stopped" }),
});

const ACTIVE_STATUS_SET = new Set(["standby", "working", "complete", "warning"]);
const ALL_DOT_CLASSES = Object.freeze([
  "dot--inactive",
  "dot--standby",
  "dot--working",
  "dot--complete",
  "dot--warning",
]);

// ─── Tab Context State ────────────────────────────────────────────────────────

let currentTabId = null;
let currentTabUrl = null;
let isIclickerTab = false;

function isLoginPageURL(url) {
  return typeof url === "string" && /^https:\/\/student\.iclicker\.com\/#\/login(\?.*)?$/.test(url);
}

function setStatusUI(status, message) {
  if (!statusDot || !statusMsg) return;
  const entry = STATUS_MAP[status] || {
    cls: "dot--inactive",
    defaultMsg: "Extension is disabled",
  };

  for (let i = 0; i < ALL_DOT_CLASSES.length; i++) {
    statusDot.classList.remove(ALL_DOT_CLASSES[i]);
  }
  statusDot.classList.add(entry.cls);
  statusMsg.textContent = message || entry.defaultMsg;
}

function updateButtons(status) {
  if (!startBtn || !stopBtn) return;

  if (!isIclickerTab) {
    startBtn.style.display = "block";
    stopBtn.style.display  = "none";
    startBtn.textContent   = "Open iClicker";
    startBtn.className     = "btn btn--secondary";
    startBtn.title         = "Open student.iclicker.com in a new tab";
    return;
  }

  const active = ACTIVE_STATUS_SET.has(status);
  startBtn.textContent = "Start Answering";
  startBtn.className   = "btn btn--primary";
  startBtn.removeAttribute("title");
  startBtn.style.display = active ? "none" : "block";
  stopBtn.style.display  = active ? "block" : "none";
}

// ─── Quick Settings from Schema ───────────────────────────────────────────────

function renderQuickSettings(values) {
  if (!quickSettings) return;
  const items = getPopupSettings();
  quickSettings.innerHTML = "";

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.visible && !item.visible(values)) continue;

    const row = document.createElement("div");
    row.className = "setting-row";
    row.setAttribute("data-key", item.storageKey);

    const textCol = document.createElement("div");
    textCol.className = "setting-row__text";

    const label = document.createElement("span");
    label.className = "setting-row__label";
    label.textContent = item.label;
    textCol.appendChild(label);
    row.appendChild(textCol);

    if (item.type === "toggle") {
      const toggle = document.createElement("label");
      toggle.className = "toggle";
      toggle.setAttribute("aria-label", item.label);

      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = item.id;
      input.checked = !!values[item.storageKey];

      const track = document.createElement("span");
      track.className = "toggle__track";

      toggle.appendChild(input);
      toggle.appendChild(track);
      row.appendChild(toggle);

      input.addEventListener("change", async () => {
        const val = input.checked;
        values[item.storageKey] = val;
        if (item.storageKey === "freeMode") {
          const patch = await setFreeMode(val);
          Object.assign(values, patch);
          if (isIclickerTab && currentTabId) {
            notifyContentScript("freeMode", val);
            notifyContentScript("effort", patch.effort);
          }
        } else {
          await saveSettings({ [item.storageKey]: val });
          if (isIclickerTab && currentTabId) {
            notifyContentScript(item.storageKey, val);
          }
        }

        if (item.storageKey === "autoLogin") {
          handleAutoLoginToggle(val);
        }
      });
    }

    quickSettings.appendChild(row);
  }
}

// ─── School Section Helpers ───────────────────────────────────────────────────

function showSchoolSection(show) {
  if (schoolSection) {
    schoolSection.style.display = show ? "flex" : "none";
  }
}

function showReadonlySchool() {
  if (!schoolLiveWrap || !schoolDisplay || !schoolStatus) return;
  schoolLiveWrap.style.display = "none";
  getSettings("schoolName").then((s) => {
    schoolDisplay.textContent = s.schoolName || "Not set";
    schoolStatus.textContent = s.schoolName ? "" : "Visit the login page to choose";
    schoolStatus.style.color = "";
  });
}

function showLiveSchoolSelect(tabId) {
  if (!tabId) {
    showReadonlySchool();
    return;
  }

  chrome.tabs.sendMessage(tabId, { from: "popup", msg: "getSchoolList" }, (response) => {
    if (chrome.runtime.lastError || !response?.schools) {
      showReadonlySchool();
      return;
    }
    chrome.storage.local.set({ schoolList: response.schools });
    populateSchoolDropdown(response.schools);
    if (schoolLiveWrap) schoolLiveWrap.style.display = "block";
  });
}

function populateSchoolDropdown(schools) {
  if (!schoolSelect) return;
  schoolSelect.innerHTML = '<option value="" disabled>Select an Institution</option>';

  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    schoolSelect.appendChild(opt);
  }

  getSettings("schoolValue").then((result) => {
    if (result.schoolValue) {
      schoolSelect.value = result.schoolValue;
      if (schoolSelect.selectedIndex <= 0) {
        schoolStatus.textContent = "⚠ Saved school not found";
        schoolStatus.style.color = "var(--warning-color)";
      } else {
        const name = schoolSelect.options[schoolSelect.selectedIndex].textContent.trim();
        schoolDisplay.textContent = name;
        schoolStatus.textContent = "✓ " + name;
        schoolStatus.style.color = "var(--success)";
      }
    }
  });
}

function updateSchoolUI() {
  if (isIclickerTab && isLoginPageURL(currentTabUrl)) {
    showLiveSchoolSelect(currentTabId);
  } else {
    showReadonlySchool();
  }
}

function handleAutoLoginToggle(checked) {
  showSchoolSection(checked);
  if (!checked) return;

  updateSchoolUI();

  if (isIclickerTab && currentTabId && isLoginPageURL(currentTabUrl)) {
    getSettings(["schoolValue", "schoolName"]).then((r) => {
      if (r.schoolValue || r.schoolName) {
        sendMsg(currentTabId, {
          from: "popup",
          msg: "selectSchool",
          value: r.schoolValue,
          schoolName: r.schoolName,
        });
      }
    });
  }
}

// ─── Messaging Helpers ────────────────────────────────────────────────────────

function sendMsg(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message || "";
        if (
          err.includes("Could not establish connection") ||
          err.includes("Receiving end does not exist")
        ) {
          if (chrome.scripting) {
            chrome.tabs.get(tabId, (info) => {
              if (!info?.url?.startsWith("https://student.iclicker.com")) return;
              chrome.scripting.executeScript(
                { target: { tabId }, files: ["content.js"] },
                () => {
                  if (!chrome.runtime.lastError) {
                    chrome.tabs.sendMessage(tabId, message, () => {
                      if (chrome.runtime.lastError) {
                        /* swallow retry error */
                      }
                    });
                  }
                }
              );
            });
          }
          return;
        }
        console.warn("[aClicker] sendMsg error:", err);
      }
    });
  } catch (e) {
    console.warn("[aClicker] sendMsg exception:", e);
  }
}

function notifyContentScript(key, val) {
  if (isIclickerTab && currentTabId) {
    sendMsg(currentTabId, { from: "popup", msg: key, value: val });
  }
}

// ─── Main Lifecycle & Init ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Identify active tab context
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab) {
      currentTabId = tab.id;
      currentTabUrl = tab.url || "";
      isIclickerTab = currentTabUrl.includes("student.iclicker.com");
    }
  } catch (err) {
    console.debug("[aClicker] Active tab query failed:", err);
  }

  // 2. Load all settings
  const settings = await getSettings(null);

  // 3. Render Status
  if (isIclickerTab) {
    setStatusUI(settings.status, settings.statusMessage);
  } else {
    setStatusUI("stopped", "Not on an iClicker page");
  }

  // 4. Render Action Buttons
  updateButtons(settings.status);

  // 5. Render Quick Settings
  renderQuickSettings(settings);

  // 6. Render School Section
  showSchoolSection(settings.autoLogin === true);
  if (settings.autoLogin) {
    updateSchoolUI();
  }

  // 7. Footer: "More Settings" link
  openSettings?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // 8. Action buttons event listeners
  startBtn?.addEventListener("click", () => {
    if (!isIclickerTab) {
      chrome.tabs.create({ url: "https://student.iclicker.com" });
      window.close();
      return;
    }
    if (currentTabId) {
      sendMsg(currentTabId, { from: "popup", msg: "start" });
      setStatusUI("standby", "Starting…");
      updateButtons("standby");
    }
  });

  stopBtn?.addEventListener("click", () => {
    if (currentTabId) {
      sendMsg(currentTabId, { from: "popup", msg: "stop" });
      setStatusUI("stopped", "Extension stopped.");
      updateButtons("stopped");
    }
  });

  // 9. School dropdown selection change
  schoolSelect?.addEventListener("change", async (e) => {
    const val = e.target.value;
    const lbl = e.target.options[e.target.selectedIndex].textContent.trim();
    await saveSettings({ schoolValue: val, schoolName: lbl });
    schoolDisplay.textContent = lbl;
    schoolStatus.textContent = "✓ " + lbl;
    schoolStatus.style.color = "var(--success)";

    if (isIclickerTab && isLoginPageURL(currentTabUrl)) {
      sendMsg(currentTabId, { from: "popup", msg: "selectSchool", value: val, schoolName: lbl });
    }
  });
});

// ─── Live Status & Settings Synchronization ───────────────────────────────────

onSettingsChanged((changes) => {
  if (isIclickerTab && ("status" in changes || "statusMessage" in changes)) {
    getSettings(["status", "statusMessage"]).then((r) => {
      setStatusUI(r.status, r.statusMessage);
      if ("status" in changes) updateButtons(r.status);
    });
  }

  for (const [key, change] of Object.entries(changes)) {
    const el = document.getElementById(key);
    if (el && el.type === "checkbox") {
      el.checked = !!change.newValue;
    }

    if (key === "autoLogin") {
      showSchoolSection(change.newValue === true);
      if (change.newValue === true) {
        updateSchoolUI();
      }
    }

    if (key === "schoolName") {
      if (schoolDisplay) {
        schoolDisplay.textContent = change.newValue || "—";
      }
    }

    if (key === "schoolValue") {
      if (schoolSelect) {
        schoolSelect.value = change.newValue || "";
      }
    }
  }
});