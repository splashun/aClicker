/**
 * aClicker — Content Script (Isolated World)
 *
 * Runs on https://student.iclicker.com/* to monitor active polls,
 * extract question images, obtain answers via LLM Arena, and submit choices.
 */

(function () {
  "use strict";

  if (window.__aclicker_content_initialized) return;
  window.__aclicker_content_initialized = true;

// ─── Constants ────────────────────────────────────────────────────────────────

const OBSERVER_CONFIG = Object.freeze({
  attributes: true,
  attributeFilter: ["aria-hidden"],
  childList: true,
  subtree: true,
});

const ICLICKER_CLASS_URL = "https://student.iclicker.com/#/class/";
const ICLICKER_COURSE_URL = "https://student.iclicker.com/#/course";
const ICLICKER_LOGIN_URL = "https://student.iclicker.com/#/login";
const ALLOWED_PATHS = Object.freeze([
  "/overview",
  "/class-history",
  "/assignments",
  "/study-tools",
]);

// ─── Global State ─────────────────────────────────────────────────────────────

let observer = null;
let autoJoin = false;
let effort = false;
let freeMode = false;
let debugMode = false;
let autoLogin = false;
let autoStart = true;
let spoofLocation = false;
let localPrevPage = null;
let isAnswering = false;
let lastAnsweredImageSrc = null;

// ─── Location Spoofing Helper ─────────────────────────────────────────────────

function updateLocationSpoofing(enabled) {
  if (document.documentElement) {
    document.documentElement.dataset.aclickerSpoof = enabled ? "true" : "false";
  }
  window.postMessage({ type: "ACLICKER_SET_SPOOF_LOCATION", enabled }, "*");
}

function ensureSpoofScriptInjected() {
  // In MV3, location-spoof.js is already declared in manifest.json with world: "MAIN".
  // Injecting a DOM script tag triggers page CSP violations, so we rely on manifest injection.
}

// ─── Page State Tracking ──────────────────────────────────────────────────────

function setPrevPage(page) {
  if (localPrevPage !== page) {
    localPrevPage = page;
    chrome.storage.local.set({ prevPage: page });
  }
}

// ─── In-Page Toast Notification System ────────────────────────────────────────

const ToastManager = (() => {
  let toastContainer = null;
  let toastDot = null;
  let toastMsg = null;
  let toastTimer = null;
  const TERMINAL_STATUSES = new Set(["complete", "stopped", "warning"]);

  function injectToastDOM() {
    if (toastContainer && document.body.contains(toastContainer)) return;

    // 1. Inject scoped styles once
    if (!document.getElementById("aclicker-toast-style")) {
      const style = document.createElement("style");
      style.id = "aclicker-toast-style";
      style.textContent = `
        #aclicker-toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          background: #111622;
          border: 1px solid #232b3a;
          border-radius: 14px;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.03);
          color: #eef2f7;
          font-family: Inter, "Plus Jakarta Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          transform: translateY(150%);
          opacity: 0;
          transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
          pointer-events: none;
        }
        #aclicker-toast-container.aclicker-toast-visible {
          transform: translateY(0);
          opacity: 1;
        }
        .aclicker-toast-logo {
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
          background: #0f1521;
          border: 1px solid #2d3749;
          border-radius: 6px;
          color: #6b8cff;
          font-size: 12px;
          font-weight: 800;
        }
        .aclicker-toast-text {
          font-size: 13px;
          font-weight: 500;
          line-height: 1.2;
        }
        .aclicker-toast-dot {
          font-size: 18px;
          line-height: 0;
          display: inline-block;
          transform: translateY(1.5px);
          margin-right: 4px;
        }
        .aclicker-status--standby  { color: #6b8cff; text-shadow: 0 0 6px rgba(107, 140, 255, 0.95), 0 0 20px rgba(107, 140, 255, 0.60); }
        .aclicker-status--working  { color: #f0de39; animation: aclicker-pulse 1.5s infinite; }
        .aclicker-status--complete { color: #16a34a; text-shadow: 0 0 6px rgba(22, 163, 74, 0.96), 0 0 18px rgba(22, 163, 74, 0.65); }
        .aclicker-status--warning  { color: #dc2626; text-shadow: 0 0 6px rgba(220, 38, 38, 0.98), 0 0 20px rgba(220, 38, 38, 0.68); }
        .aclicker-status--stopped  { color: #6b7280; text-shadow: none; }
        .aclicker-selected-option  {
          outline: 3px solid #16a34a !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 12px rgba(22, 163, 74, 0.75) !important;
        }
        @keyframes aclicker-pulse {
          0%   { text-shadow: 0 0 0px rgba(210, 217, 6, 1); }
          45%  { text-shadow: 0 0 10px rgba(210, 217, 6, 1), 0 0 15px rgba(210, 217, 6, 0.5); }
          100% { text-shadow: 0 0 10px rgba(210, 217, 6, 0), 0 0 20px rgba(210, 217, 6, 0); }
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    // 2. Inject DOM container
    toastContainer = document.createElement("div");
    toastContainer.id = "aclicker-toast-container";
    toastContainer.innerHTML = `
      <div class="aclicker-toast-logo">A</div>
      <div class="aclicker-toast-text">
        <span id="aclicker-toast-dot" class="aclicker-toast-dot">•</span>
        <span id="aclicker-toast-msg">Starting...</span>
      </div>
    `;
    (document.body || document.documentElement).appendChild(toastContainer);

    toastDot = toastContainer.querySelector("#aclicker-toast-dot");
    toastMsg = toastContainer.querySelector("#aclicker-toast-msg");
  }

  return {
    show(status, message) {
      injectToastDOM();
      if (!toastContainer || !toastDot || !toastMsg) return;

      toastMsg.textContent = message;
      toastDot.className = `aclicker-toast-dot aclicker-status--${status}`;
      toastContainer.classList.add("aclicker-toast-visible");

      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }

      if (TERMINAL_STATUSES.has(status)) {
        toastTimer = setTimeout(() => {
          toastContainer?.classList.remove("aclicker-toast-visible");
        }, 4500);
      }
    },
  };
})();

let lastRecordedStatus = null;
let lastRecordedMessage = null;

function setStatus(status, message) {
  // Sync to chrome storage only when values change
  if (status !== lastRecordedStatus || message !== lastRecordedMessage) {
    lastRecordedStatus = status;
    lastRecordedMessage = message;
    chrome.storage.local.set({ status, statusMessage: message });
  }

  // Update in-page visual toast
  ToastManager.show(status, message);
}

// ─── Asynchronous DOM Wait Helpers ────────────────────────────────────────────

/**
 * Poll for an element to appear in the DOM.
 * @param {string} selector
 * @param {number} [maxAttempts=100]
 * @param {number} [interval=100]
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, maxAttempts = 100, interval = 100) {
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }
      if (++attempts < maxAttempts) {
        setTimeout(poll, interval);
      } else {
        resolve(null);
      }
    };
    poll();
  });
}

function waitForWrapper(callback) {
  waitForElement("#wrapper").then((wrapper) => {
    if (wrapper) {
      callback();
    } else {
      console.warn("[aClicker] Auto-start: #wrapper never appeared, giving up.");
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initContent() {
  ensureSpoofScriptInjected();
  chrome.storage.local.remove(["status", "statusMessage", "prevPage"]);
  localPrevPage = null;

  const fetchSettings = typeof getSettings === "function"
    ? getSettings(["autoJoin", "effort", "autoStart", "autoLogin", "schoolValue", "schoolName", "spoofLocation", "freeMode", "debugMode"])
    : new Promise((resolve) => {
        chrome.storage.local.get(
          ["autoJoin", "effort", "autoStart", "autoLogin", "schoolValue", "schoolName", "spoofLocation", "freeMode", "debugMode"],
          (result) => {
            resolve({
              autoJoin: result.autoJoin !== false,
              effort: result.effort === true,
              freeMode: result.freeMode === true,
              debugMode: result.debugMode === true,
              autoLogin: result.autoLogin !== false,
              autoStart: result.autoStart !== false,
              spoofLocation: result.spoofLocation === true,
              schoolValue: result.schoolValue || "",
              schoolName: result.schoolName || "",
            });
          }
        );
      });

  fetchSettings.then((result) => {
    autoJoin = result.autoJoin !== false;
    effort = result.effort === true;
    freeMode = result.freeMode === true;
    debugMode = result.debugMode === true;
    autoLogin = result.autoLogin !== false;
    autoStart = result.autoStart !== false;
    spoofLocation = result.spoofLocation === true;

    updateLocationSpoofing(spoofLocation);
    if (!observer) {
      observer = new MutationObserver(handleMutations);
    }

    if (autoStart) {
      waitForWrapper(startObserver);
    }

    if (autoLogin && (result.schoolValue || result.schoolName)) {
      tryAutoLogin(result.schoolValue, result.schoolName);
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initContent);
} else {
  initContent();
}

// ─── Auto-Login Helpers ───────────────────────────────────────────────────────

function isLoginPage(url = (typeof window !== "undefined" ? window.location.href : "")) {
  if (typeof url === "string") {
    if (/^https:\/\/student\.iclicker\.com\/#\/login(\?.*)?$/.test(url)) {
      return true;
    }
  }
  if (typeof window !== "undefined" && (!url || url === window.location.href)) {
    if (typeof document !== "undefined" && (document.querySelector("#federationList") || document.querySelector("app-login"))) {
      return true;
    }
  }
  return false;
}

function countRealOptions(dropdown) {
  if (!dropdown?.options) return 0;
  let count = 0;
  for (let i = 0; i < dropdown.options.length; i++) {
    const opt = dropdown.options[i];
    if (opt.value && !opt.disabled) count++;
  }
  return count;
}

/**
 * Locate the target school option within a <select> element using multiple fallback strategies:
 * 1. Exact value match
 * 2. GUID / UUID matching (immune to Angular's option index prefix shifts like "22:" vs "23:")
 * 3. Exact school name match (case-insensitive)
 * 4. Substring school name match (case-insensitive)
 *
 * @param {HTMLSelectElement} dropdown
 * @param {string} [schoolValue]
 * @param {string} [schoolName]
 * @returns {{ index: number, option: HTMLOptionElement } | null}
 */
function findSchoolOption(dropdown, schoolValue, schoolName) {
  if (!dropdown?.options || dropdown.options.length === 0) return null;

  const guidMatch = (schoolValue || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const targetGuid = guidMatch ? guidMatch[0].toLowerCase() : null;
  const targetName = (schoolName || "").trim().toLowerCase();
  const targetVal = (schoolValue || "").trim().toLowerCase();

  for (let i = 0; i < dropdown.options.length; i++) {
    const opt = dropdown.options[i];
    if (!opt.value || opt.disabled) continue;

    const optVal = opt.value.trim().toLowerCase();
    const optText = opt.textContent.trim().toLowerCase();

    // 1. Exact value match
    if (targetVal && optVal === targetVal) {
      return { index: i, option: opt };
    }
    // 2. GUID match
    if (targetGuid && optVal.includes(targetGuid)) {
      return { index: i, option: opt };
    }
    // 3. Exact name match
    if (targetName && optText === targetName) {
      return { index: i, option: opt };
    }
    // 4. Substring name match
    if (targetName && (optText.includes(targetName) || targetName.includes(optText))) {
      return { index: i, option: opt };
    }
  }

  return null;
}

/**
 * Ensure the #federationList select exists, is attached to the DOM,
 * and has its institution options populated.
 * Re-queries document.querySelector each poll to avoid holding stale detached references.
 *
 * @param {string|Function} [schoolValueOrCallback]
 * @param {string} [schoolName]
 * @returns {Promise<HTMLSelectElement|null>}
 */
function ensureFederationListReady(schoolValueOrCallback, schoolName) {
  const callback = typeof schoolValueOrCallback === "function" ? schoolValueOrCallback : null;
  const schoolValue = typeof schoolValueOrCallback === "string" ? schoolValueOrCallback : null;

  const promise = new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 200; // 20s
    let lastNudge = 0;

    const poll = () => {
      const dropdown = document.querySelector("#federationList");

      if (dropdown) {
        const realCount = countRealOptions(dropdown);

        // If target school is specified, resolve as soon as target option is found
        if (schoolValue || schoolName) {
          const match = findSchoolOption(dropdown, schoolValue, schoolName);
          if (match) {
            dropdown.blur();
            resolve(dropdown);
            return;
          }
        }

        // If options are populated and no specific school needed
        if (realCount > 0 && !schoolValue && !schoolName) {
          dropdown.blur();
          resolve(dropdown);
          return;
        }

        // If dropdown exists but options are empty, periodically nudge Angular
        const now = Date.now();
        if (realCount === 0 && now - lastNudge > 1000) {
          lastNudge = now;
          console.log("[aClicker] Federation list empty, nudging Angular…");
          try {
            dropdown.focus();
            dropdown.click();
            dropdown.dispatchEvent(new Event("focus", { bubbles: true }));
            dropdown.dispatchEvent(new Event("mousedown", { bubbles: true }));
            dropdown.scrollIntoView({ behavior: "instant", block: "center" });
          } catch {}
        }
      }

      if (++attempts < maxAttempts) {
        setTimeout(poll, 100);
      } else {
        const finalDropdown = document.querySelector("#federationList");
        if (finalDropdown) finalDropdown.blur();
        if (finalDropdown && countRealOptions(finalDropdown) > 0) {
          resolve(finalDropdown);
        } else {
          console.warn("[aClicker] Federation list options never populated.");
          resolve(finalDropdown || null);
        }
      }
    };

    poll();
  });

  if (callback) {
    promise.then(callback);
  }
  return promise;
}

/**
 * Click the Go button once Angular has enabled it.
 * @param {HTMLSelectElement} dropdown
 * @returns {Promise<boolean>}
 */
function clickGoButton(dropdown) {
  const findButton = () => {
    return (
      dropdown.closest(".institution-redirect")?.querySelector("button") ||
      document.querySelector(".institution-redirect button")
    );
  };

  const isEnabled = (btn) => {
    if (!btn) return false;
    return (
      !btn.classList.contains("disabled") &&
      btn.getAttribute("aria-disabled") !== "true" &&
      !btn.disabled
    );
  };

  let attempts = 0;
  const maxAttempts = 40; // 40 * 50ms = 2s

  return new Promise((resolve) => {
    const poll = () => {
      const btn = findButton();
      if (!btn) {
        if (++attempts < maxAttempts) {
          setTimeout(poll, 50);
        } else {
          console.warn("[aClicker] Auto-login: Go button not found.");
          resolve(false);
        }
        return;
      }

      if (isEnabled(btn)) {
        btn.click();
        console.log("[aClicker] Auto-login: selected school and clicked Go.");
        resolve(true);
        return;
      }

      // If still disabled after 500ms (10 attempts), re-dispatch events to nudge Angular
      if (attempts === 10) {
        dropdown.dispatchEvent(new Event("input", { bubbles: true }));
        dropdown.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (++attempts < maxAttempts) {
        setTimeout(poll, 50);
      } else {
        // Fallback: forcefully remove disabled classes and click
        btn.classList.remove("disabled");
        btn.removeAttribute("aria-disabled");
        btn.click();
        console.log("[aClicker] Auto-login: selected school and clicked Go (fallback).");
        resolve(true);
      }
    };

    poll();
  });
}

let isLoggingIn = false;

async function tryAutoLogin(schoolValue, schoolName) {
  if (!isLoginPage()) return;
  if (isLoggingIn) return;
  isLoggingIn = true;

  try {
    if (!schoolValue || !schoolName) {
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(["schoolValue", "schoolName", "autoLogin"], resolve);
      });
      if (stored.autoLogin === false) {
        isLoggingIn = false;
        return;
      }
      schoolValue = schoolValue || stored.schoolValue;
      schoolName = schoolName || stored.schoolName;
    }

    if (!schoolValue && !schoolName) {
      console.log("[aClicker] Auto-login: No school configured.");
      isLoggingIn = false;
      return;
    }

    const dropdown = await ensureFederationListReady(schoolValue, schoolName);
    if (!dropdown) {
      console.warn("[aClicker] Auto-login: Federation dropdown not available.");
      isLoggingIn = false;
      return;
    }

    // Always re-query live element from DOM
    const liveDropdown = document.querySelector("#federationList") || dropdown;
    const match = findSchoolOption(liveDropdown, schoolValue, schoolName);
    if (!match) {
      console.warn("[aClicker] Auto-login: Saved school not found in dropdown options.", { schoolValue, schoolName });
      isLoggingIn = false;
      return;
    }

    liveDropdown.selectedIndex = match.index;
    liveDropdown.value = match.option.value;

    liveDropdown.dispatchEvent(new Event("focus", { bubbles: true }));
    liveDropdown.dispatchEvent(new Event("input", { bubbles: true }));
    liveDropdown.dispatchEvent(new Event("change", { bubbles: true }));
    liveDropdown.dispatchEvent(new Event("blur", { bubbles: true }));

    console.log(`[aClicker] Auto-login: selected "${match.option.textContent.trim()}" (value: "${match.option.value}").`);

    await clickGoButton(liveDropdown);
  } catch (err) {
    console.error("[aClicker] Auto-login error:", err);
  } finally {
    setTimeout(() => {
      isLoggingIn = false;
    }, 4000);
  }
}

function checkAutoLogin() {
  if (!isLoginPage()) return;

  chrome.storage.local.get(["autoLogin", "schoolValue", "schoolName"], (res) => {
    if (res?.autoLogin !== false && (res?.schoolValue || res?.schoolName)) {
      tryAutoLogin(res.schoolValue, res.schoolName);
    }
  });
}

function getSchoolListFromDOM() {
  const dropdown = document.querySelector("#federationList");
  if (!dropdown) return [];

  const schools = [];
  for (let i = 0; i < dropdown.options.length; i++) {
    const opt = dropdown.options[i];
    if (opt.value && !opt.disabled) {
      schools.push({ value: opt.value, label: opt.textContent.trim() });
    }
  }
  return schools;
}

// ─── Mutation Handler ─────────────────────────────────────────────────────────

function handleMutations(mutationsList) {
  const url = window.location.href;

  for (let i = 0; i < mutationsList.length; i++) {
    const mutation = mutationsList[i];
    if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
      handleChildListMutation(mutation, url);
    } else if (
      mutation.type === "attributes" &&
      mutation.attributeName === "aria-hidden"
    ) {
      handleAttributeMutation(url);
    }
  }
}

function handleChildListMutation(mutation, url) {
  if (isLoginPage(url) && autoLogin) {
    for (let i = 0; i < mutation.addedNodes.length; i++) {
      const node = mutation.addedNodes[i];
      if (node instanceof Element) {
        if (node.matches("#federationList, app-login") || node.querySelector?.("#federationList, app-login")) {
          checkAutoLogin();
          return;
        }
      }
    }
  }

  if (!url.includes(ICLICKER_CLASS_URL) || !url.includes("/poll")) return;

  setPrevPage("poll");

  for (let i = 0; i < mutation.addedNodes.length; i++) {
    const node = mutation.addedNodes[i];
    if (node instanceof Element) {
      if (node.matches(".question-type-container") || node.querySelector?.(".question-type-container")) {
        checkAnswer();
        break;
      }
    }
  }
}

function handleAttributeMutation(url) {
  const activePage =
    url.includes(ICLICKER_COURSE_URL) &&
    ALLOWED_PATHS.some((path) => url.includes(path));

  if (!activePage) return;

  if (localPrevPage === "poll") {
    stopObserver("default");
    return;
  }

  if (!autoJoin) return;

  const joinContainer = document.querySelector(".course-join-container");
  if (joinContainer?.classList.contains("expanded")) {
    document.querySelector("#btnJoin")?.click();
  }
}

// ─── AI Answering & LM Arena ──────────────────────────────────────────────────

const FREE_MODE_MODELS = Object.freeze({
  primary: "inclusionai/ling-3.0-flash-vl:free",
  secondary: "thinkingmachines/inkling:free",
  tiebreaker: "thinkingmachines/inkling:free",
  tiebreakerFallback: "inclusionai/ling-3.0-flash-vl:free",
});

function normalizeModelId(id) {
  if (typeof id !== "string") return id;
  return id.replace(/^https?:\/\/openrouter\.ai\//i, "").trim();
}

const RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  json_schema: {
    name: "multiple_choice_solution",
    strict: true,
    schema: {
      type: "object",
      properties: {
        thinking: {
          type: "string",
          description:
            "Step-by-step reasoning: analyze question, evaluate options, check traps, and deduce correct answer",
        },
        ans: {
          type: "string",
          pattern: "^[A-Z]$",
          description: "Single uppercase letter of the correct option",
        },
      },
      required: ["thinking", "ans"],
      additionalProperties: false,
    },
  },
});

// Tool definition sent with free-model requests to satisfy OpenRouter's
// "agentic harness" gate for models like thinkingmachines/inkling:free.
// If the model calls this tool, its arguments contain the structured answer.
const AGENTIC_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "submit_answer",
    description:
      "Submit the answer to a multiple-choice question after analyzing the image. " +
      "You MUST call this tool with your reasoning and the correct answer letter.",
    parameters: {
      type: "object",
      properties: {
        thinking: {
          type: "string",
          description:
            "Step-by-step reasoning: analyze question, evaluate options, check traps, and deduce correct answer",
        },
        ans: {
          type: "string",
          description: "Single uppercase letter of the correct option (A, B, C, D, E, etc.)",
        },
      },
      required: ["thinking", "ans"],
    },
  },
});

const SYSTEM_PROMPT =
  "You are an expert academic tutor and competitive exam solver specializing in multiple-choice questions. " +
  "Carefully inspect the question text, diagrams, formulas, units, and all available choices in the image.\n\n" +
  "CRITICAL FORMAT INSTRUCTIONS:\n" +
  "You MUST return your response as a valid JSON object in the following format:\n" +
  "```json\n" +
  "{\n" +
  '  "thinking": "Step-by-step reasoning: analyze question, evaluate options, check traps, and deduce correct answer",\n' +
  '  "ans": "A"\n' +
  "}\n" +
  "```\n" +
  "The 'ans' field MUST contain strictly a single uppercase letter (A, B, C, D, E, etc.) corresponding to the correct option. " +
  "If you cannot output valid JSON, end your response on its own line with: Answer: X (where X is the single capital letter).";

const PROMPT_DERIVATION =
  "Solve the multiple-choice question in the attached image using direct first-principles derivation:\n" +
  "1. Read the question, diagrams, formulas, and constraints carefully.\n" +
  "2. Work out the solution directly from first principles.\n" +
  "3. Match your derived solution to the corresponding option letter.\n" +
  "4. Verify that your answer satisfies all requirements.\n" +
  "If the image is partially degraded, deduce the most plausible reading.\n\n" +
  "FORMAT REQUIREMENT: You must respond in valid JSON format:\n" +
  '{"thinking": "<derivation steps>", "ans": "<single uppercase letter A-Z>"}\n' +
  "State your reasoning in 'thinking' and only the correct letter option in 'ans'.";

const PROMPT_ELIMINATION =
  "Solve the multiple-choice question in the attached image using critical elimination and verification:\n" +
  "1. Examine each choice individually against the question requirements.\n" +
  "2. Identify distractors, sign errors, common misconceptions, or trick options and eliminate them.\n" +
  "3. Test the remaining option(s) to verify why it must be the only logically and factually sound answer.\n" +
  "4. Select the surviving correct option letter.\n" +
  "If the image is partially degraded, deduce the most plausible reading.\n\n" +
  "FORMAT REQUIREMENT: You must respond in valid JSON format:\n" +
  '{"thinking": "<elimination steps>", "ans": "<single uppercase letter A-Z>"}\n' +
  "State your reasoning in 'thinking' and only the correct letter option in 'ans'.";

function makeTiebreakerPrompt(a1, a2) {
  return (
    `Two independent analytical approaches arrived at conflicting answers for this multiple-choice question: ` +
    `Option ${a1 ?? "?"} vs Option ${a2 ?? "?"}.\n\n` +
    `Carefully re-examine the attached question image and adjudicate between these options:\n` +
    `1. Analyze Option ${a1 ?? "?"}: evaluate what reasoning leads to it, and check for calculation errors, misreadings, or traps.\n` +
    `2. Analyze Option ${a2 ?? "?"}: evaluate what reasoning leads to it, and check for calculation errors, misreadings, or traps.\n` +
    `3. Compare both candidates directly against the question text, formulas, and visual details.\n` +
    `4. Conclusively determine which option is correct. If both are flawed, choose the genuinely correct option from the image.\n\n` +
    `FORMAT REQUIREMENT: You must respond in valid JSON format:\n` +
    `{"thinking": "<comparative adjudication>", "ans": "<single uppercase letter A-Z>"}\n` +
    `State your comparative analysis in 'thinking' and the definitive option letter in 'ans'.`
  );
}

function parseAnswer(data) {
  // If model returned a tool call (e.g. submit_answer), parse arguments
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      const args =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      const ans = args?.ans?.toUpperCase();
      if (/^[A-Z]$/.test(ans)) return ans;
    } catch {
      // Proceed to content parsing
    }
  }

  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;

  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    const ans = parsed?.ans?.toUpperCase();
    if (/^[A-Z]$/.test(ans)) return ans;
  } catch {
    // Proceed to regex extractors
  }

  // Robust pattern extraction for varied model outputs (including markdown bolding)
  const patterns = [
    /"ans"\s*:\s*"([A-Za-z])"/,
    /(?:\b(?:final|correct)?\s*\b(?:choice|option|answer)\b\s*(?:is|would\s+be)?\s*[:=*_]*\s*)[*_]*\(?([A-Za-z])\)?(?![a-zA-Z])/i,
    /\b(?:option|choice)\b\s+[*_]*\(?([A-Za-z])\)?(?![a-zA-Z])(?:\s+is\s+correct)?/i,
    /^\s*[*_]*\(?([A-Za-z])\)?[.:*_]?\s*$/,
  ];

  for (const pat of patterns) {
    const match = raw.match(pat);
    if (match) {
      const letter = match[1].toUpperCase();
      if (/^[A-Z]$/.test(letter)) return letter;
    }
  }

  return null;
}

function evaluateDualSettlement(firstAnswer, secondAnswer) {
  if (!firstAnswer && !secondAnswer) {
    return { action: "fail", currentSelected: null };
  }
  if (!firstAnswer && secondAnswer) {
    return { action: "fallback", currentSelected: secondAnswer };
  }
  if (firstAnswer && !secondAnswer) {
    return { action: "fallback", currentSelected: firstAnswer };
  }
  if (firstAnswer === secondAnswer) {
    return { action: "consensus", currentSelected: firstAnswer };
  }
  return { action: "tiebreak", currentSelected: firstAnswer, promptTiebreaker: true };
}

function evaluateTiebreakerDecision(currentSelected, tiebreakerAnswer) {
  if (tiebreakerAnswer && tiebreakerAnswer !== currentSelected) {
    return { shouldUpdate: true, finalAnswer: tiebreakerAnswer };
  }
  return { shouldUpdate: false, finalAnswer: currentSelected };
}

function selectAnswer(letter) {
  if (!letter || !/^[A-Z]$/.test(letter)) return false;
  const btn = document.getElementById(`multiple-choice-${letter.toLowerCase()}`);
  if (btn) {
    btn.click();
    console.log(`[aClicker] Clicked option ${letter}`);
    try {
      document.querySelectorAll(".aclicker-selected-option").forEach((el) => {
        el.classList.remove("aclicker-selected-option");
      });
      btn.classList.add("aclicker-selected-option");
    } catch {}
    return true;
  }
  console.warn(`[aClicker] Button for option ${letter} not found.`);
  return false;
}

/**
 * Helper to dispatch OpenRouter completion request to background service worker.
 */
function sendCompletionToBackground(payload, apiKey) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: "OPENROUTER_CHAT_COMPLETION", payload, apiKey },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Background unavailable"));
            return;
          }
          if (!res) {
            reject(new Error("No response from background proxy"));
            return;
          }
          resolve(res);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Send the image + prompt to OpenRouter.
 */
async function callAPI({
  prompt,
  temperature = 0.5,
  encodedImage,
  apiKey,
  modelId,
  maxTokens = 2800,
  timeoutMs = 20000,
  debug = false,
}) {
  const isDebug = (typeof debug === "boolean" ? debug : false) || debugMode;
  const cleanModel = normalizeModelId(modelId);
  const isFreeModel = typeof cleanModel === "string" && cleanModel.endsWith(":free");
  const isAgenticModel = typeof cleanModel === "string" && cleanModel.includes("inkling");
  const effectiveMaxTokens = (isFreeModel || freeMode) && maxTokens === 2800 ? 8000 : maxTokens;

  const payload = {
    model: cleanModel,
    max_tokens: effectiveMaxTokens,
    temperature,
    stream: false,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: encodedImage } },
        ],
      },
    ],
  };

  // Free-tier endpoints don't advertise response_format / structured_outputs,
  // so require_parameters + response_format would leave zero routable endpoints (404).
  // For free models we rely on the system prompt's JSON instructions instead.
  // Including tools satisfies OpenRouter's "agentic harness" gate for models
  // like thinkingmachines/inkling:free that are restricted to agentic callers.
  // Other free models (e.g. Ling-3.0-flash-vl) do not support tools and fail if included.
  if (!isFreeModel) {
    payload.provider = { require_parameters: true };
    payload.response_format = RESPONSE_FORMAT;
    payload.reasoning = { effort: "high" };
  } else if (isAgenticModel) {
    payload.tools = [AGENTIC_TOOL];
  }

  let status = 200;

  const tryRequest = async (currentPayload) => {
    try {
      const bgRes = await sendCompletionToBackground(currentPayload, apiKey);
      if (bgRes.ok) {
        return bgRes.data;
      }
      status = bgRes.status;
      console.error(
        `[aClicker] API error ${bgRes.status}:`,
        bgRes.data ?? "(no response body)"
      );
      const apiErrMsg = bgRes.data?.error?.message || bgRes.data?.error || JSON.stringify(bgRes.data);
      throw new Error(`API error ${bgRes.status}: ${apiErrMsg}`);
    } catch (bgErr) {
      if (status !== 200 && status !== 0) throw bgErr;

      // Direct fallback (e.g. background worker sleeping or during tests)
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const isAgentic = typeof currentPayload?.model === "string" && currentPayload.model.includes("inkling");
      try {
        const directRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": isAgentic ? "https://cline.bot" : "https://student.iclicker.com",
            "X-Title": isAgentic ? "Cline" : "aClicker",
            "X-OpenRouter-Title": isAgentic ? "Cline" : "aClicker",
            "X-OpenRouter-Categories": "cli-agent",
          },
          body: JSON.stringify(currentPayload),
          signal: controller?.signal,
        });
        if (!directRes.ok) {
          status = directRes.status;
          let directBody = null;
          try {
            directBody = await directRes.json();
          } catch {
            try { directBody = await directRes.text(); } catch { /* empty */ }
          }
          console.error(
            `[aClicker] Direct API error ${directRes.status}:`,
            directBody ?? "(no response body)"
          );
          const directErrMsg = directBody?.error?.message || directBody?.error || (typeof directBody === "string" ? directBody : JSON.stringify(directBody));
          throw new Error(`API error ${directRes.status}: ${directErrMsg}`);
        }
        return await directRes.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };

  let data = null;
  try {
    data = await tryRequest(payload);
  } catch (err) {
    if (isDebug) {
      console.warn(`[aClicker Debug] Model error (${cleanModel}):`, err);
    }
    // Reasoning is optional, but never remove response_format: successful responses must match the schema.
    if (status === 400 && payload.reasoning) {
      console.warn(`[aClicker] Model ${cleanModel} rejected reasoning. Retrying with structured output only…`);
      const fallbackPayload = { ...payload };
      delete fallbackPayload.reasoning;
      data = await tryRequest(fallbackPayload);
      if (isDebug) {
        const fallbackRaw = data?.choices?.[0]?.message?.content;
        console.log(`[aClicker Debug] Model response after retry (${cleanModel}):`, fallbackRaw !== undefined ? fallbackRaw : data);
      }
    } else {
      throw err;
    }
  }

  const message = data?.choices?.[0]?.message;
  const raw = message?.content;
  const toolCall = message?.tool_calls?.[0];

  if (isDebug) {
    const debugResponse = toolCall
      ? { tool_call: toolCall, content: raw }
      : (raw !== undefined ? raw : data);
    console.log(`[aClicker Debug] Model response (${cleanModel}):`, debugResponse);
  }

  if (toolCall?.function?.arguments) {
    try {
      const args =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      if (args?.thinking) {
        console.log(`[aClicker Thinking (${cleanModel})]:`, args.thinking);
      }
    } catch {
      // Non-critical logging helper
    }
  } else if (typeof raw === "string") {
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed?.thinking) {
        console.log(`[aClicker Thinking (${cleanModel})]:`, parsed.thinking);
      }
    } catch {
      // Non-critical logging helper
    }
  }
  return parseAnswer(data);
}

