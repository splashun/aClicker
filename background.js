/**
 * aClicker — Background Service Worker (Manifest V3)
 *
 * Handles extension lifecycle, action icon state per tab,
 * and proxying CORS-restricted image requests and OpenRouter
 * API queries for content scripts.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ICONS_ENABLED = Object.freeze({
  16: "./assets/logo-16.png",
  32: "./assets/logo-32.png",
  48: "./assets/logo-48.png",
  128: "./assets/logo-128.png",
});

const ICONS_DISABLED = Object.freeze({
  16: "./assets/logo-disabled-16.png",
  32: "./assets/logo-disabled-32.png",
  48: "./assets/logo-disabled-48.png",
  128: "./assets/logo-disabled-128.png",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine if a URL belongs to student.iclicker.com.
 * @param {string|undefined} url
 * @returns {boolean}
 */
function isIclickerUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "student.iclicker.com";
  } catch {
    return url.includes("student.iclicker.com");
  }
}

/**
 * Validate that an image URL belongs to permitted domains (anti-SSRF).
 * @param {string|undefined} url
 * @returns {boolean}
 */
function isAllowedImageUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return (
      parsed.hostname === "student.iclicker.com" ||
      parsed.hostname.endsWith(".iclicker.com") ||
      parsed.hostname.endsWith(".amazonaws.com") ||
      parsed.hostname.endsWith(".cloudfront.net")
    );
  } catch {
    return false;
  }
}

/**
 * Update the extension action state and icon for a given tab.
 * Keeps the action enabled across all tabs so the popup can open
 * (showing its disabled state when not on iClicker), while keeping
 * the disabled icon when the URL is not student.iclicker.com.
 * @param {number|undefined} tabId
 * @param {boolean} isEnabled
 */
function updateActionState(tabId, isEnabled) {
  const iconPath = isEnabled ? ICONS_ENABLED : ICONS_DISABLED;
  try {
    if (tabId) {
      chrome.action.enable(tabId);
      chrome.action.setIcon({ tabId, path: iconPath });
    } else {
      chrome.action.enable();
      chrome.action.setIcon({ path: iconPath });
    }
  } catch (err) {
    console.debug("[aClicker] Error updating action state:", err);
  }
}

// ─── Tab & Lifecycle Event Listeners ──────────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateActionState(activeInfo.tabId, isIclickerUrl(tab?.url));
  } catch (error) {
    // Tab may have closed before info could be fetched
    updateActionState(activeInfo.tabId, false);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === "complete" && tab.url) {
    updateActionState(tabId, isIclickerUrl(tab.url));
  }
});

chrome.runtime.onInstalled?.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        updateActionState(tab.id, isIclickerUrl(tab.url));
      }
    }
  } catch (err) {
    console.debug("[aClicker] onInstalled tab state update error:", err);
  }
});

// ─── Image Proxy Message Listener ─────────────────────────────────────────────
// Content scripts cannot fetch cross-origin images directly due to browser CORS policies.

async function handleFetchImage(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid image URL specified");
  }

  if (!isAllowedImageUrl(url)) {
    throw new Error("Untrusted image URL destination");
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP error fetching image: ${res.status}`);
  }

  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to convert image to base64"));
    reader.readAsDataURL(blob);
  });
}

// ─── OpenRouter API Proxy ─────────────────────────────────────────────────────
// Proxies OpenRouter completions through the service worker to bypass page CSP.

async function handleOpenRouterChatCompletion(payload, apiKey) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("Missing or invalid API key");
  }

  const isAgentic = typeof payload?.model === "string" && payload.model.includes("inkling");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": isAgentic ? "https://cline.bot" : "https://student.iclicker.com",
      "X-Title": isAgentic ? "Cline" : "aClicker",
      "X-OpenRouter-Title": isAgentic ? "Cline" : "aClicker",
      "X-OpenRouter-Categories": "cli-agent",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { message: text } };
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FETCH_IMAGE") {
    handleFetchImage(message.url)
      .then((base64) => sendResponse({ base64 }))
      .catch((err) => {
        console.error("[aClicker] Fetch image failed:", err);
        sendResponse({ error: true, message: err.message });
      });

    return true; // Keep message channel open for async response
  }

  if (message?.type === "OPENROUTER_CHAT_COMPLETION") {
    handleOpenRouterChatCompletion(message.payload, message.apiKey)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("[aClicker] OpenRouter proxy error:", err);
        sendResponse({ ok: false, status: 0, error: err.message });
      });

    return true;
  }
});