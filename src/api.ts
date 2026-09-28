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

type XhrStreamEvent =
  | { type: "text"; value: string }
  | { type: "done" }
  | { type: "error"; error: ApiError };

function apiHttpError(
  status: number,
  detail: string,
  baseUrl: string,
): ApiError {
  switch (status) {
    case 404:
      return new ApiError(
        `API endpoint not found (404). Is llama.cpp server running at ${baseUrl}?`,
        status,
      );
    case 401:
      return new ApiError(
        `API rejected the request as unauthenticated (401) at ${baseUrl}. Configure a valid API key in settings, or leave it blank only when the server allows keyless browser requests.`,
        status,
      );
    case 429:
      return new ApiError(
        "Rate limited by the API (429). Please wait and try again.",
        status,
      );
    case 502:
    case 503:
      return new ApiError(
        `Server is unavailable (${status}). Check llama.cpp server logs.`,
        status,
      );
    default:
      return status >= 500
        ? new ApiError(`Server error (${status}): ${detail}`, status)
        : new ApiError(`HTTP ${status}: ${detail}`, status);
  }
}

function apiErrorDetail(responseText: string, statusText: string): string {
  try {
    const body = JSON.parse(responseText) as ApiErrorResponse;
    return body.error?.message ?? statusText;
  } catch {
    return statusText;
  }
}

function parseStreamLine(
  line: string,
  result?: StreamResult,
): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) {
    return undefined;
  }

  let chunk: ApiChatCompletionStreamChunk;
  try {
    chunk = JSON.parse(trimmed.slice(6));
  } catch {
    return undefined;
  }

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[shakespeare]", chunk);
  }

  if (chunk.usage && result) {
    result.completionTokens = chunk.usage.completion_tokens;
  }

  return chunk.choices?.[0]?.delta?.content;
}

export async function* streamCorrection(
  text: string,
  systemPrompt: string,
  baseUrl: string,
  result?: StreamResult,
  externalSignal?: AbortSignal,
  apiSettings: ApiSettings = DEFAULT_API_SETTINGS,
): AsyncGenerator<string, void, undefined> {
  if (externalSignal?.aborted) {
    throw new ApiError("Request cancelled.");
  }

  const xhr = new XMLHttpRequest();
  const events: XhrStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let consumedLength = 0;
  let settled = false;
  let buffer = "";

  const push = (event: XhrStreamEvent): void => {
    events.push(event);
    wake?.();
    wake = undefined;
  };

  const pushNewText = (): void => {
    if (xhr.status < 200 || xhr.status >= 300) {
      return;
    }
    const next = xhr.responseText.slice(consumedLength);
    consumedLength = xhr.responseText.length;
    if (next) {
      push({ type: "text", value: next });
    }
  };

  const finish = (event: XhrStreamEvent): void => {
    if (settled) {
      return;
    }
    settled = true;
    push(event);
  };

  xhr.onprogress = pushNewText;
  xhr.onload = () => {
    pushNewText();
    if (xhr.status >= 200 && xhr.status < 300) {
      finish({ type: "done" });
      return;
    }
    finish({
      type: "error",
      error: apiHttpError(
        xhr.status,
        apiErrorDetail(xhr.responseText, xhr.statusText),
        baseUrl,
      ),
    });
  };
  xhr.onerror = () =>
    finish({
      type: "error",
      error: new ApiError(
        `Failed to connect to API at ${baseUrl}. Is llama.cpp server running?`,
      ),
    });
  xhr.ontimeout = () =>
    finish({
      type: "error",
      error: new ApiError(
        `Request timed out after ${API_TIMEOUT_MS / 1_000} seconds.`,
      ),
    });
  xhr.onabort = () =>
    finish({ type: "error", error: new ApiError("Request cancelled.") });

  const abort = (): void => xhr.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });

  try {
    const { model, apiKey, ...generationSettings } = apiSettings;
    xhr.open("POST", endpointUrl(baseUrl, "/v1/chat/completions"), true);
    xhr.timeout = API_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", "application/json");
    if (apiKey) {
      xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
    }
    xhr.send(
      JSON.stringify({
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
    );
  } catch (error) {
    externalSignal?.removeEventListener("abort", abort);
    throw new ApiError(
      `Failed to connect to API at ${baseUrl}. Is llama.cpp server running?`,
      undefined,
      error,
    );
  }

  try {
    while (true) {
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      const event = events.shift();
      if (!event) {
        continue;
      }
      if (event.type === "error") {
        throw event.error;
      }
      if (event.type === "done") {
        const token = parseStreamLine(buffer, result);
        if (token) {
          yield token;
        }
        break;
      }

      buffer += event.value;

      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const token = parseStreamLine(line, result);
        if (token) {
          yield token;
        }
      }
    }
  } finally {
    externalSignal?.removeEventListener("abort", abort);
    if (!settled) {
      xhr.abort();
    }
  }
}

function xhrGet(
  url: string,
  apiKey: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = 5_000;
    if (apiKey) {
      xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = reject;
    xhr.ontimeout = reject;
    xhr.send();
  });
}

export async function checkHealth(
  baseUrl: string,
  apiKey = "",
): Promise<boolean> {
  /* Unsloth Desktop exposes /v1/models; llama.cpp may expose /health. */
  for (const path of ["/v1/models", "/v1/health", "/health"]) {
    try {
      const response = await xhrGet(endpointUrl(baseUrl, path), apiKey);

      if (response.status < 200 || response.status >= 300) {
        continue;
      }

      if (path === "/v1/models") {
        const body = JSON.parse(response.text) as ApiModelsResponse;
        return Array.isArray(body.data);
      }

      const body = JSON.parse(response.text) as ApiHealthResponse;
      if (body.status === "ok") {
        return true;
      }
    } catch {}
  }

  return false;
}
