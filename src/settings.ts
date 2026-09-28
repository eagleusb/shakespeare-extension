import {
  API_BASE_URL,
  DEFAULT_API_SETTINGS,
  normalizeApiSettings,
  STORAGE_KEY_API_SETTINGS,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_LANGUAGE,
  DEFAULT_LANGUAGE,
} from "./config";
import type { ApiSettings, Language } from "./config";

const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;
const apiSavedEl = document.getElementById("api-saved")!;
const healthDotEl = document.getElementById("health-dot")!;
const langEnBtn = document.getElementById("lang-en")!;
const langFrBtn = document.getElementById("lang-fr")!;
const apiModelInput = document.getElementById("api-model") as HTMLInputElement;
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

const LANG_BTNS: Record<Language, HTMLElement> = {
  en: langEnBtn,
  fr: langFrBtn,
};

async function checkApiHealth(url: string): Promise<void> {
  const ok = await browser.runtime.sendMessage({ type: "check-health", url });
  healthDotEl.className = "health-dot";
  healthDotEl.classList.add(ok ? "ok" : "fail");
}

function setActiveLang(lang: Language): void {
  for (const [key, btn] of Object.entries(LANG_BTNS)) {
    btn.classList.toggle("active", key === lang);
  }
}

function setApiSettings(settings: ApiSettings): void {
  apiModelInput.value = settings.model;
  temperatureInput.value = String(settings.temperature);
  maxTokensInput.value = String(settings.max_tokens);
  topPInput.value = String(settings.top_p);
  frequencyPenaltyInput.value = String(settings.frequency_penalty);
  presencePenaltyInput.value = String(settings.presence_penalty);
}

function getApiSettingsFromInputs(): ApiSettings {
  return normalizeApiSettings({
    model: apiModelInput.value,
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

function saveApiSettings(): void {
  const settings = getApiSettingsFromInputs();
  setApiSettings(settings);
  browser.storage.local
    .set({ [STORAGE_KEY_API_SETTINGS]: settings })
    .then(showSaved);
}

export function initSettings(): void {
  browser.storage.local
    .get([STORAGE_KEY_API_URL, STORAGE_KEY_API_SETTINGS, STORAGE_KEY_LANGUAGE])
    .then((result) => {
      const stored = result[STORAGE_KEY_API_URL];
      const url =
        typeof stored === "string" && stored.length > 0 ? stored : API_BASE_URL;
      apiUrlInput.value = url;
      checkApiHealth(url);

      const apiSettings = normalizeApiSettings(
        result[STORAGE_KEY_API_SETTINGS],
      );
      setApiSettings(apiSettings);

      const lang =
        (result[STORAGE_KEY_LANGUAGE] as Language) ?? DEFAULT_LANGUAGE;
      setActiveLang(lang);
    });

  apiUrlInput.addEventListener("change", () => {
    const value = apiUrlInput.value.trim();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      browser.storage.local.set({ [STORAGE_KEY_API_URL]: value }).then(() => {
        showSaved();
      });
      checkApiHealth(value);
    }
  });

  for (const lang of Object.keys(LANG_BTNS) as Language[]) {
    LANG_BTNS[lang].addEventListener("click", () => {
      setActiveLang(lang);
      browser.storage.local.set({ [STORAGE_KEY_LANGUAGE]: lang });
    });

    for (const input of [
      apiModelInput,
      temperatureInput,
      maxTokensInput,
      topPInput,
      frequencyPenaltyInput,
      presencePenaltyInput,
    ]) {
      input.addEventListener("change", saveApiSettings);
    }

    setApiSettings(DEFAULT_API_SETTINGS);
  }
}
