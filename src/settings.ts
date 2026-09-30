import type { ApiSettings, Language, PromptOverrides } from "./config";
import {
  API_BASE_URL,
  DEFAULT_API_SETTINGS,
  DEFAULT_LANGUAGE,
  normalizeApiSettings,
  normalizePromptOverrides,
  PROMPTS,
  STORAGE_KEY_API_SETTINGS,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_LANGUAGE,
  STORAGE_KEY_PROMPTS,
} from "./config";

declare const __EXTENSION_COMMIT__: string;

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;
const apiSavedEl = document.getElementById("api-saved")!;
const healthDotEl = document.getElementById("health-dot")!;
const langEnBtn = document.getElementById("lang-en")!;
const langFrBtn = document.getElementById("lang-fr")!;
const apiModelInput = document.getElementById("api-model") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const temperatureInput = document.getElementById(
  "api-temperature",
) as HTMLInputElement;
const maxTokensInput = document.getElementById(
  "api-max-tokens",
) as HTMLInputElement;
const topPInput = document.getElementById("api-top-p") as HTMLInputElement;
const frequencyPenaltyInput = document.getElementById(
  "api-frequency-penalty",
) as HTMLInputElement;
const presencePenaltyInput = document.getElementById(
  "api-presence-penalty",
) as HTMLInputElement;
const extensionVersionEl = document.getElementById("extension-version")!;
type PromptKind = "correct" | "suggest";

const promptButtons: Record<Language, Record<PromptKind, HTMLButtonElement>> = {
  en: {
    correct: document.getElementById(
      "edit-prompt-en-correct",
    ) as HTMLButtonElement,
    suggest: document.getElementById(
      "edit-prompt-en-suggest",
    ) as HTMLButtonElement,
  },
  fr: {
    correct: document.getElementById(
      "edit-prompt-fr-correct",
    ) as HTMLButtonElement,
    suggest: document.getElementById(
      "edit-prompt-fr-suggest",
    ) as HTMLButtonElement,
  },
};
const promptDialog = document.getElementById(
  "prompt-dialog",
) as HTMLDialogElement;
const promptDialogForm = document.getElementById(
  "prompt-dialog-form",
) as HTMLFormElement;
const promptDialogTitle = document.getElementById("prompt-dialog-title")!;
const promptDialogText = document.getElementById(
  "prompt-dialog-text",
) as HTMLTextAreaElement;
const promptDialogClose = document.getElementById("prompt-dialog-close")!;
const promptDialogCancel = document.getElementById("prompt-dialog-cancel")!;
const promptUseDefault = document.getElementById("prompt-use-default")!;
const promptLanguages: Language[] = ["en", "fr"];
const promptKinds: PromptKind[] = ["correct", "suggest"];
let promptOverrides = normalizePromptOverrides(undefined);
let activePrompt: { language: Language; kind: PromptKind } | null = null;
let currentApiUrl = API_BASE_URL;
let healthCheckRunning = false;
let healthCheckRequested = false;

const LANG_BTNS: Record<Language, HTMLElement> = {
  en: langEnBtn,
  fr: langFrBtn,
};

async function checkApiHealth(): Promise<void> {
  healthCheckRequested = true;
  if (healthCheckRunning) {
    return;
  }

  healthCheckRunning = true;
  try {
    while (healthCheckRequested) {
      healthCheckRequested = false;
      const url = currentApiUrl;
      const ok = await browser.runtime
        .sendMessage({ type: "check-health", url })
        .catch(() => false);
      if (url === currentApiUrl) {
        healthDotEl.className = "health-dot";
        healthDotEl.classList.add(ok ? "ok" : "fail");
        healthDotEl.title = `Last checked: ${new Date().toLocaleString()} (${ok ? "reachable" : "unavailable"})`;
      }
    }
  } finally {
    healthCheckRunning = false;
  }
}

function setActiveLang(lang: Language): void {
  for (const [key, btn] of Object.entries(LANG_BTNS)) {
    btn.classList.toggle("active", key === lang);
  }
}

function setApiSettings(settings: ApiSettings): void {
  apiModelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
  temperatureInput.value = String(settings.temperature);
  maxTokensInput.value = String(settings.max_tokens);
  topPInput.value = String(settings.top_p);
  frequencyPenaltyInput.value = String(settings.frequency_penalty);
  presencePenaltyInput.value = String(settings.presence_penalty);
}

function getApiSettingsFromInputs(): ApiSettings {
  return normalizeApiSettings({
    model: apiModelInput.value,
    apiKey: apiKeyInput.value,
    temperature: temperatureInput.valueAsNumber,
    max_tokens: maxTokensInput.valueAsNumber,
    top_p: topPInput.valueAsNumber,
    frequency_penalty: frequencyPenaltyInput.valueAsNumber,
    presence_penalty: presencePenaltyInput.valueAsNumber,
  });
}

