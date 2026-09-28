import type { StreamResult } from "./api";
import { ApiError, checkHealth, streamCorrection } from "./api";
import type { ApiSettings, Language } from "./config";
import {
  API_BASE_URL,
  DEFAULT_LANGUAGE,
  normalizeApiSettings,
  normalizePromptOverrides,
  STORAGE_KEY_API_SETTINGS,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_LANGUAGE,
  STORAGE_KEY_PROMPTS,
} from "./config";
import { ValidationError, validateInput } from "./validation";

const MENU_ID = "shakespeare-selection";
const SETTINGS_MENU_ID = "shakespeare-settings";
const EXTENSION_ROOT = browser.runtime.getURL("");
const RESULT_URL = browser.runtime.getURL("result.html");
const SETTINGS_URL = browser.runtime.getURL("result.html?mode=settings");

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details.originUrl?.startsWith(EXTENSION_ROOT)) {
      return;
    }

    return {
      requestHeaders: details.requestHeaders?.filter((header) => {
        const name = header.name.toLowerCase();
        return name !== "origin" && name !== "cookie";
      }),
    };
  },
  { urls: ["http://127.0.0.1/*", "http://localhost/*"] },
  ["blocking", "requestHeaders"],
);

type Section = "corrected" | "suggested";

interface PendingResult {
  tabId: number;
  resolve: () => void;
}

let pending: PendingResult | null = null;

let streamGeneration = 0;

let streamAbort: AbortController | null = null;

async function findPopup(
  url: string,
): Promise<{ windowId: number; tabId: number } | null> {
  const windows = await browser.windows.getAll({
    populate: true,
    windowTypes: ["popup"],
  });

  for (const window of windows) {
    const tab = window.tabs?.find((candidate) => candidate.url === url);
    if (window.id !== undefined && tab?.id !== undefined) {
      return { windowId: window.id, tabId: tab.id };
    }
  }

  return null;
}

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

async function getPromptOverrides() {
  const result = await browser.storage.local.get(STORAGE_KEY_PROMPTS);
  return normalizePromptOverrides(result[STORAGE_KEY_PROMPTS]);
}

async function openSettingsWindow(): Promise<void> {
  const existing = await findPopup(SETTINGS_URL);
  if (existing) {
    await browser.windows.update(existing.windowId, { focused: true });
    return;
  }

  await browser.windows.create({
    type: "popup",
    url: SETTINGS_URL,
    width: 900,
    height: 760,
  });
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
      if (pending && sender.tab?.id === pending.tabId) {
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
      void (async () => {
        const settings = await getApiSettings();
        sendResponse(await checkHealth(healthMsg.url, settings.apiKey));
      })();
      return true;
    }

    if (msg.type === "open-settings") {
      void (async () => {
        await openSettingsWindow();
        sendResponse({ ok: true });
      })();
      return true;
    }
  },
);

async function getOrCreatePopup(): Promise<{ tabId: number }> {
  const existing = await findPopup(RESULT_URL);
  if (existing) {
    await browser.windows.update(existing.windowId, { focused: true });
    return { tabId: existing.tabId };
  }

  const win = await browser.windows.create({
    type: "popup",
    url: RESULT_URL,
    width: 900,
    height: 760,
  });

  const tabId = win.tabs![0].id!;

  await new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  pending = null;

  return { tabId };
}

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === SETTINGS_MENU_ID) {
    await openSettingsWindow();
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
    const prompts = await getPromptOverrides();
    const systemPrompt =
      prompts[language][section === "corrected" ? "correct" : "suggest"];
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
