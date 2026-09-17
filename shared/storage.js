/**
 * Centralized storage layer for aClicker.
 *
 * All settings defaults live here. Every read goes through `getSettings()`
 * which fills missing keys with defaults — safe for first-run and for future
 * migrations when new settings are added.
 */

/**
 * ─── Free Mode Configuration ──────────────────────────────────────────────────
 * Free Mode runs a dual-model ensemble with cross-model fallback & tiebreaking.
 */
const FREE_MODE_MODELS = Object.freeze({
  primary: "inclusionai/ling-3.0-flash-vl:free",
  secondary: "thinkingmachines/inkling:free",
  tiebreaker: "thinkingmachines/inkling:free",
  tiebreakerFallback: "inclusionai/ling-3.0-flash-vl:free",
});

const FREE_MODE_MODEL = FREE_MODE_MODELS.primary;

/**
 * Get the current Free Mode primary model ID.
 * @returns {string}
 */
function getFreeModeModel() {
  return FREE_MODE_MODELS.primary;
}

/**
 * Get the full Free Mode models configuration object.
 * @returns {typeof FREE_MODE_MODELS}
 */
function getFreeModeModels() {
  return FREE_MODE_MODELS;
}

/** @type {Readonly<Record<string, any>>} */
const SETTING_DEFAULTS = Object.freeze({
  /* Automation */
  freeMode:      false,
  effort:        false,
  autoJoin:      true,
  autoStart:     true,
  spoofLocation: false,

  /* Login */
  autoLogin:   true,
  schoolValue: "",
  schoolName:  "",
  schoolList:  [],

  /* Advanced */
  apiKey:     "",
  modelId:    "~google/gemini-flash-latest",
  maxTokens:  2800,
  debugMode:  false,

  /* Free Mode Backup (non-destructive state) */
  freeModeBackup: null,
});

/** @type {Record<string, any>|null} */
let _pendingStorageBatch = null;

/** @type {Promise<void>|null} */
let _batchPromise = null;

const scheduleTask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

/**
 * Read one or more settings, filling missing keys with defaults.
 * Automatically accounts for any writes queued in the current tick.
 *
 * @param {string|string[]|null} [keys] Specific key(s) to read, or null/undefined for all.
 * @returns {Promise<Record<string, any>>}
 */
function getSettings(keys) {
  const isAll = keys === null || keys === undefined;
  const requested = isAll
    ? null
    : (Array.isArray(keys) ? keys : [keys]);

  const defaults = isAll
    ? { ...SETTING_DEFAULTS }
    : {};

  if (!isAll) {
    for (const k of requested) {
      if (k in SETTING_DEFAULTS) {
        defaults[k] = SETTING_DEFAULTS[k];
      }
    }
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(requested, (result) => {
        if (chrome.runtime?.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        // Merge defaults, storage result, and any in-flight pending batch
        resolve({ ...defaults, ...result, ...(_pendingStorageBatch || {}) });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Write one or more settings.
 * Successive writes scheduled in the same execution tick are coalesced into
 * a single chrome.storage.local.set call to prevent hitting Chrome storage API quotas.
 *
 * @param {Record<string, any>} patch Key-value pairs to save.
 * @returns {Promise<void>}
 */
function saveSettings(patch) {
  if (!patch || typeof patch !== "object" || Object.keys(patch).length === 0) {
    return Promise.resolve();
  }

  if (!_pendingStorageBatch) {
    _pendingStorageBatch = {};
    _batchPromise = new Promise((resolve, reject) => {
      scheduleTask(() => {
        const batch = _pendingStorageBatch;
        _pendingStorageBatch = null;
        _batchPromise = null;

        try {
          chrome.storage.local.set(batch, () => {
            const err = chrome.runtime?.lastError;
            if (err) reject(err);
            else resolve();
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  Object.assign(_pendingStorageBatch, patch);
  return _batchPromise;
}

/**
 * Listen for storage changes (thin wrapper for convenience).
 * @param {function(Record<string, { oldValue?: any, newValue?: any }>): void} callback
 */
function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") callback(changes);
  });
}

/**
 * Toggle or set Free Mode.
 * Non-destructive: preserves previous modelId and effort when enabled,
 * and restores them when disabled.
 *
 * @param {boolean} enable
 * @returns {Promise<Record<string, any>>} The saved patch
 */
async function setFreeMode(enable) {
  const current = await getSettings(["modelId", "effort", "freeMode", "freeModeBackup"]);

  if (enable) {
    // If already in free mode with a backup, don't overwrite the original backup
    const backup = (current.freeMode && current.freeModeBackup)
      ? current.freeModeBackup
      : {
          modelId: current.modelId || SETTING_DEFAULTS.modelId,
          effort: current.effort !== undefined ? current.effort : SETTING_DEFAULTS.effort,
        };

    const patch = {
      freeMode: true,
      freeModeBackup: backup,
      modelId: FREE_MODE_MODEL,
      effort: true,
    };
    await saveSettings(patch);
    return patch;
  } else {
    const backup = current.freeModeBackup;
    const restoredModel = (backup && backup.modelId) ? backup.modelId : SETTING_DEFAULTS.modelId;
    const restoredEffort = (backup && backup.effort !== undefined) ? backup.effort : SETTING_DEFAULTS.effort;

    const patch = {
      freeMode: false,
      freeModeBackup: null,
      modelId: restoredModel,
      effort: restoredEffort,
    };
    await saveSettings(patch);
    return patch;
  }
}

