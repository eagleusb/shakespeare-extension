import { API_BASE_URL, STORAGE_KEY_API_URL } from "./config";

/* dom references */

const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;
const apiSavedEl = document.getElementById("api-saved")!;
const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const resultEl = document.getElementById("result")!;
const originalTextEl = document.getElementById("original-text")!;
const correctedTextEl = document.getElementById("corrected-text")!;
const suggestedTextEl = document.getElementById("suggested-text")!;
const correctedIndicator = document.getElementById("corrected-indicator")!;
const suggestedIndicator = document.getElementById("suggested-indicator")!;
const retryCorrectedIcon = document.getElementById("retry-corrected")!;
const retrySuggestedIcon = document.getElementById("retry-suggested")!;
const latencyCorrectedEl = document.getElementById("latency-corrected")!;
const latencySuggestedEl = document.getElementById("latency-suggested")!;

/* section state */

type Section = "corrected" | "suggested";

interface SectionState {
  el: HTMLElement;
  indicator: HTMLElement;
  retryIcon: HTMLElement;
  latencyEl: HTMLElement;
  accumulated: string;
  firstToken: boolean;
  done: boolean;
}

const sections: Record<Section, SectionState> = {
  corrected: {
    el: correctedTextEl,
    indicator: correctedIndicator,
    retryIcon: retryCorrectedIcon,
    latencyEl: latencyCorrectedEl,
    accumulated: "",
    firstToken: true,
    done: false,
  },
  suggested: {
    el: suggestedTextEl,
    indicator: suggestedIndicator,
    retryIcon: retrySuggestedIcon,
    latencyEl: latencySuggestedEl,
    accumulated: "",
    firstToken: true,
    done: false,
  },
};

/** stored original text for retry requests */
let originalText = "";

/* message types from background script */

type ResultMessage =
  | { type: "start"; original: string }
  | { type: "section-start"; section: Section }
  | { type: "stream"; section: Section; token: string; latencyMs?: number }
  | { type: "section-done"; section: Section }
  | { type: "section-error"; section: Section; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

/* message handler */

browser.runtime.onMessage.addListener((msg: ResultMessage) => {
  switch (msg.type) {
    case "start":
      showStart(msg.original);
      break;
    case "section-start":
      showSectionStart(msg.section);
      break;
    case "stream":
      appendToken(msg.section, msg.token, msg.latencyMs);
      break;
    case "section-done":
      showSectionDone(msg.section);
      break;
    case "section-error":
      showSectionError(msg.section, msg.message);
      break;
    case "done":
      break;
    case "error":
      showError(msg.message);
      break;
  }
});

/* ui helpers */

function showStart(original: string): void {
  originalText = original;
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  resultEl.style.display = "block";

  originalTextEl.textContent = original;

  for (const section of Object.keys(sections) as Section[]) {
    resetSection(section);
  }
}

function resetSection(section: Section): void {
  const state = sections[section];
  state.el.textContent = "";
  state.el.classList.remove("section-error");
  state.accumulated = "";
  state.firstToken = true;
  state.done = false;
  state.el.classList.remove("copied");
  state.retryIcon.classList.remove("show");
  state.latencyEl.classList.remove("show");
  state.latencyEl.textContent = "";
}

function showSectionStart(section: Section): void {
  const state = sections[section];
  state.el.textContent = "";
  state.el.appendChild(state.indicator);
  state.indicator.classList.remove("hidden");
  state.retryIcon.classList.remove("show");
}

function appendToken(section: Section, token: string, latencyMs?: number): void {
  const state = sections[section];

  if (state.firstToken) {
    state.indicator.classList.add("hidden");
    state.el.textContent = "";
    state.firstToken = false;
  }

  if (latencyMs !== undefined) {
    state.latencyEl.textContent = `${latencyMs}ms`;
    state.latencyEl.classList.add("show");
  }

  state.accumulated += token;
  state.el.textContent = state.accumulated;

  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function showSectionDone(section: Section): void {
  const state = sections[section];
  state.done = true;
  state.retryIcon.classList.remove("show");
}

function showSectionError(section: Section, message: string): void {
  const state = sections[section];

  /* hide and detach the streaming indicator */
  state.indicator.classList.add("hidden");
  state.indicator.remove();

  state.done = false;
  state.accumulated = "";
  state.el.textContent = message;
  state.el.classList.add("section-error");
  state.retryIcon.classList.add("show");
}

function showError(message: string): void {
  loadingEl.style.display = "none";
  resultEl.style.display = "none";
  errorEl.style.display = "block";

  errorMessageEl.textContent = message;
}

/* click-to-copy on content boxes */

function setupCopyOnDone(section: Section): void {
  const state = sections[section];

  state.el.addEventListener("click", async () => {
    if (!state.done || state.accumulated.length === 0) {
      return;
    }

    try {
      await navigator.clipboard.writeText(state.accumulated);
      state.el.classList.add("copied");
      setTimeout(() => state.el.classList.remove("copied"), 2_000);
    } catch {
      /* silently ignore clipboard failures */
    }
  });
}

setupCopyOnDone("corrected");
setupCopyOnDone("suggested");

/* retry icons */

function setupRetryIcon(section: Section): void {
  const state = sections[section];

  state.retryIcon.addEventListener("click", () => {
    state.el.classList.remove("section-error");
    resetSection(section);
    showSectionStart(section);

    browser.runtime.sendMessage({
      type: "retry",
      section,
      original: originalText,
    });
  });
}

setupRetryIcon("corrected");
setupRetryIcon("suggested");

/* api url settings */

/** load stored api url into the input field on popup open */
browser.storage.local.get(STORAGE_KEY_API_URL).then((result) => {
  const stored = result[STORAGE_KEY_API_URL];
  apiUrlInput.value = typeof stored === "string" && stored.length > 0
    ? stored
    : API_BASE_URL;
});

/** save api url to storage on change */
apiUrlInput.addEventListener("change", () => {
  const value = apiUrlInput.value.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    browser.storage.local.set({ [STORAGE_KEY_API_URL]: value }).then(() => {
      apiSavedEl.classList.add("show");
      setTimeout(() => apiSavedEl.classList.remove("show"), 2_000);
    });
  }
});

/* signal readiness to background script */

browser.runtime.sendMessage({ type: "ready" });
