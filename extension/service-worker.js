import { detectFields } from "./content/detectFields.js";

const NATIVE_HOST_NAME = "com.vineet.jobtrack";
const AUTOFILL_SCRIPT_FILES = [
  "content/fill/namespace.js",
  "content/fill/domUtils.js",
  "content/fill/optionMatcher.js",
  "content/fill/fieldLocator.js",
  "content/fill/nativeFillers.js",
  "content/fill/customSelectFiller.js",
  "content/fill/autofillMain.js",
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[JobTrack] sidePanel.setPanelBehavior failed:", err));
});

function pageBlockReason(url) {
  if (!url) return "The active tab has no URL yet.";
  if (url.startsWith("chrome://")) return "Chrome blocks extensions on chrome:// pages.";
  if (url.startsWith("chrome-extension://")) return "Chrome blocks extensions on extension pages.";
  if (url.startsWith("view-source:")) return "Chrome blocks extensions on view-source: pages.";
  if (url.startsWith("about:")) return "Chrome blocks extensions on about: pages.";
  if (/^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)\b/i.test(url)) {
    return "Chrome blocks extensions on the Web Store.";
  }
  if (!/^https?:\/\//i.test(url)) return "Only http(s) pages can be scanned.";
  return null;
}

async function getActiveWebTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function getDefaultProfile() {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { type: "GET_DEFAULT_PROFILE" },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, error: "JobTrack is unavailable. Start the desktop app and try again." });
          return;
        }
        resolve(response || { ok: false, error: "JobTrack returned no profile response." });
      }
    );
  });
}

async function scanActiveTab() {
  const tab = await getActiveWebTab();
  if (!tab?.id) return { error: "No active tab to scan.", hint: "Open a job application page and try again." };
  const blocked = pageBlockReason(tab.url);
  if (blocked) {
    return { error: blocked, hint: "Open a regular http(s) job page and click Rescan.", tab: { url: tab.url || "", title: tab.title || "" } };
  }
  try {
    const injection = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: detectFields });
    return { fields: injection.flatMap((r) => r?.result || []), tab: { url: tab.url, title: tab.title } };
  } catch (err) {
    return { error: "Scan failed.", hint: err?.message || String(err), tab: { url: tab.url || "", title: tab.title || "" } };
  }
}

async function injectAutofillEngine(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: AUTOFILL_SCRIPT_FILES });
}

async function runAutofillEngine(tabId, plans) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async (incomingPlans) => {
      const JT = globalThis.JobTrackAutofill;
      if (!JT?.fillFields) {
        return incomingPlans.map((plan) => ({ index: plan.index, label: plan.label || "", category: plan.category || "unknown", controlType: plan.controlType || "unknown", attempted: plan.plannedValue ?? "", final: "", success: false, skipped: false, reason: "autofill engine did not load in this frame" }));
      }
      return JT.fillFields(incomingPlans);
    },
    args: [plans],
  });
}

async function fillFieldsInActiveTab(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return { results: [] };
  const tab = await getActiveWebTab();
  if (!tab?.id) return { error: "No active tab to fill.", hint: "Open the job application page and try again." };
  const blocked = pageBlockReason(tab.url);
  if (blocked) return { error: blocked };
  try {
    await injectAutofillEngine(tab.id);
    const injection = await runAutofillEngine(tab.id, plans);
    const byIndex = new Map();
    for (const result of injection.flatMap((r) => r?.result || [])) {
      const existing = byIndex.get(result.index);
      if (!existing || ["not in this frame", "autofill engine did not load in this frame"].includes(existing.reason) && !["not in this frame", "autofill engine did not load in this frame"].includes(result.reason)) {
        byIndex.set(result.index, result);
      }
    }
    return { results: Array.from(byIndex.values()).sort((a, b) => a.index - b.index) };
  } catch (err) {
    return { error: "Fill failed.", hint: err?.message || String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const task = msg?.type === "SCAN_ACTIVE_TAB" ? scanActiveTab()
    : msg?.type === "FILL_FIELDS" ? fillFieldsInActiveTab(msg.plans || [])
      : msg?.type === "GET_DEFAULT_PROFILE" ? getDefaultProfile()
        : null;
  if (!task) return false;
  task.then(sendResponse).catch((err) => sendResponse({ error: "Internal error.", hint: err?.message || String(err) }));
  return true;
});
