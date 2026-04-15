import { streamCorrection, ApiError } from "./api";
import { validateInput, ValidationError } from "./validation";
import { CORRECT_PROMPT, SUGGEST_PROMPT } from "./config";

/** Context menu item ID. */
const MENU_ID = "correct-with-llamacpp";

/** Section identifiers for streaming responses. */
type Section = "corrected" | "suggested";

/**
 * Pending state for a popup window that hasn't signalled "ready" yet.
 */
interface PendingResult {
  tabId: number;
  resolve: () => void;
}

let pending: PendingResult | null = null;

// ─── Context menu setup ────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "shakespeare edit (selection)",
    contexts: ["selection"],
  });
});

// ─── Message handler (result tab readiness) ────────────────────────────────

browser.runtime.onMessage.addListener((msg: { type: string }) => {
  if (msg.type === "ready") {
    if (pending) {
      pending.resolve();
    }
  }
});

// ─── Context menu click handler ────────────────────────────────────────────

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  // 1. Validate input
  let inputText: string;
  try {
    inputText = validateInput(info.selectionText);
  } catch (err: unknown) {
    const msg = err instanceof ValidationError ? err.message : "Invalid text selection.";
    openPopupWithError(msg);
    return;
  }

  // 2. Open popup immediately (shows loading spinner)
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

  // 3. Wait for the result tab to signal "ready"
  const readyPromise = new Promise<void>((resolve) => {
    pending = { tabId, resolve };
  });
  await readyPromise;
  pending = null;

  // 4. Tell the result tab to show the original text
  await browser.tabs.sendMessage(tabId, {
    type: "start",
    original: inputText,
  });

  // 5. Sequential streaming: corrected first, then suggested
  try {
    await streamSection(tabId, inputText, CORRECT_PROMPT, "corrected");
    await streamSection(tabId, inputText, SUGGEST_PROMPT, "suggested");
    await browser.tabs.sendMessage(tabId, { type: "done" });
  } catch (err: unknown) {
    const msg =
      err instanceof ApiError || err instanceof ValidationError
        ? err.message
        : "An unexpected error occurred.";
    await browser.tabs.sendMessage(tabId, { type: "error", message: msg });
  }
});

// ─── Stream a single section from the API ──────────────────────────────────

async function streamSection(
  tabId: number,
  text: string,
  systemPrompt: string,
  section: Section,
): Promise<void> {
  await browser.tabs.sendMessage(tabId, { type: "section-start", section });

  for await (const token of streamCorrection(text, systemPrompt)) {
    await browser.tabs.sendMessage(tabId, {
      type: "stream",
      section,
      token,
    });
  }

  await browser.tabs.sendMessage(tabId, { type: "section-done", section });
}

// ─── Helper: open popup with an error when validation fails immediately ────

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
