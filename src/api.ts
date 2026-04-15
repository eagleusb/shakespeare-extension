import { API_BASE_URL, API_PARAMS, API_TIMEOUT_MS } from "./config";
import type { ApiErrorResponse, ApiChatCompletionStreamChunk } from "./types/api";

/** Error thrown when the API call fails for any reason (network, HTTP, malformed response). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly overrideCause?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Streams a text correction request to the local llama.cpp server.
 *
 * Yields each token as it arrives from the SSE stream, enabling progressive
 * display in the UI without waiting for the full response.
 *
 * @param text - Validated, non-empty input text
 * @param systemPrompt - System prompt to instruct the model
 * @yields Individual content tokens from the model's stream
 * @throws {@link ApiError} on timeout, HTTP errors, or network failures
 */
export async function* streamCorrection(
  text: string,
  systemPrompt: string,
): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...API_PARAMS,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `Request timed out after ${API_TIMEOUT_MS / 1_000} seconds.`,
      );
    }

    throw new ApiError(
      `Failed to connect to API at ${API_BASE_URL}. Is llama.cpp server running?`,
      undefined,
      err,
    );
  }

  // Connection established — clear the connect-timeout
  clearTimeout(timeout);

  // ─── HTTP status errors ──────────────────────────────────────────────────

  if (!response.ok) {
    const status = response.status;

    let detail: string;
    try {
      const body = (await response.json()) as ApiErrorResponse;
      detail = body.error?.message ?? response.statusText;
    } catch {
      detail = response.statusText;
    }

    switch (status) {
      case 404:
        throw new ApiError(
          `API endpoint not found (404). Is llama.cpp server running at ${API_BASE_URL}?`,
          status,
        );
      case 429:
        throw new ApiError("Rate limited by the API (429). Please wait and try again.", status);
      case 502:
      case 503:
        throw new ApiError(
          `Server is unavailable (${status}). Check llama.cpp server logs.`,
          status,
        );
      default:
        if (status >= 500) {
          throw new ApiError(`Server error (${status}): ${detail}`, status);
        }
        throw new ApiError(`HTTP ${status}: ${detail}`, status);
    }
  }

  // ─── SSE stream parsing ─────────────────────────────────────────────────

  const body = response.body;
  if (!body) {
    throw new ApiError("Streaming not supported: response body is null.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed === "data: [DONE]") {
          continue;
        }

        if (!trimmed.startsWith("data: ")) {
          continue;
        }

        let chunk: ApiChatCompletionStreamChunk;
        try {
          chunk = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          yield token;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
