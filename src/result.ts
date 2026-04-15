// ─── DOM references ────────────────────────────────────────────────────────

const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const resultEl = document.getElementById("result")!;
const originalTextEl = document.getElementById("original-text")!;
const correctedTextEl = document.getElementById("corrected-text")!;
const suggestedTextEl = document.getElementById("suggested-text")!;
const correctedIndicator = document.getElementById("corrected-indicator")!;
const suggestedIndicator = document.getElementById("suggested-indicator")!;
const copyCorrectedBtn = document.getElementById("copy-corrected-btn") as HTMLButtonElement;
const copySuggestedBtn = document.getElementById("copy-suggested-btn") as HTMLButtonElement;

// ─── Section state ─────────────────────────────────────────────────────────

type Section = "corrected" | "suggested";

interface SectionState {
  el: HTMLElement;
  indicator: HTMLElement;
  copyBtn: HTMLButtonElement;
  accumulated: string;
  firstToken: boolean;
}

const sections: Record<Section, SectionState> = {
  corrected: {
    el: correctedTextEl,
    indicator: correctedIndicator,
    copyBtn: copyCorrectedBtn,
    accumulated: "",
    firstToken: true,
  },
  suggested: {
    el: suggestedTextEl,
    indicator: suggestedIndicator,
    copyBtn: copySuggestedBtn,
    accumulated: "",
    firstToken: true,
  },
};

// ─── Message types from background script ──────────────────────────────────

type ResultMessage =
  | { type: "start"; original: string }
  | { type: "section-start"; section: Section }
  | { type: "stream"; section: Section; token: string }
  | { type: "section-done"; section: Section }
  | { type: "done" }
  | { type: "error"; message: string };

// ─── Message handler ───────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg: ResultMessage) => {
  switch (msg.type) {
    case "start":
      showStart(msg.original);
      break;
    case "section-start":
      showSectionStart(msg.section);
      break;
    case "stream":
      appendToken(msg.section, msg.token);
      break;
    case "section-done":
      showSectionDone(msg.section);
      break;
    case "done":
      break;
    case "error":
      showError(msg.message);
      break;
  }
});

// ─── UI helpers ────────────────────────────────────────────────────────────

function showStart(original: string): void {
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  resultEl.style.display = "block";

  originalTextEl.textContent = original;

  for (const state of Object.values(sections)) {
    state.el.textContent = "";
    state.accumulated = "";
    state.firstToken = true;
    state.copyBtn.disabled = true;
  }
}

function showSectionStart(section: Section): void {
  const state = sections[section];
  state.el.textContent = "";
  state.el.appendChild(state.indicator);
  state.indicator.classList.remove("hidden");
}

function appendToken(section: Section, token: string): void {
  const state = sections[section];

  if (state.firstToken) {
    state.indicator.classList.add("hidden");
    state.el.textContent = "";
    state.firstToken = false;
  }

  state.accumulated += token;
  state.el.textContent = state.accumulated;
}

function showSectionDone(section: Section): void {
  sections[section].copyBtn.disabled = false;
}

function showError(message: string): void {
  loadingEl.style.display = "none";
  resultEl.style.display = "none";
  errorEl.style.display = "block";

  errorMessageEl.textContent = message;
}

// ─── Copy buttons ──────────────────────────────────────────────────────────

function setupCopyButton(btn: HTMLButtonElement, label: string): void {
  btn.addEventListener("click", async () => {
    const text = btn.closest(".section")?.querySelector(".section-content")?.textContent;
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove("copied");
      }, 2_000);
    } catch {
      btn.textContent = "Copy failed";
      setTimeout(() => {
        btn.textContent = label;
      }, 2_000);
    }
  });
}

setupCopyButton(copyCorrectedBtn, "Copy corrected");
setupCopyButton(copySuggestedBtn, "Copy suggested");

// ─── Signal readiness to background script ─────────────────────────────────

browser.runtime.sendMessage({ type: "ready" });
