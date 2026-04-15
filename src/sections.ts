/** section identifiers for streaming responses */
export type Section = "corrected" | "suggested";

export interface SectionState {
  el: HTMLElement;
  indicator: HTMLElement;
  retryIcon: HTMLElement;
  latencyEl: HTMLElement;
  tokensEl: HTMLElement;
  accumulated: string;
  firstToken: boolean;
  done: boolean;
}

/* section dom references */

const correctedTextEl = document.getElementById("corrected-text")!;
const suggestedTextEl = document.getElementById("suggested-text")!;
const correctedIndicator = document.getElementById("corrected-indicator")!;
const suggestedIndicator = document.getElementById("suggested-indicator")!;
const retryCorrectedIcon = document.getElementById("retry-corrected")!;
const retrySuggestedIcon = document.getElementById("retry-suggested")!;
const latencyCorrectedEl = document.getElementById("latency-corrected")!;
const latencySuggestedEl = document.getElementById("latency-suggested")!;
const tokensCorrectedEl = document.getElementById("tokens-corrected")!;
const tokensSuggestedEl = document.getElementById("tokens-suggested")!;

export const sections: Record<Section, SectionState> = {
  corrected: {
    el: correctedTextEl,
    indicator: correctedIndicator,
    retryIcon: retryCorrectedIcon,
    latencyEl: latencyCorrectedEl,
    tokensEl: tokensCorrectedEl,
    accumulated: "",
    firstToken: true,
    done: false,
  },
  suggested: {
    el: suggestedTextEl,
    indicator: suggestedIndicator,
    retryIcon: retrySuggestedIcon,
    latencyEl: latencySuggestedEl,
    tokensEl: tokensSuggestedEl,
    accumulated: "",
    firstToken: true,
    done: false,
  },
};

/* injected layout refs (set by initSections) */

let loadingEl!: HTMLElement;
let errorEl!: HTMLElement;
let resultEl!: HTMLElement;
let errorMessageEl!: HTMLElement;

/** stored original text for retry requests */
let originalText = "";

export function getOriginalText(): string {
  return originalText;
}

/* init */

export interface RootRefs {
  loading: HTMLElement;
  error: HTMLElement;
  result: HTMLElement;
  errorMessage: HTMLElement;
}

export function initSections(refs: RootRefs): void {
  loadingEl = refs.loading;
  errorEl = refs.error;
  resultEl = refs.result;
  errorMessageEl = refs.errorMessage;

  setupCopyOnDone("corrected");
  setupCopyOnDone("suggested");
  setupRetryIcon("corrected");
  setupRetryIcon("suggested");
}

/* section ui helpers */

export function showStart(original: string): void {
  originalText = original;
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  resultEl.style.display = "block";

  const originalTextEl = document.getElementById("original-text")!;
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
  state.tokensEl.classList.remove("show");
  state.tokensEl.textContent = "";
}

export function showSectionStart(section: Section): void {
  const state = sections[section];
  state.el.textContent = "";
  state.el.appendChild(state.indicator);
  state.indicator.classList.remove("hidden");
  state.retryIcon.classList.remove("show");
}

export function appendToken(section: Section, token: string, latencyMs?: number): void {
  const state = sections[section];

  if (state.firstToken) {
    state.indicator.classList.add("hidden");
    state.el.textContent = "";
    state.firstToken = false;
  }

  if (latencyMs !== undefined) {
    state.latencyEl.textContent = `(TTFT: ${latencyMs}ms)`;
    state.latencyEl.classList.add("show");
  }

  state.accumulated += token;
  state.el.textContent = state.accumulated;

  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

export function showSectionDone(section: Section, completionTokens?: number): void {
  const state = sections[section];
  state.done = true;
  state.retryIcon.classList.remove("show");

  if (completionTokens !== undefined) {
    state.tokensEl.textContent = `(Tokens: ${completionTokens})`;
    state.tokensEl.classList.add("show");
  }
}

export function showSectionError(section: Section, message: string): void {
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

export function showError(message: string): void {
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
