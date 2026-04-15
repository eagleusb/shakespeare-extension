import {
  API_BASE_URL,
  STORAGE_KEY_API_URL,
  STORAGE_KEY_LANGUAGE,
  DEFAULT_LANGUAGE,
} from "./config";
import type { Language } from "./config";

/* dom references */

const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;
const apiSavedEl = document.getElementById("api-saved")!;
const healthDotEl = document.getElementById("health-dot")!;
const langEnBtn = document.getElementById("lang-en")!;
const langFrBtn = document.getElementById("lang-fr")!;

const LANG_BTNS: Record<Language, HTMLElement> = { en: langEnBtn, fr: langFrBtn };

/* health check */

/** check api health and update the health dot indicator */
async function checkApiHealth(url: string): Promise<void> {
  const ok = await browser.runtime.sendMessage({ type: "check-health", url });
  healthDotEl.className = "health-dot";
  healthDotEl.classList.add(ok ? "ok" : "fail");
}

/* language toggle */

function setActiveLang(lang: Language): void {
  for (const [key, btn] of Object.entries(LANG_BTNS)) {
    btn.classList.toggle("active", key === lang);
  }
}

/* init */

export function initSettings(): void {
  /* load stored settings on popup open */
  browser.storage.local.get([STORAGE_KEY_API_URL, STORAGE_KEY_LANGUAGE]).then((result) => {
    const stored = result[STORAGE_KEY_API_URL];
    const url = typeof stored === "string" && stored.length > 0
      ? stored
      : API_BASE_URL;
    apiUrlInput.value = url;
    checkApiHealth(url);

    const lang = (result[STORAGE_KEY_LANGUAGE] as Language) ?? DEFAULT_LANGUAGE;
    setActiveLang(lang);
  });

  /* save api url to storage on change */
  apiUrlInput.addEventListener("change", () => {
    const value = apiUrlInput.value.trim();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      browser.storage.local.set({ [STORAGE_KEY_API_URL]: value }).then(() => {
        apiSavedEl.classList.add("show");
        setTimeout(() => apiSavedEl.classList.remove("show"), 2_000);
      });
      checkApiHealth(value);
    }
  });

  /* language toggle */
  for (const lang of Object.keys(LANG_BTNS) as Language[]) {
    LANG_BTNS[lang].addEventListener("click", () => {
      setActiveLang(lang);
      browser.storage.local.set({ [STORAGE_KEY_LANGUAGE]: lang });
    });
  }
}