/**
 * Execute a branch with attempt 2 retry and cross-model prompt fallback.
 */
async function executeBranchWithFallback({
  branchId,
  initialModel,
  initialPrompt,
  alternateModel,
  temperature = 0.5,
  encodedImage,
  apiKey,
  maxTokens,
  onValidAnswer,
  delayBeforeAlternate = 1000,
}) {
  // Attempt 1: Initial model + Initial prompt
  try {
    const ans = await callAPI({
      prompt: initialPrompt,
      temperature,
      encodedImage,
      apiKey,
      modelId: initialModel,
      maxTokens,
    });
    if (ans) {
      if (onValidAnswer) onValidAnswer(ans, branchId, 1);
      return { id: branchId, ans, model: initialModel, attempt: 1 };
    }
    console.warn(`[aClicker] Branch ${branchId} attempt 1 returned no answer.`);
  } catch (err) {
    console.warn(`[aClicker] Branch ${branchId} attempt 1 error:`, err);
  }

  // Attempt 1 failed -> retry once (Attempt 2)
  setStatus("working", `Call ${branchId} failed • retrying…`);
  await new Promise((r) => setTimeout(r, 500));

  try {
    const ans = await callAPI({
      prompt: initialPrompt,
      temperature,
      encodedImage,
      apiKey,
      modelId: initialModel,
      maxTokens,
    });
    if (ans) {
      if (onValidAnswer) onValidAnswer(ans, branchId, 2);
      return { id: branchId, ans, model: initialModel, attempt: 2 };
    }
    console.warn(`[aClicker] Branch ${branchId} attempt 2 returned no answer.`);
  } catch (err) {
    console.warn(`[aClicker] Branch ${branchId} attempt 2 error:`, err);
  }

  // Attempt 2 failed -> wait before prompting alternate model to prevent 429 rate limit
  setStatus("working", `Call ${branchId} failed twice • cooling down…`);
  if (debugMode) {
    console.log(
      `[aClicker Debug] Branch ${branchId} attempt 2 returned no answer/error. Waiting ${delayBeforeAlternate}ms before querying alternate model (${alternateModel}) to prevent 429…`
    );
  }
  if (delayBeforeAlternate > 0) {
    await new Promise((r) => setTimeout(r, delayBeforeAlternate));
  }

  // Prompt the ALTERNATE model with the ORIGINAL model's prompt!
  setStatus("working", `Call ${branchId} failed twice • querying alternate model…`);
  try {
    const ans = await callAPI({
      prompt: initialPrompt,
      temperature: 0.5,
      encodedImage,
      apiKey,
      modelId: alternateModel,
      maxTokens,
    });
    if (ans) {
      if (onValidAnswer) onValidAnswer(ans, branchId, 3);
      return { id: branchId, ans, model: alternateModel, attempt: 3 };
    }
    console.warn(`[aClicker] Branch ${branchId} alternate model returned no answer.`);
  } catch (err) {
    console.warn(`[aClicker] Branch ${branchId} alternate model error:`, err);
  }

  return { id: branchId, ans: null, err: new Error(`Branch ${branchId} all attempts failed`) };
}

