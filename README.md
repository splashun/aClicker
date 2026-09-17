# aClicker

### Automated iClicker Companion — Powered by Vision AI

![Chrome Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)
![OpenRouter](https://img.shields.io/badge/API-OpenRouter-6366f1?logo=openai&logoColor=white)
![JavaScript](https://img.shields.io/badge/Language-JavaScript-f7df1e?logo=javascript&logoColor=black)
![Status](https://img.shields.io/badge/Status-Alpha-orange)
![License](https://img.shields.io/badge/License-MIT-green)

**aClicker** is a Chrome extension that automatically answers multiple-choice questions on [student.iclicker.com](https://student.iclicker.com) using multimodal vision AI models. It captures question slides directly from your screen, sends them to state-of-the-art reasoning models via [OpenRouter](https://openrouter.ai), and clicks the correct answer — all in real time.

It also handles **automated session joining**, **location validation**, **institution auto-login**, and shows you a **live status badge** right on the iClicker page so you always know what's happening.

> **Based on [ByeClicker](https://github.com/gigabite-pro/byeClicker) by Vaibhav Sharma.**

---

> [!WARNING]
> **Alpha Features Notice**
>
> Two features are currently in **heavy alpha stages** and may not always work reliably:
>
> - **Free Mode (Alpha)**: Relies on experimental, publicly shared free-tier vision models via OpenRouter (`Ling-3.0-flash-vl:free` & `Inkling:free`). These models frequently experience provider rate limits, unexpected downtime, queue delays, or response formatting inconsistencies. A funded OpenRouter API key with a standard model is **strongly recommended** for reliable use.
>
> - **Location Spoofing (Alpha)**: Directly hooks into page-level AngularJS geolocation services and the iClicker attendance API to match instructor coordinates. Changes to iClicker's web client, browser security policies, or campus geofencing checks can cause it to fail unexpectedly. **Always verify** that your location shows as accepted in iClicker after joining a session.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [OpenRouter API Key Setup](#openrouter-api-key-setup)
- [How to Use](#how-to-use)
- [Settings Reference](#settings-reference)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Disclaimer & Academic Integrity](#disclaimer--academic-integrity)

---

## Features

### 🧠 Vision-Powered AI Answering

aClicker reads the question image directly from your iClicker screen — including slides, diagrams, formulas, and graphs — and sends it to a multimodal vision AI model that can "see" and reason about the image. The AI works through the problem step-by-step and submits the best answer automatically.

### 🔀 Dual-Model Arbitration & High-Effort Mode

When **High-Effort Mode** is enabled, aClicker uses an **ensemble approach** with two independent reasoning strategies running in parallel:

1. **Branch 1 — First-Principles Derivation**: Solves the question from scratch using direct reasoning and concept derivation.
2. **Branch 2 — Critical Elimination**: Examines each answer choice, eliminates wrong ones with explicit reasoning, and confirms the survivor.

After both branches return:
- ✅ **Consensus**: If both branches agree, the answer is submitted with high confidence.
- ⚖️ **Tiebreaker**: If they disagree, a third "tiebreaker" query adjudicates between the two conflicting answers by re-examining the question image.

The first valid answer is submitted immediately as a **fast-path** while verification continues in the background — so you're never left waiting.

> [!NOTE]
> In standard (non-free) mode with High-Effort off, aClicker sends a single request to your configured model for speed and cost efficiency.

### 🆓 Free Mode `[ALPHA]`

A **zero-cost** mode that uses dual free-tier vision models with no API balance needed:
- **Primary**: `inclusionai/ling-3.0-flash-vl:free` (Ling-3.0-flash-vl)
- **Secondary**: `thinkingmachines/inkling:free` (Inkling)

Free Mode automatically enables High-Effort Mode, running both models in parallel with full tiebreaker logic and cross-model fallback.

> [!WARNING]
> **Experimental Alpha Stage**: Free Mode relies on community-shared free-tier model endpoints hosted on OpenRouter. These can experience heavy traffic, provider rate limits, queue delays, intermittent downtime, or response formatting inconsistencies. **For reliable day-to-day use, a funded OpenRouter API key is strongly recommended.**

### 📍 Location Spoofing `[ALPHA]`

Bypasses instructor **geolocation / geofencing checks** by dynamically aligning your browser's reported coordinates with the instructor's session location. When you join a session, aClicker:

1. Intercepts the browser's Geolocation API (`getCurrentPosition` and `watchPosition`).
2. Fetches the instructor's coordinates from iClicker's attendance API via AngularJS service hooks.
3. Replaces your reported position with the instructor's coordinates.

> [!WARNING]
> **Experimental Alpha Stage**: Location Spoofing hooks deeply into iClicker's AngularJS services and the browser Geolocation API. Changes to iClicker's web client, browser security policies, or campus-specific geofencing implementations can cause it to fail without warning. **Always verify** that your location appears as accepted after joining a session.

### 🚀 Auto Join

Automatically detects when a live lecture session becomes available and clicks the **Join** button for you — no manual action needed.

### ▶️ Auto Start

Begins listening for and answering poll questions **immediately** when you open the iClicker page. If disabled, you can manually start by clicking **Start Answering** in the popup.

### 🔐 Auto Login & School Selector

Remembers your institution and automatically navigates through the campus SSO login screen. On the login page, aClicker:
1. Selects your saved school from the institution dropdown.
2. Clicks the **Go** button to proceed to your campus login.

You can choose your school directly from the popup when you're on the iClicker login page, or edit it in the **Settings** page.

### 🔔 In-Page Live HUD / Toast

A floating status badge appears in the **bottom-right corner** of the iClicker page, showing real-time AI states with color-coded indicators:

| Status | Color | Meaning |
|--------|-------|---------|
| 🔵 Standby | Blue | Waiting for a question to appear |
| 🟡 Working | Yellow (pulsing) | Analyzing question / querying AI |
| 🟢 Complete | Green | Answer submitted successfully |
| 🔴 Warning | Red | An error occurred — check console |
| ⚪ Stopped | Gray | Extension manually stopped |

### ⚙️ Custom Model Support

By default, aClicker uses `~google/gemini-flash-latest` (Google's latest Gemini Flash model via OpenRouter). You can change this to **any vision-capable model ID** hosted on OpenRouter — just paste the model identifier into the **Model** field in Settings.

### 🐛 Developer Debug Mode

Enable **Debug Mode** in Settings to print verbose diagnostic logs to the browser's developer console. Useful for troubleshooting issues or understanding the extension's behavior.

---

## Prerequisites

Before installing aClicker, make sure you have:

1. **Google Chrome** (or any Chromium-based browser — **Brave**, **Microsoft Edge**, **Arc**, **Opera**, etc.)
2. **A free OpenRouter account** — Recommended for reliability. While Free Mode requires no balance, it's in alpha and may be unreliable. See [OpenRouter API Key Setup](#openrouter-api-key-setup) for full instructions.
3. **An active iClicker student account** — The account you use to attend classes at [student.iclicker.com](https://student.iclicker.com).

---

## Installation

### Step 1 — Download the Code

Choose **one** of the two methods below:

#### Method A: Download ZIP (Recommended for Beginners — No Extra Software Needed)

1. On this GitHub page, click the green **`<> Code`** button near the top.
2. Select **`Download ZIP`** from the dropdown menu.
3. Find the downloaded `.zip` file (usually in your `Downloads` folder) and **extract / unzip** it.
   - **Windows**: Right-click the ZIP → **Extract All…**
   - **Mac**: Double-click the ZIP file.
4. Move the extracted folder to a **safe, permanent location** (e.g., `Documents/aClicker`).

> [!IMPORTANT]
> **Do not delete or move** the extracted folder after installation. Chrome needs this folder to stay in the same location to run the extension. If you move or delete it, the extension will break and you'll need to reinstall it.


---

### Step 2 — Install in Chrome (Developer Mode)

> [!NOTE]
> **What is "Developer Mode"?**
> Chrome has a built-in developer mode that lets you install extensions directly from a folder on your computer, instead of from the Chrome Web Store. This is called loading an **"unpacked extension"** — it just means Chrome reads the extension files straight from your local folder.

1. Open Chrome and type `chrome://extensions` into the address bar, then press **Enter**.
   - *Alternatively*: Click the **`⋮` (three-dot menu)** in the top-right corner of Chrome → **Extensions** → **Manage Extensions**.

2. In the **top-right corner** of the Extensions page, find the **Developer mode** toggle and switch it to **ON** (it should turn blue).

3. Three new buttons will appear at the top. Click the **`Load unpacked`** button (top-left area).

4. A file picker dialog will open. **Navigate to and select** the `aClicker` folder you extracted — this is the folder that directly contains `manifest.json`.
   - 💡 If you see folders like `aClicker-main` inside your extracted folder, select **that inner folder** (the one with `manifest.json` inside it).

5. aClicker should now appear as a card on the Extensions page with its icon and name. 🎉

6. **Pin the extension** to your Chrome toolbar for easy access:
   - Click the **puzzle piece icon** 🧩 in the top-right corner of Chrome.
   - Find **aClicker** in the list and click the **pin icon** 📌 next to it.
   - The aClicker icon will now appear permanently in your toolbar.

---

### Step 3 — How to Update / Reload

If you download a new version of the extension or make changes to the extension files:

1. Go to `chrome://extensions`.
2. Find the **aClicker** card.
3. Click the circular **Reload** button ( 🔄 ) on the card.
4. Refresh any open `student.iclicker.com` tabs.

---

## OpenRouter API Key Setup

### What is OpenRouter?

[OpenRouter](https://openrouter.ai) is an **API gateway** — think of it as a universal front desk that gives you access to hundreds of state-of-the-art AI models (from Google, OpenAI, Anthropic, Meta, and others) through a single account. aClicker uses OpenRouter to send question images to vision AI models and get answers back.

> [!TIP]
> **What is an "API key"?**
> An API key is a unique password-like string (e.g., `sk-or-v1-abc123...`) that identifies your account when the extension communicates with OpenRouter. It's like a library card — it tells OpenRouter who's making the request.

### Getting an API Key

1. Go to [openrouter.ai](https://openrouter.ai) and **sign up** for a free account (or **log in** if you already have one).

2. Navigate to the **Keys** section: [openrouter.ai/keys](https://openrouter.ai/keys).

3. Click **`+ New Key`**.

4. Give your key a name (e.g., `aClicker`) and click **Create**.

5. **Copy the generated key** — it will look something like `sk-or-v1-...`. Store it somewhere safe; you won't be able to see the full key again after leaving this page.

> [!TIP]
> **How much does it cost?**
> Standard vision models like Google Gemini Flash cost mere **fractions of a cent** per question answered. A **\$5 credit** is typically enough to last **hundreds of classes**. It's extremely affordable.
>
> While **Free Mode** requires no balance at all, it's currently in alpha and can be unreliable. A small funded balance with a standard model is the recommended setup.

### Where to Put the Key in the Extension

1. Click the **aClicker** icon in your browser toolbar (the puzzle piece area, or the pinned icon).

2. In the popup, click **`More Settings`** at the bottom (with the ⚙️ gear icon).
   - *Alternatively*: Right-click the aClicker icon in the toolbar and select **Options**.

3. On the Settings page, scroll to the **Advanced** section.

4. Find the **`OpenRouter API Key`** field and **paste** your key (`sk-or-v1-...`).

5. That's it! The key **saves automatically** — you'll see a brief "Setting saved" confirmation. The key is displayed as masked dots (like a password field) for security and is **stored locally** on your computer. It is **never sent anywhere** except directly to OpenRouter's API when answering questions.

---

## How to Use

Here's what a typical class session looks like with aClicker:

### Step-by-Step Classroom Walkthrough

1. **Open iClicker**: Navigate to [student.iclicker.com](https://student.iclicker.com) in Chrome.

2. **Log In**: If **Auto Login** is enabled and your school is saved, aClicker will automatically select your institution and click **Go** on the login page. Otherwise, log in manually as usual.

3. **Join Your Class**: Navigate to your course. If **Auto Join** is enabled, aClicker will automatically click the **Join** button when a live session appears. Otherwise, join manually.

4. **Verify Status**: Click the aClicker icon in your toolbar to open the popup.
   - If **Auto Start** is on (default), the status should show a **blue dot** with *"Waiting for question…"*.
   - If the status shows *"Extension stopped"*, click **`Start Answering`** to begin.

5. **Wait for a Poll**: When your instructor posts a question:
   - A floating status toast will appear in the **bottom-right corner** of the page showing 🟡 *"Analyzing question…"* or *"Free Mode: analyzing question with dual models…"*.
   - aClicker captures the question image, sends it to the AI, and clicks the answer.
   - The toast will update to 🟢 *"Answered option X"* or *"Confirmed option X"* when done.

6. **That's it!** aClicker runs silently in the background. It will automatically detect each new question and answer it. You can stop at any time by clicking **`Stop Answering`** in the popup.

> [!TIP]
> If you're not on an iClicker tab, the popup will show an **"Open iClicker"** button that opens `student.iclicker.com` in a new tab for you.

---

## Settings Reference

aClicker settings are split between the **Popup** (quick toggles) and the **Settings page** (full options). Settings are saved automatically.

| Setting | Default | Location | Description |
|---------|---------|----------|-------------|
| **Free Mode** `[Alpha]` | Off | Popup | Uses dual free-tier vision models (`Ling-3.0-flash-vl:free` & `Inkling:free`) so no API balance is needed. Automatically enables High-Effort Mode. Experimental — may be slower or less accurate. |
| **Auto Join** | On | Popup | Automatically joins the next available live session as soon as it appears. |
| **Location Spoofing** `[Alpha]` | Off | Popup | Overrides geolocation checks to match the instructor's session coordinates. Experimental — may not work across all conditions. |
| **Auto Login** | On | Popup | Selects your school on the login page and clicks Go automatically. Shows a school selector in the popup when on the login page. |
| **High-Effort Mode** | Off | Settings → Automation | Sends the question to two models with different reasoning strategies, uses consensus or a tiebreaker. May cost up to 3× more tokens. ⚠️ *Not recommended for regular use.* Automatically managed when Free Mode is on. |
| **Auto Start** | On | Settings → Automation | Starts answering automatically when you open an iClicker page. |
| **Institution** | Not set | Settings → Login | Your school name as it appears in iClicker. Visit the login page with Auto Login enabled to select, or edit manually. |
| **OpenRouter API Key** | Empty | Settings → Advanced | Your personal OpenRouter API key (`sk-or-v1-…`). Stored locally, never sent anywhere except OpenRouter. |
| **Model** | `~google/gemini-flash-latest` | Settings → Advanced | The OpenRouter model identifier used for answering. Disabled when Free Mode is on. Change only if you know what you're doing. |
| **Debug Mode** | Off | Settings → Developer | Prints verbose diagnostic logs to the browser console for troubleshooting. |

> [!NOTE]
> When **Free Mode** is toggled on, it automatically sets **High-Effort Mode** to on and overrides the **Model** to its free-tier models. Your previous settings are backed up and restored when Free Mode is turned off.

---

## Troubleshooting & FAQ

### ❌ "API key not set. Configure in Settings."

**Problem**: aClicker can't find your OpenRouter API key.

**Fix**:
1. Click the aClicker icon in your toolbar → **More Settings** (⚙️ gear icon).
2. Scroll to the **Advanced** section.
3. Paste your OpenRouter API key into the **OpenRouter API Key** field.
4. If you don't have a key yet, see [OpenRouter API Key Setup](#openrouter-api-key-setup).

---

### ❌ Free Mode is hanging, or "AI returned no answer"

**Problem**: Free Mode relies on free-tier models that can experience rate limits, traffic spikes, or downtime.

**Fix**:
1. **Wait and try again** — free-tier models can be temporarily overloaded.
2. **Switch to a funded model** — add a small balance to your OpenRouter account, enter your API key, and disable Free Mode. The default model (`~google/gemini-flash-latest`) is very inexpensive and much more reliable.
3. If the error persists, enable **Debug Mode** in Settings and check the browser console for specific error messages.

---

### ❌ Location check fails despite Location Spoofing being turned on

**Problem**: Location Spoofing is in heavy alpha and depends on iClicker's internal AngularJS services, which can change without notice.

**Fix**:
1. Make sure your browser has **location permissions** enabled for `student.iclicker.com` (Chrome → address bar padlock icon → Site Settings → Location → Allow).
2. **Refresh the page** and rejoin the session — the spoof script needs to load before AngularJS initializes.
3. Check the browser console (`F12` → Console tab) for messages starting with `[aClicker]` — look for `"All location spoofing hooks installed"` to confirm the hooks loaded.
4. If the hooks fail, the instructor's geofencing configuration may have changed. **Location Spoofing is experimental and may not work in all cases.**

---

### ❌ Extension doesn't appear or isn't working on iClicker

**Fix**:
1. **Refresh the iClicker tab** (`Ctrl+R` or `Cmd+R`).
2. Go to `chrome://extensions` and make sure aClicker is **enabled** (toggle is on).
3. Check that the extension has permissions for `student.iclicker.com`:
   - Click **Details** on the aClicker card in `chrome://extensions`.
   - Under **Site access**, ensure it includes `https://student.iclicker.com/*`.
4. Try clicking **Reload** ( 🔄 ) on the extension card, then refresh the iClicker tab.

---

### ❓ How do I view diagnostic logs?

1. Open the iClicker tab in Chrome.
2. Press **`F12`** to open Chrome DevTools (or right-click anywhere on the page → **Inspect**).
3. Click the **Console** tab.
4. Look for messages prefixed with `[aClicker]` — these are the extension's logs.
5. For more detailed logs, enable **Debug Mode** in Settings → Developer.

> [!TIP]
> If you see errors in the console, they often contain the specific cause (e.g., `API error: 429` means rate limiting). Include these when reporting bugs.

---

### ❓ Can I use a different AI model?

Yes! You can use **any vision-capable model** hosted on OpenRouter. Go to Settings → Advanced → **Model** and replace the default model ID with your preferred one. Browse available models at [openrouter.ai/models](https://openrouter.ai/models).

Popular choices include:
- `~google/gemini-flash-latest` (default — fast & cheap)
- `z-ai/glm-5.3-flash` (good alternative)
- `meta/muse-spark-1.3-contributor` (best value — smartest, but trains on input data)

---

## Disclaimer & Academic Integrity

> [!CAUTION]
> **This software is provided for research and educational purposes only.**
>
> Using automated tools to answer quiz or exam questions may violate your institution's **academic integrity policies**, **honor code**, or **code of conduct**. The developers of aClicker do not encourage or condone academic dishonesty.
>
> **You are solely responsible** for how you use this tool. Before using aClicker in any academic setting, understand and accept the risks, including potential disciplinary action from your school.
>
> The developers assume **no liability** for any consequences resulting from the use of this software.

---

<p align="center">
  <sub>aClicker v1.0 · Based on <a href="https://github.com/gigabite-pro/byeClicker">ByeClicker</a> by Vaibhav Sharma</sub>
</p>
