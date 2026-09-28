import type { ApiChatCompletionRequest } from "./types/api";

export const API_BASE_URL = "http://127.0.0.1:8888";

export const STORAGE_KEY_API_URL = "apiBaseUrl";

export const STORAGE_KEY_API_SETTINGS = "apiSettings";

export const STORAGE_KEY_PROMPTS = "promptOverrides";

export type Language = "en" | "fr";

export const STORAGE_KEY_LANGUAGE = "language";

export const DEFAULT_LANGUAGE: Language = "en";

export const PROMPTS: Record<Language, { correct: string; suggest: string }> = {
  en: {
    correct: `# Agent Guidelines
You are an agent specialized in english and french grammar correction.
Correct the grammar, spelling, and punctuation of the submitted text in its original language.

# Output
Return ONLY the corrected text. No headings, no explanations, no markdown formatting.

# Tone
When responding, you must follow these rules:
- follow the original tone and style
- answer directly from your knowledge when you can
- be concise, prioritize clarity, brevity and don't repeat yourself
- admit when you're unsure rather than making things up`,

    suggest: `# Agent Guidelines
You are an agent specialized in english and french writing improvement.
Rewrite the submitted text with better wording and phrasing.
Keep the original language if no translation is asked (english/english or french/french).

# Output
Return ONLY the improved text. Try to keep the same format and return lines. No headings, no explanations, no markdown formatting.

# Tone
When responding, you must follow these rules:
- answer directly from your knowledge when you can
- be concise, prioritize clarity, brevity and don't repeat yourself
- admit when you're unsure rather than making things up`,
  },

  fr: {
    correct: `# Directives de l'agent
Tu es un agent spécialisé dans la correction grammaticale française.
Corrige la grammaire, l'orthographe et la ponctuation du texte soumis dans sa langue d'origine.

# Sortie
Retourne UNIQUEMENT le texte corrigé. Pas de titres, pas d'explications, pas de formatage markdown.

# Ton
Lors de ta réponse, tu dois suivre ces règles :
- respecter le ton et le style d'origine
- répondre directement à partir de tes connaissances quand tu le peux
- être concis, privilégier la clarté et la brièveté, ne pas te répéter
- avouer quand tu n'es pas sûr plutôt qu'inventer`,

    suggest: `# Directives de l'agent
Tu es un agent spécialisé dans l'amélioration rédactionnelle française.
Réécris le texte soumis avec un meilleur choix de mots et de tournures.
Conserve la langue d'origine si aucune traduction n'est demandée (anglais/anglais ou français/français).

# Sortie
Retourne UNIQUEMENT le texte amélioré. Essaie de conserver le même format et les mêmes retours à la ligne. Pas de titres, pas d'explications, pas de formatage markdown.

# Ton
Lors de ta réponse, tu dois suivre ces règles :
- répondre directement à partir de tes connaissances quand tu le peux
- être concis, privilégier la clarté et la brièveté, ne pas te répéter
- avouer quand tu n'es pas sûr plutôt qu'inventer`,
  },
};

export type PromptOverrides = Record<
  Language,
  { correct: string; suggest: string }
>;

export function normalizePromptOverrides(value: unknown): PromptOverrides {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const prompt = (language: Language, kind: "correct" | "suggest"): string => {
    const languageValue = stored[language];
    const candidate =
      typeof languageValue === "object" && languageValue !== null
        ? (languageValue as Record<string, unknown>)[kind]
        : undefined;
    return typeof candidate === "string" && candidate.trim().length > 0
      ? candidate
      : PROMPTS[language][kind];
  };

  return {
    en: {
      correct: prompt("en", "correct"),
      suggest: prompt("en", "suggest"),
    },
    fr: {
      correct: prompt("fr", "correct"),
      suggest: prompt("fr", "suggest"),
    },
  };
}

export interface ApiSettings {
  /** Blank means use the server's loaded model. */
  model: string;
  apiKey: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
}

export const DEFAULT_API_SETTINGS: ApiSettings = {
  model: "",
  apiKey: "",
  temperature: 1.0,
  max_tokens: 2048,
  top_p: 0.95,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
};

export const API_PARAMS: Pick<
  ApiChatCompletionRequest,
  | "temperature"
  | "max_tokens"
  | "top_p"
  | "top_k"
  | "min_p"
  | "repeat_penalty"
  | "frequency_penalty"
  | "presence_penalty"
  | "stream"
> = {
  temperature: DEFAULT_API_SETTINGS.temperature,
  max_tokens: DEFAULT_API_SETTINGS.max_tokens,
  top_p: 0.95,
  top_k: 40,
  min_p: 0.01,
  repeat_penalty: 1.0,
  stream: true,
};

/**
 * Reads persisted settings without allowing malformed storage values to reach
 * the API request. Values are also constrained to OpenAI-compatible ranges.
 */
export function normalizeApiSettings(value: unknown): ApiSettings {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const numberValue = (
    key: keyof Omit<ApiSettings, "model" | "apiKey">,
    min: number,
    max: number,
  ): number => {
    const candidate = stored[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      return DEFAULT_API_SETTINGS[key];
    }
    return Math.min(max, Math.max(min, candidate));
  };

  return {
    model: typeof stored.model === "string" ? stored.model.trim() : "",
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey.trim() : "",
    temperature: numberValue("temperature", 0, 2),
    max_tokens: Math.round(numberValue("max_tokens", 1, 32_768)),
    top_p: numberValue("top_p", 0, 1),
    frequency_penalty: numberValue("frequency_penalty", -2, 2),
    presence_penalty: numberValue("presence_penalty", -2, 2),
  };
}

export const DEBUG = false;

export const API_TIMEOUT_MS = 30_000;

export const MAX_INPUT_LENGTH = 10_000;
