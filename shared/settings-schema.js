/**
 * Settings Schema — data-driven definition for every setting in aClicker.
 *
 * To add a new setting:
 *   1. Add a default value in shared/storage.js → SETTING_DEFAULTS
 *   2. Add an entry here with the appropriate group, type, and storageKey
 *   3. That's it — the options page renders it automatically
 *
 * @typedef {Object} SettingOption
 * @property {string} value
 * @property {string} label
 *
 * @typedef {Object} SettingSchemaEntry
 * @property {string} id - Unique identifier (matches HTML id)
 * @property {string} storageKey - chrome.storage key (usually same as id)
 * @property {string} label - User-facing label
 * @property {string} [description] - Help text shown below the control
 * @property {string} [warning] - Warning text with tooltip icon
 * @property {"toggle"|"text"|"select"|"number"|"password"|"readonly"|"editable-readonly"} type - Input widget type
 * @property {string} group - Section header this setting belongs to
 * @property {number} groupOrder - Sort order for the group (lower = higher)
 * @property {number} order - Sort order within the group
 * @property {*} default - Must match SETTING_DEFAULTS
 * @property {boolean} popup - Whether this appears in the popup's Quick Settings
 * @property {function(Object): boolean} [disabled] - Optional disable condition
 * @property {string} [disabledReason] - Text explanation when disabled
 * @property {function(Object): boolean} [visible] - Optional visibility condition
 * @property {SettingOption[]} [options] - For "select" type
 * @property {string} [placeholder] - For text/number types
 * @property {number} [min] - For number type
 * @property {number} [max] - For number type
 */

/** @type {readonly SettingSchemaEntry[]} */
const SETTINGS_SCHEMA = Object.freeze([
  /* ── Automation ──────────────────────────────────────────────────────────── */
  Object.freeze({
    id: "freeMode",
    storageKey: "freeMode",
    label: "Free Mode",
    description: "Uses a dual-model ensemble (Ling-3.0-flash & Inkling) with automated verification and fallback arbitration.",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 1,
    default: false,
    popup: true,
  }),
  Object.freeze({
    id: "effort",
    storageKey: "effort",
    label: "High-Effort Mode",
    description: "Submits initial answer immediately, validates with dual AI analysis, and invokes tiebreaker if needed. May cost up to 3× more tokens.",
    warning: "Not recommended for regular use",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 2,
    default: false,
    popup: false,
    disabled: (s) => s.freeMode === true,
    disabledReason: "Controlled by Free Mode",
  }),
  Object.freeze({
    id: "autoJoin",
    storageKey: "autoJoin",
    label: "Auto Join",
    description: "Automatically joins the next available session as soon as it appears.",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 3,
    default: true,
    popup: true,
  }),
  Object.freeze({
    id: "autoStart",
    storageKey: "autoStart",
    label: "Auto Start",
    description: "Starts answering automatically when you open an iClicker page.",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 4,
    default: true,
    popup: false,
  }),
  Object.freeze({
    id: "spoofLocation",
    storageKey: "spoofLocation",
    label: "Location Spoofing",
    description: "Overrides geolocation checks to match the instructor's reported coordinates.",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 5,
    default: false,
    popup: true,
  }),
  Object.freeze({
    id: "silentMode",
    storageKey: "silentMode",
    label: "Silent Mode",
    description: "Hide all on-screen indicators (toast & answer highlight) while the extension runs.",
    type: "toggle",
    group: "Automation",
    groupOrder: 1,
    order: 6,
    default: false,
    popup: true,
  }),

  /* ── Login ───────────────────────────────────────────────────────────────── */
  Object.freeze({
    id: "autoLogin",
    storageKey: "autoLogin",
    label: "Auto Login",
    description: "Selects your school on the login page and clicks Go automatically.",
    type: "toggle",
    group: "Login",
    groupOrder: 2,
    order: 1,
    default: true,
    popup: true,
  }),
  Object.freeze({
    id: "schoolName",
    storageKey: "schoolName",
    label: "Institution",
    description: "Your school. Visit the iClicker login page with Auto Login enabled to select.",
    type: "editable-readonly",
    group: "Login",
    groupOrder: 2,
    order: 2,
    default: "",
    placeholder: "Not set",
    popup: false,
    visible: (s) => s.autoLogin === true,
  }),

  /* ── Advanced ────────────────────────────────────────────────────────────── */
  Object.freeze({
    id: "apiKey",
    storageKey: "apiKey",
    label: "OpenRouter API Key",
    description: "Your personal OpenRouter API key.",
    type: "password",
    group: "Advanced",
    groupOrder: 3,
    order: 1,
    default: "",
    popup: false,
  }),
  Object.freeze({
    id: "modelId",
    storageKey: "modelId",
    label: "Model",
    description: "OpenRouter model ID for answering questions.",
    type: "text",
    group: "Advanced",
    groupOrder: 3,
    order: 2,
    default: "~google/gemini-flash-latest",
    placeholder: "~google/gemini-flash-latest",
    popup: false,
    disabled: (s) => s.freeMode === true,
    disabledReason: "Controlled by Free Mode",
  }),
  Object.freeze({
    id: "maxTokens",
    storageKey: "maxTokens",
    label: "Max Response Tokens",
    description: "Maximum tokens generated per completion (default: 2800). Scaled up in Free Mode.",
    type: "number",
    group: "Advanced",
    groupOrder: 3,
    order: 3,
    default: 2800,
    min: 256,
    max: 16000,
    popup: false,
    disabled: (s) => s.freeMode === true,
    disabledReason: "Controlled by Free Mode (scaled to 8000)",
  }),

  /* ── Developer ───────────────────────────────────────────────────────────── */
  Object.freeze({
    id: "debugMode",
    storageKey: "debugMode",
    label: "Debug Mode",
    description: "Log extra diagnostic info to the browser console.",
    type: "toggle",
    group: "Developer",
    groupOrder: 10,
    order: 1,
    default: false,
    popup: false,
  }),
]);

