/**
 * aClicker — Options Page Script
 *
 * Data-driven rendering of all extension settings defined in SETTINGS_SCHEMA.
 * Uses reactive visibility updates to avoid full DOM reconstructions on change.
 */

// ─── DOM References ───────────────────────────────────────────────────────────

const container = document.getElementById("settingsContainer");
const resetBtn  = document.getElementById("resetBtn");
const verLabel  = document.getElementById("versionLabel");

// ─── Save Toast ───────────────────────────────────────────────────────────────

let toastEl = null;
let toastTimer = null;

function showSaveToast() {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "save-toast";
    toastEl.textContent = "Setting saved";
    document.body.appendChild(toastEl);
  }
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 1400);
}

// ─── Debounce Utility ─────────────────────────────────────────────────────────

/**
 * Creates a debounced function that executes after delay ms.
 * @param {function(...*): void} fn
 * @param {number} delay
 * @returns {function(...*): void}
 */
function debounce(fn, delay = 500) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

let currentSettings = {};

// ─── Reactive State Updates ───────────────────────────────────────────────────

/**
 * Update the visibility, disabled states, explanatory notes, and control values without re-creating DOM.
 * @param {Record<string, any>} currentSettings
 */
function updateDynamicState(currentSettings) {
  const schemaMap = getSchemaMap();
  const rows = container.querySelectorAll(".opt-row[data-key]");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = row.getAttribute("data-key");
    const item = schemaMap[key];
    if (!item) continue;

    // 1. Dynamic visibility
    if (item.visible) {
      const isVisible = item.visible(currentSettings);
      row.style.display = isVisible ? "flex" : "none";
    }

    // 2. Dynamic disabled state & explanatory text
    const isDisabled = item.disabled ? !!item.disabled(currentSettings) : false;
    row.classList.toggle("opt-row--disabled", isDisabled);

    // Disable all inputs/selects/buttons inside this control to prevent user editing
    const formElements = row.querySelectorAll("input, select, button");
    for (let j = 0; j < formElements.length; j++) {
      const el = formElements[j];
      el.disabled = isDisabled;
      if (el.tagName === "INPUT" && el.type === "text") {
        el.readOnly = isDisabled;
      }
    }

    // Explanatory note: e.g. "Controlled by Free Mode"
    const textCol = row.querySelector(".opt-row__text");
    let note = row.querySelector(".opt-row__managed-note");

    if (isDisabled && item.disabledReason) {
      if (!note && textCol) {
        note = document.createElement("span");
        note.className = "opt-row__managed-note";
        note.textContent = item.disabledReason;
        textCol.appendChild(note);
      } else if (note) {
        note.textContent = item.disabledReason;
        note.style.display = "inline-flex";
      }
    } else if (note) {
      note.style.display = "none";
    }

    // 3. Synchronize input values with currentSettings
    if (item.type === "toggle") {
      const toggleInput = row.querySelector("input[type='checkbox']");
      if (toggleInput && toggleInput.checked !== !!currentSettings[key]) {
        toggleInput.checked = !!currentSettings[key];
      }
    } else if (item.type === "text" || item.type === "password" || item.type === "number") {
      const textInput = row.querySelector("input.text-input");
      if (textInput && textInput.value !== (currentSettings[key] ?? "")) {
        textInput.value = currentSettings[key] ?? "";
      }
    } else if (item.type === "select") {
      const select = row.querySelector("select");
      if (select && select.value !== (currentSettings[key] ?? "")) {
        select.value = currentSettings[key] ?? "";
      }
    } else if (item.type === "readonly") {
      const span = row.querySelector(".opt-row__readonly");
      if (span) {
        span.textContent = currentSettings[key] || "—";
      }
    }
  }
}

// ─── Component Builders ───────────────────────────────────────────────────────

function createWarningIcon(warningText) {
  const warn = document.createElement("span");
  warn.className = "opt-row__warning";
  warn.setAttribute("aria-label", warningText);
  warn.setAttribute("data-tooltip", warningText);
  warn.textContent = "⚠";
  return warn;
}