/**
 * Run tiebreaker with Tier 1 primary model and Tier 2 fallback model.
 */
async function runTiebreakerWithFallback({
  a1,
  a2,
  encodedImage,
  apiKey,
  maxTokens,
  primaryModel = FREE_MODE_MODELS.tiebreaker,
  fallbackModel = FREE_MODE_MODELS.tiebreakerFallback,
}) {
  const prompt = makeTiebreakerPrompt(a1, a2);

  // Tier 1: Primary tiebreaker (default: thinkingmachines/inkling:free)
  setStatus("working", `Disagreement (${a1} vs ${a2}) • running tiebreaker…`);
  try {
    const ans = await callAPI({
      prompt,
      temperature: 0.5,
      encodedImage,
      apiKey,
      modelId: primaryModel,
      maxTokens,
    });
    if (ans) {
      return { ans, model: primaryModel, tier: 1 };
    }
  } catch (err) {
    console.warn("[aClicker] Primary tiebreaker failed:", err);
  }

  // Tier 2: Fallback tiebreaker (default: inclusionai/ling-3.0-flash-vl:free)
  setStatus("working", "Primary tiebreaker failed • running fallback tiebreaker…");
  try {
    const ans = await callAPI({
      prompt,
      temperature: 0.5,
      encodedImage,
      apiKey,
      modelId: fallbackModel,
      maxTokens,
    });
    if (ans) {
      return { ans, model: fallbackModel, tier: 2 };
    }
  } catch (err) {
    console.warn("[aClicker] Fallback tiebreaker failed:", err);
  }

  return { ans: null, tier: null };
}

