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

/** tracked popup window for reuse across corrections */
let activePopupWindowId: number | null = null;
let activePopupTabId: number | null = null;

/** tracked settings popup window for reuse */
let activeSettingsWindowId: number | null = null;

/** monotonic counter to invalidate stale stream sends */
let streamGeneration = 0;

/** abort controller for the current in-flight stream (if any) */
let streamAbort: AbortController | null = null;

/** clear popup tracking when the user closes the window */
browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === activePopupWindowId) {
    activePopupWindowId = null;
    activePopupTabId = null;
  }
  if (windowId === activeSettingsWindowId) {
    activeSettingsWindowId = null;
  }
});

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

/* popup lifecycle */

/** reuse or create the result popup. skips the "ready" handshake for existing popups. */
async function getOrCreatePopup(): Promise<{ tabId: number }> {
  if (activePopupWindowId !== null && activePopupTabId !== null) {
    try {
      await browser.windows.get(activePopupWindowId);
      await browser.windows.update(activePopupWindowId, { focused: true });
      return { tabId: activePopupTabId };
    } catch {
      activePopupWindowId = null;
      activePopupTabId = null;
    }
  }

  const win = await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("result.html"),
    width: 700,
    height: 500,
  });

  const tabId = win.tabs![0].id!;
  activePopupWindowId = win.id!;
  activePopupTabId = tabId;

  /* wait for the new tab to signal "ready" */
  await new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  pending = null;

  return { tabId };
}

/* context menu click handler */

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === SETTINGS_MENU_ID) {
    if (activeSettingsWindowId !== null) {
      try {
        await browser.windows.get(activeSettingsWindowId);
        await browser.windows.update(activeSettingsWindowId, { focused: true });
        return;
      } catch {
        activeSettingsWindowId = null;
      }
    }

    const win = await browser.windows.create({
      type: "popup",
      url: browser.runtime.getURL("result.html?mode=settings"),
      width: 600,
      height: 200,
    });
    activeSettingsWindowId = win.id!;
    return;
  }

  if (info.menuItemId !== MENU_ID) {
    return;
  }

  /* 1. abort any in-flight stream and bump generation */
  streamGeneration++;
  const myGen = streamGeneration;

  if (streamAbort) {
    streamAbort.abort();
  }
  streamAbort = new AbortController();

  /* 2. validate input */
  let inputText: string;
  try {
    inputText = validateInput(info.selectionText);
  } catch (err: unknown) {
    const msg = err instanceof ValidationError ? err.message : "Invalid text selection.";
    openPopupWithError(msg, myGen);
    return;
  }

  /* 3. get or create popup */
  const { tabId } = await getOrCreatePopup();

  /* 4. tell the result tab to show the original text */
  if (myGen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, {
    type: "start",
    original: inputText,
  });

  /* 5. sequential streaming with per-section error handling */
  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();

  const correctedOk = await attemptStreamSection(
    tabId, inputText, "corrected", baseUrl, language, myGen, streamAbort.signal,
  );

  if (correctedOk && myGen === streamGeneration) {
    await attemptStreamSection(
      tabId, inputText, "suggested", baseUrl, language, myGen, streamAbort.signal,
    );
  }

  if (myGen === streamGeneration) {
    await browser.tabs.sendMessage(tabId, { type: "done" });
  }
});

/**
 * attempts to stream a section. on success sends section-done.
 * on failure sends section-error with the error message.
 * returns true if the section completed successfully.
 *
 * @param gen - generation counter; stale sends are silently dropped
 * @param signal - abort signal to cancel the http stream
 */
async function attemptStreamSection(
  tabId: number,
  text: string,
  section: Section,
  baseUrl: string,
  language: Language,
  gen: number,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const systemPrompt = PROMPTS[language][section === "corrected" ? "correct" : "suggest"];
    await streamSection(tabId, text, systemPrompt, section, baseUrl, gen, signal);
    return true;
  } catch (err: unknown) {
    if (gen !== streamGeneration) return false;

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
  gen: number,
  signal: AbortSignal,
): Promise<void> {
  if (gen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, { type: "section-start", section });

  const t0 = Date.now();
  let firstToken = true;
  const result: StreamResult = {};

  for await (const token of streamCorrection(text, systemPrompt, baseUrl, result, signal)) {
    if (gen !== streamGeneration) return;

    const latencyMs = firstToken ? Date.now() - t0 : undefined;
    firstToken = false;

    await browser.tabs.sendMessage(tabId, {
      type: "stream",
      section,
      token,
      latencyMs,
    });
  }

  if (gen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, {
    type: "section-done",
    section,
    completionTokens: result.completionTokens,
  });
}

/* retry handler */

async function handleRetry(tabId: number, section: Section, original: string): Promise<void> {
  streamGeneration++;
  const myGen = streamGeneration;

  if (streamAbort) {
    streamAbort.abort();
  }
  streamAbort = new AbortController();

  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();
  await attemptStreamSection(tabId, original, section, baseUrl, language, myGen, streamAbort.signal);
}

/** reuse or create popup to show an error when validation fails */
async function openPopupWithError(message: string, gen: number): Promise<void> {
  const { tabId } = await getOrCreatePopup();

  if (gen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, { type: "error", message });
}
