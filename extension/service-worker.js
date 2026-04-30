import { detectFields } from "./content/detectFields.js";
import { fillFields } from "./content/fillFields.js";

// Open the side panel when the user clicks the action button. We do not
// inject anything from here on its own — scanning and filling happen only
// in response to explicit messages from the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[JobTrack] sidePanel.setPanelBehavior failed:", err));
});

// Returns a friendly reason if the URL is one Chrome blocks extensions on,
// or null if the page is scannable. We check this BEFORE executeScript so the
// user gets a clear message instead of an opaque permission error.
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

// Picks the user's actual web tab. lastFocusedWindow excludes the side panel /
// devtools windows so we never accidentally scan our own UI.
async function getActiveWebTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function scanActiveTab() {
  const tab = await getActiveWebTab();
  if (!tab?.id) {
    return { error: "No active tab to scan.", hint: "Open a job application page and try again." };
  }

  const blocked = pageBlockReason(tab.url);
  if (blocked) {
    return {
      error: blocked,
      hint: "Open a regular http(s) job page and click Rescan.",
      tab: { url: tab.url || "", title: tab.title || "" },
    };
  }

  try {
    // allFrames so ATS forms in iframes (Greenhouse, Lever, etc.) are caught.
    // Frames the extension can't access fail individually but the call still
    // resolves with successful frames' results.
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: detectFields,
    });
    const fields = injection.flatMap((r) => r?.result || []);
    return { fields, tab: { url: tab.url, title: tab.title } };
  } catch (err) {
    return {
      error: "Scan failed.",
      hint: err?.message || String(err),
      tab: { url: tab.url || "", title: tab.title || "" },
    };
  }
}

// Runs fillFields in every frame and merges results by plan index, keeping
// whichever frame's result is the most informative (an actual fill or
// already-filled wins over "not in this frame").
async function fillFieldsInActiveTab(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return { results: [] };
  }
  const tab = await getActiveWebTab();
  if (!tab?.id) {
    return { error: "No active tab to fill.", hint: "Open the job application page and try again." };
  }
  const blocked = pageBlockReason(tab.url);
  if (blocked) return { error: blocked };

  let injection;
  try {
    injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: fillFields,
      args: [plans],
    });
  } catch (err) {
    return { error: "Fill failed.", hint: err?.message || String(err) };
  }

  const all = injection.flatMap((r) => r?.result || []);
  const byIndex = new Map();
  for (const r of all) {
    const ex = byIndex.get(r.index);
    if (!ex) {
      byIndex.set(r.index, r);
      continue;
    }
    // Prefer a result that found the element over one that didn't.
    const exMissing = ex.reason === "not in this frame";
    const rMissing = r.reason === "not in this frame";
    if (exMissing && !rMissing) byIndex.set(r.index, r);
  }
  const results = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  return { results };
}

// Async message handler — must return true to keep the response channel open.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SCAN_ACTIVE_TAB") {
    scanActiveTab()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: "Internal error.", hint: err?.message || String(err) }));
    return true;
  }
  if (msg?.type === "FILL_FIELDS") {
    fillFieldsInActiveTab(msg.plans || [])
      .then(sendResponse)
      .catch((err) => sendResponse({ error: "Internal error.", hint: err?.message || String(err) }));
    return true;
  }
  return false;
});
