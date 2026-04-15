import { streamCorrection, ApiError, checkHealth } from "./api";
import type { StreamResult } from "./api";
import { validateInput, ValidationError } from "./validation";
import {
  PROMPTS,
  API_BASE_URL,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_LANGUAGE,
  DEFAULT_LANGUAGE,
} from "./config";
import type { Language } from "./config";

/** context menu item id */
const MENU_ID = "shakespeare-selection";
const SETTINGS_MENU_ID = "shakespeare-settings";

/** section identifiers for streaming responses */
type Section = "corrected" | "suggested";

/** pending state for a popup window that hasn't signalled "ready" yet */
interface PendingResult {
  tabId: number;
  resolve: () => void;
}

let pending: PendingResult | null = null;

/* storage helpers */

/** reads the configured api base url from storage, falling back to the default */
async function getApiBaseUrl(): Promise<string> {
  const result = await browser.storage.local.get(STORAGE_KEY_API_URL);
  const stored = result[STORAGE_KEY_API_URL];
  return typeof stored === "string" && stored.length > 0 ? stored : API_BASE_URL;
}

/** reads the selected prompt language from storage, falling back to the default */
async function getLanguage(): Promise<Language> {
  const result = await browser.storage.local.get(STORAGE_KEY_LANGUAGE);
  const stored = result[STORAGE_KEY_LANGUAGE];
  return stored === "en" || stored === "fr" ? stored : DEFAULT_LANGUAGE;
}

/* context menu setup */

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "shakespeare correction (selection)",
    contexts: ["selection"],
  });

  browser.contextMenus.create({
    id: SETTINGS_MENU_ID,
    title: "shakespeare settings",
    contexts: ["all"],
  });
});

/* message handler (result tab readiness + retry) */

browser.runtime.onMessage.addListener((msg: { type: string }, sender, sendResponse) => {
  if (msg.type === "ready") {
    if (pending) {
      pending.resolve();
    }
    return;
  }

  if (msg.type === "retry") {
    const retryMsg = msg as { type: "retry"; section: Section; original: string };
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }
    handleRetry(tabId, retryMsg.section, retryMsg.original);
    return;
  }

  if (msg.type === "check-health") {
    const healthMsg = msg as { type: "check-health"; url: string };
    checkHealth(healthMsg.url).then(sendResponse);
    return true;
  }
});

/* context menu click handler */

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === SETTINGS_MENU_ID) {
    await browser.windows.create({
      type: "popup",
      url: browser.runtime.getURL("result.html?mode=settings"),
      width: 600,
      height: 200,
    });
    return;
  }

  if (info.menuItemId !== MENU_ID) {
    return;
  }

  /* 1. validate input */
  let inputText: string;
  try {
    inputText = validateInput(info.selectionText);
  } catch (err: unknown) {
    const msg = err instanceof ValidationError ? err.message : "Invalid text selection.";
    openPopupWithError(msg);
    return;
  }

  /* 2. open popup immediately (shows loading spinner) */
  const window = await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("result.html"),
    width: 700,
    height: 500,
  });

  const tab = window.tabs?.[0];
  if (!tab?.id) {
    return;
  }
  const tabId = tab.id;

  /* 3. wait for the result tab to signal "ready" */
  const readyPromise = new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  await readyPromise;
  pending = null;

  /* 4. tell the result tab to show the original text */
  await browser.tabs.sendMessage(tabId, {
    type: "start",
    original: inputText,
  });

  /* 5. sequential streaming with per-section error handling */
  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();

  const correctedOk = await attemptStreamSection(tabId, inputText, "corrected", baseUrl, language);

  if (correctedOk) {
    await attemptStreamSection(tabId, inputText, "suggested", baseUrl, language);
  }

  await browser.tabs.sendMessage(tabId, { type: "done" });
});

/**
 * attempts to stream a section. on success sends section-done.
 * on failure sends section-error with the error message.
 * returns true if the section completed successfully.
 */
async function attemptStreamSection(
  tabId: number,
  text: string,
  section: Section,
  baseUrl: string,
  language: Language,
): Promise<boolean> {
  try {
    const systemPrompt = PROMPTS[language][section === "corrected" ? "correct" : "suggest"];
    await streamSection(tabId, text, systemPrompt, section, baseUrl);
    return true;
  } catch (err: unknown) {
    const msg =
      err instanceof ApiError || err instanceof ValidationError
        ? err.message
        : "An unexpected error occurred.";
    await browser.tabs.sendMessage(tabId, { type: "section-error", section, message: msg });
    return false;
  }
}

/** stream a single section from the api, measuring ttft latency */
async function streamSection(
  tabId: number,
  text: string,
  systemPrompt: string,
  section: Section,
  baseUrl: string,
): Promise<void> {
  await browser.tabs.sendMessage(tabId, { type: "section-start", section });

  const t0 = Date.now();
  let firstToken = true;
  const result: StreamResult = {};

  for await (const token of streamCorrection(text, systemPrompt, baseUrl, result)) {
    const latencyMs = firstToken ? Date.now() - t0 : undefined;
    firstToken = false;

    await browser.tabs.sendMessage(tabId, {
      type: "stream",
      section,
      token,
      latencyMs,
    });
  }

  await browser.tabs.sendMessage(tabId, {
    type: "section-done",
    section,
    completionTokens: result.completionTokens,
  });
}

/* retry handler */

async function handleRetry(tabId: number, section: Section, original: string): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();
  await attemptStreamSection(tabId, original, section, baseUrl, language);
}

/** open popup with an error when validation fails immediately */
async function openPopupWithError(message: string): Promise<void> {
  const window = await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("result.html"),
    width: 600,
    height: 400,
  });

  const tab = window.tabs?.[0];
  if (!tab?.id) {
    return;
  }
  const tabId = tab.id;

  const readyPromise = new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  await readyPromise;
  pending = null;

  await browser.tabs.sendMessage(tabId, { type: "error", message });
}