// ─── Check Answer ─────────────────────────────────────────────────────────────

async function checkAnswer(force = false) {
  if (isAnswering) {
    console.log("[aClicker] Answer check already in progress, skipping duplicate.");
    return;
  }

  isAnswering = true;
  try {
    setStatus("working", "Looking for the question image…");
    const imgElement = await getIclickerImage();
    if (!imgElement) {
      setStatus("warning", "No question image found.");
      console.log("No image found.");
      return;
    }

    if (!force && lastAnsweredImageSrc && lastAnsweredImageSrc === imgElement.src) {
      if (debugMode) {
        console.log("[aClicker Debug] Question image already answered, skipping duplicate check.");
      }
      return;
    }

    setStatus("working", "Processing image…");
    const encodedImage = await getBase64Image(imgElement);
    if (!encodedImage) {
      setStatus("warning", "Failed to process image.");
      console.log("Failed to encode image.");
      return;
    }

    const settings = await chrome.storage.local.get(["freeMode", "apiKey", "modelId", "maxTokens", "debugMode"]);
    const isFreeMode = settings.freeMode === true || freeMode === true;
    const apiKey = settings.apiKey;
    const modelId = settings.modelId || "~google/gemini-flash-latest";
    const regularMaxTokens = settings.maxTokens || 2800;
    const maxTokens = isFreeMode ? 8000 : regularMaxTokens;
    debugMode = settings.debugMode === true || debugMode === true;

    if (!apiKey) {
      setStatus("warning", "API key not set. Configure in Settings.");
      console.warn("[aClicker] OpenRouter API key is empty.");
      return;
    }

    if (!isFreeMode && !effort) {
      setStatus("working", "Sending question to AI…");
      const answer = await callAPI({
        prompt: PROMPT_DERIVATION,
        temperature: 0.5,
        encodedImage,
        apiKey,
        modelId,
        maxTokens,
      });

      if (!answer) {
        setStatus("warning", "AI returned no answer.");
        return;
      }

      if (selectAnswer(answer)) {
        lastAnsweredImageSrc = imgElement.src;
        setStatus("complete", `Answered option ${answer}.`);
      } else {
        setStatus("warning", `AI selected option ${answer} (button not found).`);
      }
      return;
    }

    // ── Dual-Model / High-Effort Ensemble Mode ─────────────────────────────────
    setStatus(
      "working",
      isFreeMode
        ? "Free Mode: analyzing question with dual models…"
        : "High-effort mode: analyzing question…"
    );

    let currentSelectedAnswer = null;

    const onValidAnswer = (ans, branchId, attempt) => {
      if (!currentSelectedAnswer && ans) {
        currentSelectedAnswer = ans;
        const clicked = selectAnswer(currentSelectedAnswer);
        if (clicked) {
          lastAnsweredImageSrc = imgElement.src;
          setStatus("working", `Answered option ${currentSelectedAnswer} • verifying…`);
        } else {
          setStatus("warning", `AI selected option ${currentSelectedAnswer} (button not found).`);
        }
        console.log(
          `[aClicker] Fast-path: Answer received (${currentSelectedAnswer} from Branch ${branchId}, attempt ${attempt}), submitted.`
        );
      }
    };

    const branch1Config = {
      branchId: 1,
      initialModel: isFreeMode ? FREE_MODE_MODELS.primary : modelId,
      initialPrompt: PROMPT_DERIVATION,
      alternateModel: isFreeMode ? FREE_MODE_MODELS.secondary : modelId,
      temperature: 0.5,
      encodedImage,
      apiKey,
      maxTokens,
      onValidAnswer,
    };

    const branch2Config = {
      branchId: 2,
      initialModel: isFreeMode ? FREE_MODE_MODELS.secondary : modelId,
      initialPrompt: PROMPT_ELIMINATION,
      alternateModel: isFreeMode ? FREE_MODE_MODELS.primary : modelId,
      temperature: 0.5,
      encodedImage,
      apiKey,
      maxTokens,
      onValidAnswer,
    };

    const [res1, res2] = await Promise.all([
      executeBranchWithFallback(branch1Config),
      executeBranchWithFallback(branch2Config),
    ]);

    const dualEval = evaluateDualSettlement(res1.ans, res2.ans);

    if (dualEval.action === "fail") {
      setStatus("warning", "AI returned no valid answer.");
      return;
    }

    if (dualEval.action === "fallback") {
      currentSelectedAnswer = dualEval.currentSelected;
      selectAnswer(currentSelectedAnswer);
      lastAnsweredImageSrc = imgElement.src;
      setStatus("complete", `Answered option ${currentSelectedAnswer}.`);
      return;
    }

    if (dualEval.action === "consensus") {
      currentSelectedAnswer = dualEval.currentSelected;
      selectAnswer(currentSelectedAnswer);
      lastAnsweredImageSrc = imgElement.src;
      setStatus("complete", `Confirmed option ${currentSelectedAnswer}.`);
      console.log(`[aClicker] Consensus reached on option ${currentSelectedAnswer}.`);
      return;
    }

    // Disagreement: Run tiebreaker
    console.log(
      `[aClicker] Disagreement detected (${res1.ans} vs ${res2.ans}). Running tiebreaker.`
    );

    const primaryTbModel = isFreeMode ? FREE_MODE_MODELS.tiebreaker : modelId;
    const fallbackTbModel = isFreeMode ? FREE_MODE_MODELS.tiebreakerFallback : modelId;

    const tbResult = await runTiebreakerWithFallback({
      a1: res1.ans,
      a2: res2.ans,
      encodedImage,
      apiKey,
      maxTokens,
      primaryModel: primaryTbModel,
      fallbackModel: fallbackTbModel,
    });

    const tiebreakerAnswer = tbResult.ans;
    console.log("[aClicker] Tiebreaker returned:", tiebreakerAnswer, `(tier: ${tbResult.tier})`);

    const tbDecision = evaluateTiebreakerDecision(currentSelectedAnswer, tiebreakerAnswer);
    if (tbDecision.shouldUpdate) {
      console.log(
        `[aClicker] Switching answer from ${currentSelectedAnswer} to ${tbDecision.finalAnswer}.`
      );
      currentSelectedAnswer = tbDecision.finalAnswer;
      const clicked = selectAnswer(currentSelectedAnswer);
      if (clicked) {
        lastAnsweredImageSrc = imgElement.src;
        setStatus("complete", `Tiebreaker updated answer to option ${currentSelectedAnswer}.`);
      } else {
        setStatus("warning", `Tiebreaker selected option ${currentSelectedAnswer} (button not found).`);
      }
    } else if (tiebreakerAnswer && tiebreakerAnswer === currentSelectedAnswer) {
      lastAnsweredImageSrc = imgElement.src;
      setStatus("complete", `Tiebreaker confirmed option ${currentSelectedAnswer}.`);
    } else {
      // Both tiebreaker attempts failed or returned null; keep currently submitted answer
      lastAnsweredImageSrc = imgElement.src;
      setStatus("complete", `Answered option ${currentSelectedAnswer} (tiebreaker unavailable).`);
    }
  } catch (error) {
    const errStr = String(error?.message || error || "").toLowerCase();
    if (errStr.includes("401") || errStr.includes("unauthorized") || errStr.includes("invalid api key")) {
      setStatus("warning", "Invalid OpenRouter API key. Check Settings.");
    } else if (errStr.includes("402") || errStr.includes("credits") || errStr.includes("payment")) {
      setStatus("warning", "OpenRouter account out of credits.");
    } else if (errStr.includes("429") || errStr.includes("rate limit")) {
      setStatus("warning", "Rate limited by AI provider • Please wait.");
    } else if (errStr.includes("404") || errStr.includes("no endpoints")) {
      setStatus("warning", "No AI endpoint available for this model.");
    } else {
      setStatus("warning", "AI error — see console.");
    }
    console.error("Error in checkAnswer:", error);
  } finally {
    isAnswering = false;
  }
}

