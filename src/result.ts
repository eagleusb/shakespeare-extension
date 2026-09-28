import {
  initSections,
  showStart,
  showSectionStart,
  appendToken,
  showSectionDone,
  showSectionError,
  showError,
} from "./sections";
import { initSettings } from "./settings";
import type { Section } from "./sections";

const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const resultEl = document.getElementById("result")!;

type ResultMessage =
  | { type: "start"; original: string }
  | { type: "section-start"; section: Section }
  | { type: "stream"; section: Section; token: string; latencyMs?: number }
  | { type: "section-done"; section: Section; completionTokens?: number }
  | { type: "section-error"; section: Section; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

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
      showSectionDone(msg.section, msg.completionTokens);
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

initSections({
  loading: loadingEl,
  error: errorEl,
  result: resultEl,
  errorMessage: errorMessageEl,
});
initSettings();

const settingsMode =
  new URLSearchParams(location.search).get("mode") === "settings";

if (settingsMode) {
  loadingEl.style.display = "none";
} else {
  browser.runtime.sendMessage({ type: "ready" });
}
