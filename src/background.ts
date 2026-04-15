import { streamCorrection, ApiError } from "./api";
import { validateInput, ValidationError } from "./validation";
import { CORRECT_PROMPT, SUGGEST_PROMPT, API_BASE_URL, STORAGE_KEY_API_URL } from "./config";

/** context menu item id */
const MENU_ID = "correct-with-llamacpp";

/** section identifiers for streaming responses */
type Section = "corrected" | "suggested";

/** maps a section to its system prompt */
const SECTION_PROMPTS: Record<Section, string> = {
  corrected: CORRECT_PROMPT,
  suggested: SUGGEST_PROMPT,
};

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

/* context menu setup */

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "shakespeare edit (selection)",
    contexts: ["selection"],
  });
});

/* message handler (result tab readiness + retry) */

browser.runtime.onMessage.addListener((msg: { type: string }, sender) => {
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
  }
});

/* context menu click handler */

browser.contextMenus.onClicked.addListener(async (info) => {
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

  const correctedOk = await attemptStreamSection(tabId, inputText, "corrected", baseUrl);

  if (correctedOk) {
    await attemptStreamSection(tabId, inputText, "suggested", baseUrl);
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
): Promise<boolean> {
  try {
    await streamSection(tabId, text, SECTION_PROMPTS[section], section, baseUrl);
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

  for await (const token of streamCorrection(text, systemPrompt, baseUrl)) {
    const latencyMs = firstToken ? Date.now() - t0 : undefined;
    firstToken = false;

    await browser.tabs.sendMessage(tabId, {
      type: "stream",
      section,
      token,
      latencyMs,
    });
  }

  await browser.tabs.sendMessage(tabId, { type: "section-done", section });
}

/* retry handler */

async function handleRetry(tabId: number, section: Section, original: string): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  await attemptStreamSection(tabId, original, section, baseUrl);
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
