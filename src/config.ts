import type { ApiChatCompletionRequest } from "./types/api";

/** Default base URL of the OpenAI-compatible API server. */
export const API_BASE_URL = "http://localhost:8080";

/** Storage key for the configurable API base URL. */
export const STORAGE_KEY_API_URL = "apiBaseUrl";

/** Shared tone rules appended to every prompt. */
const TONE_RULES = `# Tone
When responding, you must follow these rules:
- follow the original tone and style
- answer directly from your knowledge when you can
- be concise, prioritize clarity, brevity and don't repeat yourself
- admit when you're unsure rather than making things up`;

/**
 * System prompt for grammar/spelling correction.
 * Instructs the model to return only the corrected text.
 */
export const CORRECT_PROMPT = `# Agent Guidelines
You are an agent specialized in english grammar correction.
Correct the grammar, spelling, and punctuation of the submitted text.

# Output
Return ONLY the corrected text. No headings, no explanations, no markdown formatting.

${TONE_RULES}`;

/**
 * System prompt for wording improvement.
 * Instructs the model to return a better-worded version of the text.
 */
export const SUGGEST_PROMPT = `# Agent Guidelines
You are an agent specialized in english writing improvement.
Rewrite the submitted text with better wording and phrasing while preserving the original meaning.

# Output
Return ONLY the improved text, with the same format, return lines, spacing, and punctuation. No headings, no explanations, no markdown formatting.

${TONE_RULES}`;

/** Parameters sent to the chat completions endpoint (generation/sampling subset). */
export const API_PARAMS: Pick<ApiChatCompletionRequest,
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
  temperature: 1.0,
  max_tokens: 2048,
  top_p: 0.95,
  top_k: 40,
  min_p: 0.01,
  repeat_penalty: 1.0,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  stream: true,
};

/** HTTP request timeout in milliseconds. */
export const API_TIMEOUT_MS = 30_000;

/** Maximum allowed input text length in characters. */
export const MAX_INPUT_LENGTH = 10_000;
