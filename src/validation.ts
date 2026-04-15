import { MAX_INPUT_LENGTH } from "./config";
import type { ApiChatCompletionResponse } from "./types/api";

/** Error thrown when input or output validation fails. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates and sanitises the user-selected text before sending it to the API.
 *
 * @param text - Raw value from `info.selectionText` (may be `undefined` or any type)
 * @returns Trimmed, validated string
 * @throws {@link ValidationError} when the input is invalid
 */
export function validateInput(text: unknown): string {
  if (typeof text !== "string") {
    throw new ValidationError("Selected text is not a valid string.");
  }

  if (text.includes("\0")) {
    throw new ValidationError("Selected text contains invalid characters (null bytes).");
  }

  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new ValidationError("Selected text is empty.");
  }

  if (!/\S/.test(trimmed)) {
    throw new ValidationError("Selected text contains no readable content.");
  }

  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new ValidationError(
      `Selected text is too long (${trimmed.length.toLocaleString()} characters). Maximum is ${MAX_INPUT_LENGTH.toLocaleString()}.`,
    );
  }

  return trimmed;
}

/**
 * Validates the parsed JSON response from the OpenAI-compatible chat completions endpoint.
 *
 * Expected shape:
 * ```json
 * { "choices": [{ "message": { "content": "..." } }] }
 * ```
 *
 * @param data - Parsed JSON from the API response
 * @returns The validated content string
 * @throws {@link ValidationError} when the response is malformed or empty
 */
export function validateOutput(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    throw new ValidationError("Invalid API response: expected a JSON object.");
  }

  const response = data as ApiChatCompletionResponse;

  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new ValidationError("Empty response from API (no choices returned).");
  }

  const firstChoice = response.choices[0];
  if (!firstChoice?.message) {
    throw new ValidationError("Malformed response: missing message object.");
  }

  if (typeof firstChoice.message.content !== "string") {
    throw new ValidationError("Malformed response: content is not a string.");
  }

  const content = firstChoice.message.content.trim();
  if (content.length === 0) {
    throw new ValidationError("API returned an empty correction.");
  }

  return content;
}