function showSaved(): void {
  apiSavedEl.classList.add("show");
  setTimeout(() => apiSavedEl.classList.remove("show"), 2_000);
}

async function saveApiSettings(): Promise<void> {
  const settings = getApiSettingsFromInputs();
  setApiSettings(settings);
  await browser.storage.local.set({ [STORAGE_KEY_API_SETTINGS]: settings });
  showSaved();
}

function setPromptOverrides(prompts: PromptOverrides): void {
  promptOverrides = prompts;
  for (const language of promptLanguages) {
    for (const kind of promptKinds) {
      const status = promptButtons[language][kind].querySelector(
        ".prompt-edit-status",
      )!;
      status.textContent =
        prompts[language][kind] === PROMPTS[language][kind]
          ? "Default prompt"
          : "Custom prompt";
    }
  }
}

function promptName(language: Language, kind: PromptKind): string {
  const languageName = language === "en" ? "English" : "French";
  const kindName = kind === "correct" ? "correction" : "suggestion";
  return `${languageName} ${kindName}`;
}

function openPromptEditor(language: Language, kind: PromptKind): void {
  activePrompt = { language, kind };
  promptDialogTitle.textContent = promptName(language, kind);
  promptDialogText.value = promptOverrides[language][kind];
  promptDialog.showModal();
  promptDialogText.focus();
}

async function saveActivePrompt(): Promise<void> {
  if (!activePrompt) {
    return;
  }

  const { language, kind } = activePrompt;
  const prompts = normalizePromptOverrides({
    ...promptOverrides,
    [language]: {
      ...promptOverrides[language],
      [kind]: promptDialogText.value,
    },
  });
  await browser.storage.local.set({ [STORAGE_KEY_PROMPTS]: prompts });
  setPromptOverrides(prompts);
  promptDialog.close();
  showSaved();
}

async function loadSettings(): Promise<void> {
  const result = await browser.storage.local.get([
    STORAGE_KEY_API_URL,
    STORAGE_KEY_API_SETTINGS,
    STORAGE_KEY_LANGUAGE,
    STORAGE_KEY_PROMPTS,
  ]);
  const stored = result[STORAGE_KEY_API_URL];
  const url =
    typeof stored === "string" && stored.length > 0 ? stored : API_BASE_URL;
  apiUrlInput.value = url;
  currentApiUrl = url;

  setApiSettings(normalizeApiSettings(result[STORAGE_KEY_API_SETTINGS]));
  setPromptOverrides(normalizePromptOverrides(result[STORAGE_KEY_PROMPTS]));

  const lang = (result[STORAGE_KEY_LANGUAGE] as Language) ?? DEFAULT_LANGUAGE;
  setActiveLang(lang);
  await checkApiHealth();
}

export function initSettings(settingsMode: boolean): void {
  extensionVersionEl.textContent = `${browser.runtime.getManifest().version} (${__EXTENSION_COMMIT__})`;
  void loadSettings();

  if (settingsMode) {
    window.setInterval(() => {
      if (!document.hidden) {
        void checkApiHealth();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void checkApiHealth();
      }
    });
  }

  apiUrlInput.addEventListener("change", async () => {
    const value = apiUrlInput.value.trim();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      await browser.storage.local.set({ [STORAGE_KEY_API_URL]: value });
      currentApiUrl = value;
      showSaved();
      await checkApiHealth();
    }
  });

  for (const lang of Object.keys(LANG_BTNS) as Language[]) {
    LANG_BTNS[lang].addEventListener("click", async () => {
      setActiveLang(lang);
      await browser.storage.local.set({ [STORAGE_KEY_LANGUAGE]: lang });
    });
  }

  for (const input of [
    apiModelInput,
    apiKeyInput,
    temperatureInput,
    maxTokensInput,
    topPInput,
    frequencyPenaltyInput,
    presencePenaltyInput,
  ]) {
    input.addEventListener("change", () => void saveApiSettings());
  }

  setApiSettings(DEFAULT_API_SETTINGS);
  setPromptOverrides(normalizePromptOverrides(undefined));
  for (const language of promptLanguages) {
    for (const kind of promptKinds) {
      promptButtons[language][kind].addEventListener("click", () => {
        openPromptEditor(language, kind);
      });
    }
  }

  promptDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveActivePrompt();
  });
  promptDialogClose.addEventListener("click", () => promptDialog.close());
  promptDialogCancel.addEventListener("click", () => promptDialog.close());
  promptUseDefault.addEventListener("click", () => {
    if (activePrompt) {
      promptDialogText.value =
        PROMPTS[activePrompt.language][activePrompt.kind];
    }
  });
  promptDialog.addEventListener("close", () => {
    activePrompt = null;
  });
}
