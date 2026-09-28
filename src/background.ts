import { streamCorrection, ApiError, checkHealth } from "./api";
import type { StreamResult } from "./api";
import { validateInput, ValidationError } from "./validation";
import {
  PROMPTS,
  API_BASE_URL,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_API_SETTINGS,
  STORAGE_KEY_LANGUAGE,
  DEFAULT_LANGUAGE,
  normalizeApiSettings,
} from "./config";
import type { ApiSettings, Language } from "./config";

const MENU_ID = "shakespeare-selection";
const SETTINGS_MENU_ID = "shakespeare-settings";

type Section = "corrected" | "suggested";

interface PendingResult {
  tabId: number;
  resolve: () => void;
}

let pending: PendingResult | null = null;

let activePopupWindowId: number | null = null;
let activePopupTabId: number | null = null;

let activeSettingsWindowId: number | null = null;

let streamGeneration = 0;

let streamAbort: AbortController | null = null;

browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === activePopupWindowId) {
    activePopupWindowId = null;
    activePopupTabId = null;
  }
  if (windowId === activeSettingsWindowId) {
    activeSettingsWindowId = null;
  }
});

async function getApiBaseUrl(): Promise<string> {
  const result = await browser.storage.local.get(STORAGE_KEY_API_URL);
  const stored = result[STORAGE_KEY_API_URL];
  return typeof stored === "string" && stored.length > 0
    ? stored
    : API_BASE_URL;
}

async function getLanguage(): Promise<Language> {
  const result = await browser.storage.local.get(STORAGE_KEY_LANGUAGE);
  const stored = result[STORAGE_KEY_LANGUAGE];
  return stored === "en" || stored === "fr" ? stored : DEFAULT_LANGUAGE;
}

async function getApiSettings(): Promise<ApiSettings> {
  const result = await browser.storage.local.get(STORAGE_KEY_API_SETTINGS);
  return normalizeApiSettings(result[STORAGE_KEY_API_SETTINGS]);
}

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

browser.runtime.onMessage.addListener(
  (msg: { type: string }, sender, sendResponse) => {
    if (msg.type === "ready") {
      if (pending) {
        pending.resolve();
      }
      return;
    }

    if (msg.type === "retry") {
      const retryMsg = msg as {
        type: "retry";
        section: Section;
        original: string;
      };
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
  },
);

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

  await new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  pending = null;

  return { tabId };
}

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
      height: 360,
    });
    activeSettingsWindowId = win.id!;
    return;
  }

  if (info.menuItemId !== MENU_ID) {
    return;
  }

  streamGeneration++;
  const myGen = streamGeneration;

  if (streamAbort) {
    streamAbort.abort();
  }
  streamAbort = new AbortController();

  let inputText: string;
  try {
    inputText = validateInput(info.selectionText);
  } catch (err: unknown) {
    const msg =
      err instanceof ValidationError ? err.message : "Invalid text selection.";
    openPopupWithError(msg, myGen);
    return;
  }

  const { tabId } = await getOrCreatePopup();

  if (myGen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, {
    type: "start",
    original: inputText,
  });

  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();
  const apiSettings = await getApiSettings();

  const correctedOk = await attemptStreamSection(
    tabId,
    inputText,
    "corrected",
    baseUrl,
    language,
    apiSettings,
    myGen,
    streamAbort.signal,
  );

  if (correctedOk && myGen === streamGeneration) {
    await attemptStreamSection(
      tabId,
      inputText,
      "suggested",
      baseUrl,
      language,
      apiSettings,
      myGen,
      streamAbort.signal,
    );
  }

  if (myGen === streamGeneration) {
    await browser.tabs.sendMessage(tabId, { type: "done" });
  }
});

async function attemptStreamSection(
  tabId: number,
  text: string,
  section: Section,
  baseUrl: string,
  language: Language,
  apiSettings: ApiSettings,
  gen: number,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const systemPrompt =
      PROMPTS[language][section === "corrected" ? "correct" : "suggest"];
    await streamSection(
      tabId,
      text,
      systemPrompt,
      section,
      baseUrl,
      apiSettings,
      gen,
      signal,
    );
    return true;
  } catch (err: unknown) {
    if (gen !== streamGeneration) return false;

    const msg =
      err instanceof ApiError || err instanceof ValidationError
        ? err.message
        : "An unexpected error occurred.";
    await browser.tabs.sendMessage(tabId, {
      type: "section-error",
      section,
      message: msg,
    });
    return false;
  }
}

async function streamSection(
  tabId: number,
  text: string,
  systemPrompt: string,
  section: Section,
  baseUrl: string,
  apiSettings: ApiSettings,
  gen: number,
  signal: AbortSignal,
): Promise<void> {
  if (gen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, { type: "section-start", section });

  const t0 = Date.now();
  let firstToken = true;
  const result: StreamResult = {};

  for await (const token of streamCorrection(
    text,
    systemPrompt,
    baseUrl,
    result,
    signal,
    apiSettings,
  )) {
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

async function handleRetry(
  tabId: number,
  section: Section,
  original: string,
): Promise<void> {
  streamGeneration++;
  const myGen = streamGeneration;

  if (streamAbort) {
    streamAbort.abort();
  }
  streamAbort = new AbortController();

  const baseUrl = await getApiBaseUrl();
  const language = await getLanguage();
  const apiSettings = await getApiSettings();
  await attemptStreamSection(
    tabId,
    original,
    section,
    baseUrl,
    language,
    apiSettings,
    myGen,
    streamAbort.signal,
  );
}

async function openPopupWithError(message: string, gen: number): Promise<void> {
  const { tabId } = await getOrCreatePopup();

  if (gen !== streamGeneration) return;
  await browser.tabs.sendMessage(tabId, { type: "error", message });
}