/** @type {Readonly<Record<string, SettingSchemaEntry>>|null} */
let _cachedSchemaMap = null;

/**
 * Build or retrieve cached lookup map { storageKey → schema entry }.
 * O(1) retrieval after initialization.
 * @returns {Readonly<Record<string, SettingSchemaEntry>>}
 */
function getSchemaMap() {
  if (!_cachedSchemaMap) {
    const map = {};
    for (const s of SETTINGS_SCHEMA) {
      map[s.storageKey] = s;
    }
    _cachedSchemaMap = Object.freeze(map);
  }
  return _cachedSchemaMap;
}

/** @type {ReadonlyArray<{ name: string, items: ReadonlyArray<SettingSchemaEntry> }>|null} */
let _cachedGroupedSettings = null;

/**
 * Get settings grouped by `group`, sorted by groupOrder then order.
 * Memoized for O(1) subsequent access.
 * @returns {ReadonlyArray<{ name: string, items: ReadonlyArray<SettingSchemaEntry> }>}
 */
function getGroupedSettings() {
  if (!_cachedGroupedSettings) {
    const groups = new Map();
    for (const s of SETTINGS_SCHEMA) {
      let group = groups.get(s.group);
      if (!group) {
        group = { order: s.groupOrder, items: [] };
        groups.set(s.group, group);
      }
      group.items.push(s);
    }

    _cachedGroupedSettings = Object.freeze(
      Array.from(groups.entries())
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([name, g]) =>
          Object.freeze({
            name,
            items: Object.freeze([...g.items].sort((a, b) => a.order - b.order)),
          })
        )
    );
  }

  return _cachedGroupedSettings;
}

/** @type {ReadonlyArray<SettingSchemaEntry>|null} */
let _cachedPopupSettings = null;

/**
 * Get only settings marked for popup display, sorted by groupOrder then order.
 * Memoized for O(1) subsequent access.
 * @returns {ReadonlyArray<SettingSchemaEntry>}
 */
function getPopupSettings() {
  if (!_cachedPopupSettings) {
    _cachedPopupSettings = Object.freeze(
      SETTINGS_SCHEMA.filter((s) => s.popup).sort((a, b) => {
        if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
        return a.order - b.order;
      })
    );
  }
  return _cachedPopupSettings;
}
