import { API_PARAMS, API_TIMEOUT_MS, DEBUG } from "./config";
import type { ApiErrorResponse, ApiChatCompletionStreamChunk, ApiHealthResponse } from "./types/api";

/** metadata returned by the api after streaming completes. */
export interface StreamResult {
  completionTokens?: number;
}

/** error thrown when the api call fails for any reason (network, http, malformed response). */
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
 * streams a text correction request to the local llama.cpp server.
 *
 * yields each token as it arrives from the sse stream, enabling progressive
 * display in the ui without waiting for the full response.
 *
 * @param text - validated, non-empty input text
 * @param systemPrompt - system prompt to instruct the model
 * @param baseUrl - api server base url (e.g. "http://localhost:8080")
 * @param result - optional object populated with metadata after streaming completes
 * @yields individual content tokens from the model's stream
 * @throws {@link ApiError} on timeout, http errors, or network failures
 */
export async function* streamCorrection(
  text: string,
  systemPrompt: string,
  baseUrl: string,
  result?: StreamResult,
  externalSignal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...API_PARAMS,
        stream: true,
        stream_options: { include_usage: true },
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
      `Failed to connect to API at ${baseUrl}. Is llama.cpp server running?`,
      undefined,
      err,
    );
  }

  /* connection established — clear the connect-timeout */
  clearTimeout(timeout);

  /* http status errors */

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
          `API endpoint not found (404). Is llama.cpp server running at ${baseUrl}?`,
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

  /* sse stream parsing */

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

        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.log("[shakespeare]", chunk);
        }

        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          yield token;
        }

        if (chunk.usage && result) {
          result.completionTokens = chunk.usage.completion_tokens;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * checks whether the llama.cpp server is reachable and healthy.
 *
 * queries the `/v1/health` endpoint and returns `true` if the server
 * responds with `{ "status": "ok" }`. returns `false` on any network
 * error, non-200 status, or unexpected response body.
 *
 * @param baseUrl - api server base url (e.g. "http://localhost:8080")
 */
export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(`${baseUrl}/v1/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as ApiHealthResponse;
    return body.status === "ok";
  } catch {
    return false;
  }
}