// ─── Image Helpers ────────────────────────────────────────────────────────────

async function getIclickerImage() {
  const MAX_ATTEMPTS = 100;
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    const img = document.querySelector(".question-image-container img");
    if (img?.src) {
      console.log("Image found:", img.src);
      return img;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log("Image not found after max attempts.");
  return null;
}

function fetchImageViaBackground(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, (response) => {
      if (response?.base64) {
        resolve(response.base64);
      } else {
        console.log("Failed to fetch image from background.");
        resolve(null);
      }
    });
  });
}

function loadImageFromBase64(base64) {
  if (!base64) return Promise.resolve(null);

  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load base64 image"));
    img.src = base64;
  });
}

async function getBase64Image(imgElement) {
  if (!imgElement?.src) {
    console.log("No image src found.");
    return null;
  }

  try {
    const originalBase64 = await fetchImageViaBackground(imgElement.src);
    if (!originalBase64) return null;

    const loadedImg = await loadImageFromBase64(originalBase64);
    if (!loadedImg) return null;

    const MAX_DIM = 768;
    let { naturalWidth: width, naturalHeight: height } = loadedImg;

    const longest = Math.max(width, height);
    if (longest > MAX_DIM) {
      const scale = MAX_DIM / longest;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(loadedImg, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (error) {
    console.error("Error processing image:", error);
    return null;
  }
}

// ─── Observer Control ─────────────────────────────────────────────────────────

function startObserver() {
  if (!observer) {
    console.warn("Observer not initialized yet. Re-initializing…");
    observer = new MutationObserver(handleMutations);
  }

  const targetNode = document.querySelector("#wrapper");
  if (!targetNode) {
    setStatus("warning", "Could not find wrapper element.");
    console.warn("Wrapper element not found.");
    return;
  }

  observer.observe(targetNode, OBSERVER_CONFIG);
  setStatus("standby", "Waiting for question…");
  console.log("Started answering.");

  const url = window.location.href;
  if (url.includes(ICLICKER_COURSE_URL)) {
    setPrevPage("courses");
  } else if (url.includes(ICLICKER_CLASS_URL)) {
    setPrevPage("poll");
    if (url.includes("/poll") && document.querySelector(".question-type-container")) {
      checkAnswer();
    }
  }
}

function stopObserver(status) {
  observer?.disconnect();
  lastAnsweredImageSrc = null;

  if (status === "default") {
    console.log("Default stop.");
    chrome.storage.local.remove(["status", "statusMessage"]);
    localPrevPage = null;
    window.location.reload();
  } else if (status === "manual") {
    console.log("Manually stopped.");
    setStatus("stopped", "Extension stopped.");
  }
}

// ─── SPA Route Change Handler ─────────────────────────────────────────────────

function onRouteChange() {
  const url = window.location.href;
  if (url.includes(ICLICKER_CLASS_URL) && url.includes("/poll")) {
    setPrevPage("poll");
    if (document.querySelector(".question-type-container")) {
      checkAnswer();
    }
  } else {
    lastAnsweredImageSrc = null;
    if (isLoginPage(url) && autoLogin) {
      checkAutoLogin();
    }
  }
}

window.addEventListener("hashchange", onRouteChange);
window.addEventListener("popstate", onRouteChange);

let lastCheckedHref = window.location.href;
setInterval(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastCheckedHref) {
    lastCheckedHref = currentUrl;
    onRouteChange();
  } else if (isLoginPage(currentUrl) && autoLogin && !isLoggingIn && document.querySelector("#federationList")) {
    checkAutoLogin();
  }
}, 250);

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const { from, msg } = message;
    const url = window.location.href;

    if (from !== "popup") {
      console.log("Unknown message source:", message);
      sendResponse({ ack: true });
      return true;
    }

    switch (msg) {
      case "start": {
        const activePage =
          url.includes(ICLICKER_COURSE_URL) &&
          ALLOWED_PATHS.some((path) => url.includes(path));

        const onPollPage =
          url.includes(ICLICKER_CLASS_URL) && url.includes("/poll");
        const onClassPage =
          url.includes(ICLICKER_COURSE_URL) && activePage;

        if (onPollPage) {
          checkAnswer(true);
        } else if (onClassPage && autoJoin) {
          chrome.storage.local.get(["status"], (result) => {
            if (result.status !== "standby") {
              const joinContainer = document.querySelector(".course-join-container");
              if (joinContainer?.classList.contains("expanded")) {
                document.querySelector("#btnJoin")?.click();
              }
            }
          });
        }

        startObserver();
        break;
      }

      case "stop": {
        stopObserver("manual");
        break;
      }

      case "autoJoin": {
        autoJoin = message.value !== undefined ? !!message.value : !autoJoin;
        chrome.storage.local.set({ autoJoin });
        break;
      }

      case "freeMode": {
        freeMode = message.value !== undefined ? !!message.value : !freeMode;
        chrome.storage.local.set({ freeMode });
        break;
      }

      case "effort": {
        effort = message.value !== undefined ? !!message.value : !effort;
        chrome.storage.local.set({ effort });
        break;
      }

      case "debugMode": {
        debugMode = message.value !== undefined ? !!message.value : !debugMode;
        chrome.storage.local.set({ debugMode });
        break;
      }

      case "autoStart": {
        autoStart = message.value !== undefined ? !!message.value : !autoStart;
        chrome.storage.local.set({ autoStart });
        if (autoStart) {
          startObserver();
        } else {
          stopObserver("manual");
        }
        break;
      }

      case "spoofLocation": {
        chrome.storage.local.get(["spoofLocation"], (result) => {
          spoofLocation = result.spoofLocation === true;
          updateLocationSpoofing(spoofLocation);
        });
        break;
      }

      case "getSchoolList": {
        ensureFederationListReady(() => {
          const schools = getSchoolListFromDOM();
          sendResponse({ schools });
        });
        return true; // Keep channel open for async response
      }

      case "selectSchool": {
        const schoolValue = message.value;
        const schoolName = message.schoolName;
        if ((schoolValue || schoolName) && isLoginPage()) {
          tryAutoLogin(schoolValue, schoolName);
        }
        break;
      }

      default: {
        console.log("Unknown message:", message);
        break;
      }
    }

    sendResponse({ ack: true });
  } catch (e) {
    console.error("Message handler error:", e);
    sendResponse({ ack: false });
  }

  return true;
});

// ─── Storage Change Listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if ("spoofLocation" in changes) {
    spoofLocation = changes.spoofLocation.newValue === true;
    updateLocationSpoofing(spoofLocation);
  }
  if ("autoJoin" in changes) {
    autoJoin = changes.autoJoin.newValue === true;
  }
  if ("effort" in changes) {
    effort = changes.effort.newValue === true;
  }
  if ("freeMode" in changes) {
    freeMode = changes.freeMode.newValue === true;
  }
  if ("debugMode" in changes) {
    debugMode = changes.debugMode.newValue === true;
  }
  if ("autoStart" in changes) {
    autoStart = changes.autoStart.newValue !== false;
  }
  if ("prevPage" in changes) {
    localPrevPage = changes.prevPage.newValue;
  }
});
})();