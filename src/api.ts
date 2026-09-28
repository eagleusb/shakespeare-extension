import {
  API_PARAMS,
  API_TIMEOUT_MS,
  DEBUG,
  DEFAULT_API_SETTINGS,
} from "./config";
import type { ApiSettings } from "./config";
import type {
  ApiErrorResponse,
  ApiChatCompletionStreamChunk,
  ApiHealthResponse,
  ApiModelsResponse,
} from "./types/api";

export interface StreamResult {
  completionTokens?: number;
}

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

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function* streamCorrection(
  text: string,
  systemPrompt: string,
  baseUrl: string,
  result?: StreamResult,
  externalSignal?: AbortSignal,
  apiSettings: ApiSettings = DEFAULT_API_SETTINGS,
): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response: Response;

  try {
    const { model, ...generationSettings } = apiSettings;

    response = await fetch(endpointUrl(baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...API_PARAMS,
        ...generationSettings,
        ...(model ? { model } : {}),
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

  clearTimeout(timeout);

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
        throw new ApiError(
          "Rate limited by the API (429). Please wait and try again.",
          status,
        );
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

export async function checkHealth(baseUrl: string): Promise<boolean> {
  /* llama.cpp exposes /health, while Unsloth Desktop currently exposes
   * /v1/models but not either health endpoint. Try the standard endpoints
   * first, then use a successful model listing as the compatibility fallback.
   */
  for (const path of ["/v1/health", "/health", "/v1/models"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(endpointUrl(baseUrl, path), {
        signal: controller.signal,
      });

      if (!response.ok) {
        continue;
      }

      if (path === "/v1/models") {
        const body = (await response.json()) as ApiModelsResponse;
        return Array.isArray(body.data);
      }

      const body = (await response.json()) as ApiHealthResponse;
      if (body.status === "ok") {
        return true;
      }
    } catch {
    } finally {
      clearTimeout(timeout);
    }
  }

  return false;
}