function buildControlElement(item, values, onSettingChanged) {
  const control = document.createElement("div");
  control.className = "opt-row__control";

  switch (item.type) {
    case "toggle": {
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
      control.appendChild(toggle);

      input.addEventListener("change", async () => {
        const val = input.checked;
        if (item.storageKey === "freeMode") {
          const patch = await setFreeMode(val);
          Object.assign(values, patch);
          showSaveToast();
          onSettingChanged(item.storageKey, val, patch);
        } else {
          await saveSettings({ [item.storageKey]: val });
          showSaveToast();
          onSettingChanged(item.storageKey, val);
        }
      });
      break;
    }

    case "text": {
      const input = document.createElement("input");
      input.type = "text";
      input.id = item.id;
      input.className = "text-input";
      input.value = values[item.storageKey] || "";
      input.placeholder = item.placeholder || "";

      const debouncedSave = debounce(async (val) => {
        if (input.disabled || input.readOnly) return;
        await saveSettings({ [item.storageKey]: val });
        showSaveToast();
        onSettingChanged(item.storageKey, val);
      }, 500);

      input.addEventListener("input", () => {
        if (input.disabled || input.readOnly) return;
        debouncedSave(input.value);
      });
      control.appendChild(input);
      break;
    }

    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.id = item.id;
      input.className = "text-input";
      input.value = values[item.storageKey] ?? "";
      if (item.min !== undefined) input.min = String(item.min);
      if (item.max !== undefined) input.max = String(item.max);
      input.placeholder = item.placeholder || "";

      const debouncedSave = debounce(async (val) => {
        const numVal = val === "" ? item.default : Number(val);
        await saveSettings({ [item.storageKey]: isNaN(numVal) ? item.default : numVal });
        showSaveToast();
        onSettingChanged(item.storageKey, numVal);
      }, 500);

      input.addEventListener("input", () => debouncedSave(input.value));
      control.appendChild(input);
      break;
    }

    case "select": {
      const wrap = document.createElement("div");
      wrap.className = "select-wrap";

      const select = document.createElement("select");
      select.id = item.id;
      select.className = "select-input";

      if (item.options) {
        for (let i = 0; i < item.options.length; i++) {
          const opt = item.options[i];
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          select.appendChild(o);
        }
      }
      select.value = values[item.storageKey] || "";

      select.addEventListener("change", async () => {
        await saveSettings({ [item.storageKey]: select.value });
        showSaveToast();
        onSettingChanged(item.storageKey, select.value);
      });

      wrap.appendChild(select);
      control.appendChild(wrap);
      break;
    }

    case "readonly": {
      const span = document.createElement("span");
      span.className = "opt-row__readonly";
      span.textContent = values[item.storageKey] || "—";
      control.appendChild(span);
      break;
    }

    case "password": {
      const input = document.createElement("input");
      input.type = "password";
      input.id = item.id;
      input.className = "text-input";
      input.value = values[item.storageKey] || "";
      input.autocomplete = "off";

      const debouncedSave = debounce(async (val) => {
        await saveSettings({ [item.storageKey]: val });
        showSaveToast();
        onSettingChanged(item.storageKey, val);
      }, 500);

      input.addEventListener("input", () => debouncedSave(input.value));
      control.appendChild(input);
      break;
    }

    case "editable-readonly": {
      const wrap = document.createElement("div");
      wrap.className = "opt-row__editable";

      const input = document.createElement("input");
      input.type = "text";
      input.id = item.id;
      input.className = "text-input";
      input.value = values[item.storageKey] || "";
      input.placeholder = item.placeholder || "";
      input.disabled = true;

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "opt-row__edit-btn";
      editBtn.setAttribute("aria-label", "Edit");
      editBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';

      const commitEdit = async () => {
        input.disabled = true;
        await saveSettings({ [item.storageKey]: input.value });
        showSaveToast();
        onSettingChanged(item.storageKey, input.value);
      };

      editBtn.addEventListener("click", () => {
        if (input.disabled) {
          input.disabled = false;
          input.focus();
          input.select();
        } else {
          commitEdit();
        }
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitEdit();
        }
      });

      input.addEventListener("blur", () => {
        setTimeout(() => {
          if (!input.disabled) commitEdit();
        }, 150);
      });

      wrap.appendChild(input);
      wrap.appendChild(editBtn);
      control.appendChild(wrap);
      break;
    }

    default:
      break;
  }

  return control;
}

// ─── Render Engine ────────────────────────────────────────────────────────────

async function renderSettings() {
  const loaded = await getSettings(null);
  Object.assign(currentSettings, loaded);
  const groups = getGroupedSettings();

  container.innerHTML = "";

  const onSettingChanged = (key, val, patch) => {
    currentSettings[key] = val;
    if (patch) {
      Object.assign(currentSettings, patch);
    }
    updateDynamicState(currentSettings);
  };

  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx];
    const section = document.createElement("section");
    section.className = "settings-group";

    const heading = document.createElement("h2");
    heading.className = "settings-group__heading";
    heading.textContent = group.name;
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "settings-group__list";

    for (let iIdx = 0; iIdx < group.items.length; iIdx++) {
      const item = group.items[iIdx];
      const row = document.createElement("div");
      row.className = "opt-row";
      row.setAttribute("data-key", item.storageKey);

      // Check initial visibility
      if (item.visible && !item.visible(currentSettings)) {
        row.style.display = "none";
      }

      // Text column
      const textCol = document.createElement("div");
      textCol.className = "opt-row__text";

      const label = document.createElement("span");
      label.className = "opt-row__label";
      label.textContent = item.label;

      if (item.warning) {
        label.appendChild(createWarningIcon(item.warning));
      }
      textCol.appendChild(label);

      if (item.description) {
        const desc = document.createElement("span");
        desc.className = "opt-row__desc";
        desc.textContent = item.description;
        textCol.appendChild(desc);
      }
      row.appendChild(textCol);

      // Control column
      const control = buildControlElement(item, currentSettings, onSettingChanged);
      row.appendChild(control);

      list.appendChild(row);
    }

    section.appendChild(list);
    container.appendChild(section);
  }

  updateDynamicState(currentSettings);
}

// ─── Reset Button ─────────────────────────────────────────────────────────────

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset all settings to their defaults? This cannot be undone.")) {
    return;
  }
  await saveSettings({ ...SETTING_DEFAULTS });
  await renderSettings();
  showSaveToast();
});

// ─── Version Label ────────────────────────────────────────────────────────────

try {
  const manifest = chrome.runtime.getManifest();
  if (manifest?.version) {
    verLabel.textContent = `v${manifest.version}`;
  }
} catch {
  // Ignored in non-extension environments
}

// ─── Init ─────────────────────────────────────────────────────────────────────

renderSettings();

// Listen for external settings changes (e.g. from popup)
onSettingsChanged(async () => {
  const latest = await getSettings(null);
  Object.assign(currentSettings, latest);
  updateDynamicState(currentSettings);
});
